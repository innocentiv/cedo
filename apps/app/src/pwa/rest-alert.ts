/**
 * What the service worker reads of a rest alert (#38), and the key a device subscribes with — plain,
 * so tested beside it, with nothing of the app's bundle in the worker's: no contract, no zod.
 */

export interface PushedAlert {
  readonly title: string
  readonly body: string
  /** Where tapping it goes: a path of this app's, never another site. */
  readonly url: string
}

const text = (value: unknown, key: string): string | null => {
  const field: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, key) : null
  return typeof field === 'string' ? field : null
}

/** A push's payload as an alert, or null when it is not one — then the worker says only the rest is over. */
export function alertOf(payload: unknown): PushedAlert | null {
  const title = text(payload, 'title')
  const body = text(payload, 'body')
  const url = text(payload, 'url')
  if (title === null || body === null || url === null) return null
  // A path of this app's: a payload naming another site — `//host`, or `/\host`, which a browser
  // reads the same — opens the app instead.
  const own = url.startsWith('/') && url[1] !== '/' && url[1] !== '\\'
  return { title, body, url: own ? url : '/' }
}

/** The server's public key, as the browser's `applicationServerKey` takes it: base64url to bytes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.codePointAt(i) ?? 0
  return bytes
}

/**
 * Rest alerts on this device, as Settings and the rest band say it:
 *
 * - `unsupported`: this browser cannot be told — on an iPhone, cedo not on the home screen.
 * - `ask`: not answered yet — the rest band offers it.
 * - `on`, `off`: answered, and this device is, or is not, told.
 * - `blocked`: refused in the browser's settings, which only those can undo.
 */
export type AlertsState = 'unsupported' | 'ask' | 'on' | 'off' | 'blocked'

export function alertsStateOf(device: {
  readonly supported: boolean
  readonly permission: 'default' | 'granted' | 'denied'
  readonly subscribed: boolean
}): AlertsState {
  if (!device.supported) return 'unsupported'
  if (device.permission === 'denied') return 'blocked'
  if (device.permission === 'default') return 'ask'
  return device.subscribed ? 'on' : 'off'
}
