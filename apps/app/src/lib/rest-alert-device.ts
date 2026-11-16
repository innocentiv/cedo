import { useEffect, useState, useSyncExternalStore } from 'react'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { router } from 'expo-router'
import type * as ExpoNotifications from 'expo-notifications'
import type { RestAlert, RestPhase } from '@cedo/contract'
import { restAlertStore } from '../auth/token-storage.ts'
import { ownSession } from './addresses.ts'
import {
  type AlertDevice,
  chimesInApp,
  createRestAlerts,
  sessionTapped,
  wantedAlert,
} from './rest-alert.ts'
import {
  type AlertKind,
  type TellingKind,
  createAlertKind,
  offersToTell,
} from './rest-alert-kind.ts'

export type { AlertKind } from './rest-alert-kind.ts'

/**
 * The phone's side of telling a rest's end with the app closed (#39): what `rest-alert.ts` decides,
 * asked of iOS. A notification, through expo-notifications — imported lazily, so the web never
 * evaluates it — with the rest counting down beside it on the Lock Screen and in the Dynamic
 * Island; or an alarm, which rings through the silent switch (AlarmKit, iOS 26 and later). Both
 * the countdown and the alarm are the app's own native module, `modules/rest-alert`. A home-screen
 * web app cannot be told anything closed, so there it is always off.
 *
 * With the app in front a notification is not shown: the rest band counts down and the app chimes,
 * as before. An alarm rings even then, and the app does not chime beside it. A tap on a
 * notification, or on the countdown, opens its session, even from a cold start.
 */

/** Only the native app is told a rest's end while closed. */
export const tellsWhileClosed = Platform.OS !== 'web'

/** The one rest alert: scheduling it again replaces the one pending. */
const REST_OVER = 'rest-over'

/** The app's own native module (`modules/rest-alert`): one countdown, one alarm, each replaced when set again. */
interface RestAlertModule {
  /** None where Live Activities are off for cedo: the notification is told all the same. */
  readonly showCountdown: (seconds: number, next: string, sessionId: string) => Promise<void>
  readonly endCountdown: () => Promise<void>
  /** One whose rest is over, once the app is back: it has said so, and goes. */
  readonly endCountdownIfOver: () => Promise<void>
  readonly ringsAlarms: () => boolean
  readonly allowAlarms: () => Promise<boolean>
  readonly scheduleAlarm: (seconds: number, title: string) => Promise<void>
  readonly cancelAlarm: () => Promise<void>
}

const restAlertModule = tellsWhileClosed
  ? requireOptionalNativeModule<RestAlertModule>('RestAlert')
  : null

/** Whether this phone rings a rest's end as an alarm: iOS 26 and later, offered only there. */
export const ringsAlarms = restAlertModule?.ringsAlarms() === true

async function notifications(): Promise<typeof ExpoNotifications> {
  return await import('expo-notifications')
}

/** Each of the phone's calls, passed on as it is: which are made, and when, is `rest-alert.ts`'s. */
const device: AlertDevice = {
  showCountdown: async (seconds, next, sessionId) => {
    await restAlertModule?.showCountdown(seconds, next, sessionId)
  },
  endCountdown: async () => {
    await restAlertModule?.endCountdown()
  },
  endCountdownIfOver: async () => {
    await restAlertModule?.endCountdownIfOver()
  },
  scheduleNotification: async ({ seconds, title, body, data }) => {
    const n = await notifications()
    await n.scheduleNotificationAsync({
      identifier: REST_OVER,
      content: {
        title,
        body,
        // Bundled by the expo-notifications plugin (app.json): cedo's own chime.
        sound: 'chime.wav',
        data: { sessionId: data.sessionId },
      },
      trigger: { type: n.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds },
    })
  },
  cancelNotification: async () => {
    await (await notifications()).cancelScheduledNotificationAsync(REST_OVER)
  },
  dismissNotification: async () => {
    await (await notifications()).dismissNotificationAsync(REST_OVER)
  },
  scheduleAlarm: async (seconds, title) => {
    await restAlertModule?.scheduleAlarm(seconds, title)
  },
  cancelAlarm: async () => {
    await restAlertModule?.cancelAlarm()
  },
}

/** What each kind asks of iOS before it is chosen: iOS asks the person once, then answers that. */
const ALLOW: Readonly<Record<TellingKind, () => Promise<boolean>>> = {
  notification: async () => {
    const asked = await (
      await notifications()
    ).requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })
    return asked.granted
  },
  alarm: async () => (await restAlertModule?.allowAlarms()) === true,
}

const alerts = createRestAlerts({
  device,
  now: Date.now,
  inFront: () => AppState.currentState === 'active',
})
const kind = createAlertKind({
  store: restAlertStore,
  allow: async (chosen) => await ALLOW[chosen](),
  alerts,
})

const reportError = (error: unknown): void => {
  console.error(error)
}

/** Whether the app chimes at a rest's end now: not beside an alarm iOS has set for it. */
export const chimesNow = (): boolean => chimesInApp(alerts.current())

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
 * The rest this phone counts, told to iOS as it changes — beside its clock (`useJustLogged`). While
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
    alerts
      .follow(wantedAlert({ kind: chosen, phase, said, sessionId, now: Date.now() }))
      .catch(reportError)
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

/** A session seen finished, or gone, here or elsewhere: no clock runs on it to cancel its alert. */
export function useRestAlertEnded(sessionId: string, ended: boolean): void {
  useEffect(() => {
    if (!ended) return
    alerts.end(sessionId).catch(reportError)
  }, [sessionId, ended])
}

/** A rest's end tapped: its session, opened. */
function openTapped(response: ExpoNotifications.NotificationResponse): void {
  const sessionId = sessionTapped(response.notification.request.content.data)
  if (sessionId !== null) router.push(ownSession(sessionId))
}

/**
 * While the app is open, where the session screen is: nothing shown while it is in front, a rest's
 * end shown while it was closed cleared once it is back (`cameToFront`), and a tap on one — the one
 * that opened the app, too — taken to its session.
 */
export function useRestAlertsInApp(): void {
  useEffect(() => {
    if (!tellsWhileClosed) return
    let gone = false
    let listening: { remove: () => void } | null = null
    const back = AppState.addEventListener('change', (state) => {
      if (state === 'active') alerts.cameToFront().catch(reportError)
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
      await alerts.cameToFront()
    })().catch(reportError)
    return () => {
      gone = true
      listening?.remove()
      back.remove()
    }
  }, [])
}
