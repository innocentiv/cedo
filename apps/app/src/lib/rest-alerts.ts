import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { PushSubscriptionInput } from '@cedo/contract'
import { api } from '../api/http.ts'
import { keyBytes } from '../pwa/rest-alert.ts'

/**
 * Being told when a rest is over with the app closed (#38): this device's answer, and turning it on
 * or off. Only a browser that can take a push — on an iPhone, cedo added to the home screen.
 *
 * - `unsupported`: this browser cannot be told.
 * - `ask`: not answered yet — the rest band offers it.
 * - `on`, `off`: answered, and this device is, or is not, told.
 * - `blocked`: refused in the browser's settings, which only those can undo.
 */
export type AlertsState = 'unsupported' | 'ask' | 'on' | 'off' | 'blocked'

const supported = (): boolean =>
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  typeof window !== 'undefined' &&
  'PushManager' in window &&
  'Notification' in window

async function current(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready
  return await registration.pushManager.getSubscription()
}

async function stateNow(): Promise<AlertsState> {
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission === 'default') return 'ask'
  return (await current()) === null ? 'off' : 'on'
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

  const turnOn = useCallback(async () => {
    setBusy(true)
    try {
      if ((await Notification.requestPermission()) !== 'granted') return
      const registration = await navigator.serviceWorker.ready
      const { publicKey } = await api.push.key()
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      })
      await api.push.subscribe(PushSubscriptionInput.parse(subscription.toJSON()))
    } finally {
      setState(await stateNow())
      setBusy(false)
    }
  }, [])

  const turnOff = useCallback(async () => {
    setBusy(true)
    try {
      const subscription = await current()
      if (subscription === null) return
      await api.push.unsubscribe({ endpoint: subscription.endpoint })
      await subscription.unsubscribe()
    } finally {
      setState(await stateNow())
      setBusy(false)
    }
  }, [])

  return { state, busy, turnOn, turnOff }
}
