import { Platform } from 'react-native'

/**
 * The tone when a rest is over (#24, #37): three short beeps, made by the browser — nothing
 * bundled, nothing fetched — and a buzz where the device has one. Only while the app is open: in the
 * background, a home-screen web app cannot be relied on to sound at all (#38).
 *
 * iOS lets a page make sound only from an audio context started by a tap. So the context is started
 * on the tap that logs a set (`primeChime`), and the beeps after that set's rest play through it;
 * until a set is logged on this open, the rest is silent. And iOS mutes a page's sound with the
 * silent switch, unless the page says its sound is an alert (Safari 17's `audioSession`).
 */
let audio: AudioContext | null = null

const supported = (): boolean => Platform.OS === 'web' && typeof AudioContext !== 'undefined'

/**
 * Heard through the silent switch, where the browser lets a page say what its sound is: a short
 * alert (`transient`), which lowers the music the athlete trains to for a moment — `playback`
 * would stop it.
 */
function asAlert(): void {
  const session: unknown = Reflect.get(navigator, 'audioSession')
  if (typeof session === 'object' && session !== null) Reflect.set(session, 'type', 'transient')
}

/** Called from a tap: starts — or resumes — the context the beeps will play through. */
export function primeChime(): void {
  if (!supported()) return
  asAlert()
  audio ??= new AudioContext()
  if (audio.state === 'suspended') void audio.resume()
}

const BEEPS = 3
const BEEP_S = 0.18
const GAP_S = 0.14
/** A2 on a clock's beeper: high enough to cut through a gym, loud enough to be heard there. */
const PITCH_HZ = 880
const VOLUME = 0.5
/** The buzz keeps the beeps' rhythm: on for each, off between. */
const BUZZ_MS = Array.from({ length: BEEPS * 2 - 1 }, (_, i) =>
  Math.round((i % 2 === 0 ? BEEP_S : GAP_S) * 1000),
)

export function chime(): void {
  // A buzz where there is one — not an iPhone, from a web app — whether or not sound can play.
  if (Platform.OS === 'web' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(BUZZ_MS)
  }
  if (audio?.state !== 'running') return
  for (let i = 0; i < BEEPS; i += 1) beep(audio, audio.currentTime + i * (BEEP_S + GAP_S))
}

function beep(context: AudioContext, at: number): void {
  const tone = context.createOscillator()
  const volume = context.createGain()
  tone.frequency.value = PITCH_HZ
  volume.gain.setValueAtTime(VOLUME, at)
  volume.gain.exponentialRampToValueAtTime(0.0001, at + BEEP_S)
  tone.connect(volume).connect(context.destination)
  tone.start(at)
  tone.stop(at + BEEP_S)
}
