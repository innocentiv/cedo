import { useEffect, useState, useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { router } from 'expo-router'
import type * as ExpoNotifications from 'expo-notifications'
import type { RestPhase } from '@cedo/contract'
import { restAlertStore } from '../auth/token-storage.ts'
import { ownSession } from './addresses.ts'
import {
  type AlertKind,
  type AlertScheduler,
  createAlertKind,
  createRestAlerts,
  wantedAlert,
} from './rest-alert.ts'

export type { AlertKind } from './rest-alert.ts'

/**
 * The phone's side of telling a rest's end with the app closed (#39): what `rest-alert.ts` decides,
 * asked of iOS — a notification through expo-notifications, imported lazily so the web never
 * evaluates it, or an alarm through AlarmKit (`modules/rest-alarm`, iOS 26 and later). A
 * home-screen web app cannot be told anything closed, so there it is always off.
 *
 * With the app in front a notification is not shown: the rest band counts down and the app chimes,
 * as before. An alarm rings even then, and the app does not chime beside it. A tap on a
 * notification told while the app was closed opens its session, even from a cold start.
 */

/** Only the native app is told a rest's end while closed. */
export const tellsWhileClosed = Platform.OS !== 'web'

/** The one rest alert: scheduling it again replaces the one pending. */
const REST_OVER = 'rest-over'

/** The app's own AlarmKit module (`modules/rest-alarm`): one alarm, replaced when set again. */
interface RestAlarmModule {
  readonly isAvailable: () => boolean
  readonly requestAuthorization: () => Promise<boolean>
  readonly schedule: (seconds: number, title: string) => Promise<void>
  readonly cancel: () => Promise<void>
}

const restAlarm = tellsWhileClosed
  ? requireOptionalNativeModule<RestAlarmModule>('RestAlarm')
  : null

/** Whether this phone rings a rest's end as an alarm: iOS 26 and later, offered only there. */
export const ringsAlarms = restAlarm?.isAvailable() === true

/** Whole seconds to an end, by this phone's clock: never none, which iOS refuses. */
const secondsTo = (endsAt: number): number => Math.max(1, Math.round((endsAt - Date.now()) / 1000))

async function notifications(): Promise<typeof ExpoNotifications> {
  return await import('expo-notifications')
}

const scheduler: AlertScheduler = {
  schedule: async (wanted) => {
    if (wanted.kind === 'alarm') {
      // The system's alarm sound, and the title alone: an alarm says no more.
      await restAlarm?.schedule(secondsTo(wanted.endsAt), wanted.title)
      return
    }
    const n = await notifications()
    await n.scheduleNotificationAsync({
      identifier: REST_OVER,
      content: {
        title: wanted.title,
        body: wanted.body,
        // Bundled by the expo-notifications plugin (app.json): cedo's own chime.
        sound: 'chime.wav',
        data: { sessionId: wanted.sessionId },
      },
      trigger: {
        type: n.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsTo(wanted.endsAt),
      },
    })
  },
  cancel: async (kind) => {
    if (kind === 'alarm') {
      await restAlarm?.cancel()
      return
    }
    const n = await notifications()
    await n.cancelScheduledNotificationAsync(REST_OVER)
    // One told while the app was closed tells a rest that is over now.
    await n.dismissNotificationAsync(REST_OVER)
  },
}

const alerts = createRestAlerts(scheduler)
const kind = createAlertKind(restAlertStore)

/** Read from the keychain once, by whichever screen first asks. */
let restored: Promise<void> | null = null

/** How this phone tells a rest's end: off on the web, which cannot. */
export function useAlertKind(): AlertKind {
  const chosen = useSyncExternalStore(kind.subscribe, kind.snapshot)
  useEffect(() => {
    if (tellsWhileClosed) restored ??= kind.restore()
  }, [])
  return tellsWhileClosed ? chosen : 'off'
}

/**
 * iOS is asked first: it asks the person once, and after that says what they answered. False when
 * it is not allowed; nothing is kept then.
 */
async function chooseAlertKind(chosen: AlertKind): Promise<boolean> {
  if (chosen === 'notification') {
    const n = await notifications()
    const asked = await n.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    })
    if (!asked.granted) return false
  }
  if (chosen === 'alarm' && (await restAlarm?.requestAuthorization()) !== true) return false
  await kind.choose(chosen)
  // A rest whose screen is not open is not followed: turned off, its alert is cancelled here.
  if (chosen === 'off') await alerts.follow(null)
  return true
}

