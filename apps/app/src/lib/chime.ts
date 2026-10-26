import { Platform } from 'react-native'

/**
 * The tone when a rest is over (#24, #37): three short beeps, made by the browser — nothing
 * bundled, nothing fetched — and a buzz where the device has one. Only while the app is open: in the
 * background, a home-screen web app cannot be relied on to sound at all (#38).
 *
 * iOS lets a page make sound only from an audio context started by a tap. So the context is started
 * on the tap that logs a set (`primeChime`), and the beeps after that set's rest play through it;
 * until a set is logged on this open, the rest is silent. And iOS mutes a page's sound with the
 * silent switch, unless the page says it plays media, as a timer does (Safari 17's `audioSession`).
 */
let audio: AudioContext | null = null

const supported = (): boolean => Platform.OS === 'web' && typeof AudioContext !== 'undefined'

/** Heard through the silent switch, where the browser lets a page say it plays media. */
function asMedia(): void {
  const session: unknown = Reflect.get(navigator, 'audioSession')
  if (typeof session === 'object' && session !== null) Reflect.set(session, 'type', 'playback')
}

/** Called from a tap: starts — or resumes — the context the beeps will play through. */
export function primeChime(): void {
  if (!supported()) return
  asMedia()
  audio ??= new AudioContext()
  if (audio.state === 'suspended') void audio.resume()
}

const BEEPS = 3
const BEEP_S = 0.18
const GAP_S = 0.14

export function chime(): void {
  // A buzz where there is one — not an iPhone, from a web app — whether or not sound can play.
  if (Platform.OS === 'web' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([200, 120, 200, 120, 200])
  }
  if (audio?.state !== 'running') return
  for (let i = 0; i < BEEPS; i += 1) beep(audio, audio.currentTime + i * (BEEP_S + GAP_S))
}

function beep(context: AudioContext, at: number): void {
  const tone = context.createOscillator()
  const volume = context.createGain()
  tone.frequency.value = 880
  volume.gain.setValueAtTime(0.5, at)
  volume.gain.exponentialRampToValueAtTime(0.0001, at + BEEP_S)
  tone.connect(volume).connect(context.destination)
  tone.start(at)
  tone.stop(at + BEEP_S)
}
