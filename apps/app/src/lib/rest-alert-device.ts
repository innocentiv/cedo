import { useEffect, useState, useSyncExternalStore } from 'react'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { router } from 'expo-router'
import type * as ExpoNotifications from 'expo-notifications'
import type { RestAlert, RestPhase } from '@cedo/contract'
import { restAlertStore } from '../auth/token-storage.ts'
import { ownSession } from './addresses.ts'
import {
  type AlertKind,
  type TellingKind,
  type Wanted,
  createAlertKind,
  createRestAlerts,
  offersToTell,
  secondsUntil,
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

async function notifications(): Promise<typeof ExpoNotifications> {
  return await import('expo-notifications')
}

/** What each kind asks of iOS: to be allowed, to be set, to be cancelled. */
interface Teller {
  /** iOS asks the person once; after that it answers what they said. */
  readonly allow: () => Promise<boolean>
  readonly schedule: (wanted: Wanted) => Promise<void>
  readonly cancel: () => Promise<void>
}

const TELLERS: Readonly<Record<TellingKind, Teller>> = {
  notification: {
    allow: async () => {
      const asked = await (
        await notifications()
      ).requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })
      return asked.granted
    },
    schedule: async (wanted) => {
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
          seconds: secondsUntil(wanted.endsAt, Date.now()),
        },
      })
    },
    cancel: async () => {
      const n = await notifications()
      await n.cancelScheduledNotificationAsync(REST_OVER)
      // One told while the app was closed tells a rest that is over now.
      await n.dismissNotificationAsync(REST_OVER)
    },
  },
  alarm: {
    allow: async () => (await restAlarm?.requestAuthorization()) === true,
    // The system's alarm sound, and the title alone: an alarm says no more.
    schedule: async (wanted) => {
      await restAlarm?.schedule(secondsUntil(wanted.endsAt, Date.now()), wanted.title)
    },
    cancel: async () => {
      await restAlarm?.cancel()
    },
  },
}

const alerts = createRestAlerts({
  schedule: async (wanted) => {
    await TELLERS[wanted.kind].schedule(wanted)
  },
  cancel: async (kind) => {
    await TELLERS[kind].cancel()
  },
})
const kind = createAlertKind({
  store: restAlertStore,
  allow: async (chosen) => await TELLERS[chosen].allow(),
  alerts,
})

const reportError = (error: unknown): void => {
  console.error(error)
}

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

/** iOS asks only once: after a refusal, it is changed in the phone's own Settings. */
const REFUSED: Readonly<Record<TellingKind, string>> = {
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
    const allowed = await kind.choose(chosen)
    setRefused(allowed || chosen === 'off' ? null : REFUSED[chosen])
  }
  return {
    choose: (chosen) => {
      choose(chosen).catch(reportError)
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
  said: RestAlert,
  sessionId: string,
): { readonly offer: (() => void) | null; readonly refused: string | null } {
  const chosen = useAlertKind()
  const { choose, refused } = useChooseAlertKind()
  useEffect(() => {
    const wanted = wantedAlert({ kind: chosen, phase, said, sessionId, now: Date.now() })
    alerts.follow(wanted).catch(reportError)
  }, [chosen, phase, said, sessionId])
  return {
    offer:
      tellsWhileClosed && offersToTell(chosen)
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
    alerts.end(sessionId).catch(reportError)
  }, [sessionId, ended])
}

/** A rest's end tapped: its session, opened. */
function openTapped(response: ExpoNotifications.NotificationResponse): void {
  const sessionId = response.notification.request.content.data?.['sessionId']
  if (typeof sessionId === 'string') router.push(ownSession(sessionId))
}

/**
 * A rest's end shown while the app was closed tells a rest that is over by the time the app is back,
 * which says so itself: it is cleared, an alarm left as it is.
 */
async function clearShown(): Promise<void> {
  await (await notifications()).dismissNotificationAsync(REST_OVER)
}

/**
 * While the app is open, where the session screen is: nothing shown while it is in front, a rest's end shown while it
 * was closed cleared once it is back, and a tap on one — the one that opened the app, too — taken
 * to its session.
 */
export function useRestAlertsInApp(): void {
  useEffect(() => {
    if (!tellsWhileClosed) return
    let gone = false
    let listening: { remove: () => void } | null = null
    const back = AppState.addEventListener('change', (state) => {
      if (state === 'active') clearShown().catch(reportError)
    })
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
      await clearShown()
    })().catch(reportError)
    return () => {
      gone = true
      listening?.remove()
      back.remove()
    }
  }, [])
}