/** iOS asks only once: after a refusal, it is changed in the phone's own Settings. */
const REFUSED: Readonly<Record<AlertKind, string | null>> = {
  off: null,
  notification:
    'Notifications are off for cedo. Turn them on in the iPhone’s Settings, under cedo.',
  alarm: 'Alarms are off for cedo. Turn them on in the iPhone’s Settings, under cedo.',
}

/** Choosing how a rest's end is told — in Settings, or from the rest band — and iOS refusing it. */
export function useChooseAlertKind(): {
  readonly choose: (chosen: AlertKind) => void
  readonly refused: string | null
} {
  const [refused, setRefused] = useState<string | null>(null)
  const choose = async (chosen: AlertKind): Promise<void> => {
    try {
      setRefused((await chooseAlertKind(chosen)) ? null : REFUSED[chosen])
    } catch (error) {
      console.error(error)
    }
  }
  return {
    choose: (chosen) => {
      void choose(chosen)
    },
    refused,
  }
}

/**
 * The rest this phone counts, told to iOS as it changes — beside its clock (`useJustDone`). While
 * nothing tells it, the rest band offers to: one tap turns on notifications.
 */
export function useRestTold(
  phase: RestPhase,
  said: { readonly title: string; readonly body: string },
  sessionId: string,
): { readonly offer: (() => void) | null; readonly refused: string | null } {
  const chosen = useAlertKind()
  const { choose, refused } = useChooseAlertKind()
  useEffect(() => {
    const wanted = wantedAlert({ kind: chosen, phase, said, sessionId, now: Date.now() })
    alerts.follow(wanted).catch((error: unknown) => {
      console.error(error)
    })
  }, [chosen, phase, said, sessionId])
  const offered = tellsWhileClosed && chosen === 'off'
  return {
    offer: offered
      ? () => {
          choose('notification')
        }
      : null,
    refused,
  }
}

/** A session seen finished, here or elsewhere: no clock runs on it to cancel its alert. */
export function useRestAlertEnded(sessionId: string, ended: boolean): void {
  useEffect(() => {
    if (!ended) return
    alerts.end(sessionId).catch((error: unknown) => {
      console.error(error)
    })
  }, [sessionId, ended])
}

/** A rest's end tapped: its session, opened. */
function openTapped(response: ExpoNotifications.NotificationResponse): void {
  const sessionId = response.notification.request.content.data?.['sessionId']
  if (typeof sessionId === 'string') router.push(ownSession(sessionId))
}

/**
 * Where the session screen is: nothing shown while the app is in front, and a tap on a rest's end —
 * the one that opened the app, too — taken to its session.
 */
export function useRestAlertTaps(): void {
  useEffect(() => {
    if (!tellsWhileClosed) return
    let gone = false
    let listening: { remove: () => void } | null = null
    void (async () => {
      const n = await notifications()
      if (gone) return
      // In front, the rest band says it and the app chimes: iOS shows nothing.
      n.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      })
      const opened = n.getLastNotificationResponse()
      if (opened !== null) {
        // Taken once: a later sign-in on this open does not go there again.
        n.clearLastNotificationResponse()
        openTapped(opened)
      }
      listening = n.addNotificationResponseReceivedListener(openTapped)
    })().catch((error: unknown) => {
      console.error(error)
    })
    return () => {
      gone = true
      listening?.remove()
    }
  }, [])
}
