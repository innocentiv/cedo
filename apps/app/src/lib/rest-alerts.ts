import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { PushSubscriptionInput } from '@cedo/contract'
import { api } from '../api/http.ts'
import { type AlertsState, alertsStateOf, keyBytes } from '../pwa/rest-alert.ts'

/**
 * Being told when a rest is over with the app closed (#38): this device's answer, turning it on or
 * off, and keeping it the signed-in person's — re-subscribed on every open, and forgotten at sign
 * out, so the next person on the device is not told the last one's rests. What it says is
 * `alertsStateOf`'s, plain and tested.
 */

const supported = (): boolean =>
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  typeof window !== 'undefined' &&
  'PushManager' in window &&
  'Notification' in window

async function subscription(): Promise<PushSubscription | null> {
  if (!supported()) return null
  const registration = await navigator.serviceWorker.ready
  return await registration.pushManager.getSubscription()
}

async function stateNow(): Promise<AlertsState> {
  const can = supported()
  return alertsStateOf({
    supported: can,
    permission: can ? Notification.permission : 'default',
    subscribed: can && (await subscription()) !== null,
  })
}

/** On every open, signed in: this device told again, as the person signed in on it now. */
export async function keepThisDevice(): Promise<void> {
  const subscribed = await subscription()
  if (subscribed === null) return
  await api.push.subscribe(PushSubscriptionInput.parse(subscribed.toJSON()))
}

/** At sign out: this device told no more — the account's alerts are not the next person's. */
export async function forgetThisDevice(): Promise<void> {
  const subscribed = await subscription()
  if (subscribed === null) return
  await api.push.unsubscribe({ endpoint: subscribed.endpoint })
  await subscribed.unsubscribe()
}

/** Signed in, on every open: this device's rest alerts, if it has them, are this person's. */
export function useThisDeviceKept(signedIn: boolean): void {
  useEffect(() => {
    if (signedIn) void keepThisDevice().catch(() => null)
  }, [signedIn])
}

export function useRestAlerts(): {
  readonly state: AlertsState
  readonly busy: boolean
  /** From a tap — iOS asks only then. */
  readonly turnOn: () => Promise<void>
  readonly turnOff: () => Promise<void>
} {
  const [state, setState] = useState<AlertsState>('unsupported')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void stateNow().then(setState)
  }, [])

  const settle = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await work()
    } finally {
      setState(await stateNow())
      setBusy(false)
    }
  }

  const turnOn = useCallback(
    async () =>
      await settle(async () => {
        if ((await Notification.requestPermission()) !== 'granted') return
        const registration = await navigator.serviceWorker.ready
        const { publicKey } = await api.push.key()
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        })
        await keepThisDevice()
      }),
    [],
  )
  const turnOff = useCallback(async () => await settle(forgetThisDevice), [])

  return { state, busy, turnOn, turnOff }
}
