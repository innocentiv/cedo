import { Platform } from 'react-native'
import type * as ExpoAudio from 'expo-audio'
import { sToMs } from '@cedo/contract'
import restOver from '../../assets/chime.wav'
import { ATTACK_S, BUZZ_MS, FADE_TO, TAP_STARTS_S, TONES, type Tone, VOLUME } from './chime-tone.ts'

/**
 * The tone when a rest is over (#24, #37, #39): "Heavy plates", three taps on steel
 * (`chime-tone.ts`), and a buzz on each where the device has one. With the app closed, the phone
 * plays the same sound file as a notification's (#39).
 *
 * **On the web** the browser strikes the plate, each tone as `toneGain` draws it: the native
 * app's sound file is in the export, never fetched. iOS lets a page make sound only from an audio
 * context started by a tap. So the context is started on the tap that logs a set (`primeChime`),
 * and the chime after that set's rest plays through it; until a set is logged on this open, the
 * rest is silent. After the app has been in the background, the first tap anywhere starts it again
 * (`stale`, below). And iOS mutes a page's sound with the silent switch, unless the page says its
 * sound is an alert (Safari 17's `audioSession`).
 *
 * **On native** (#77) it is `assets/chime.wav`, rendered from the same numbers, played by
 * expo-audio through the silent switch, with the athlete's music lowered while it plays and given
 * back after — expo-audio ends its session when playback completes. The buzz is a tap of
 * expo-haptics on each tap of the plate. Both modules are imported lazily, so the web never
 * evaluates them.
 */
const isWeb = Platform.OS === 'web'

let audio: AudioContext | null = null

/**
 * The page has been out of sight since the context was started. iOS stops a home-screen app's
 * sound in the background, and the context it leaves reads `interrupted` — or `running`, and plays
 * nothing. Only one started from a tap sounds again, so the first tap after coming back starts a
 * new one, whatever it lands on (#39).
 */
let stale = false

const supported = (): boolean => isWeb && typeof AudioContext !== 'undefined'

/** From a tap: a context that will sound — the one kept, or a new one where it may not. */
function arm(): void {
  if (!supported()) return
  asAlert()
  if (audio !== null && (stale || audio.state !== 'running')) {
    void audio.close().catch(() => null)
    audio = null
  }
  audio ??= new AudioContext()
  if (audio.state !== 'running') void audio.resume()
  stale = false
}

if (supported()) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stale = true
  })
  // Only a context the rest has already used is started again; the first is started by the tap
  // that logs a set.
  const startAgain = (): void => {
    if (audio !== null && (stale || audio.state !== 'running')) arm()
  }
  // iOS counts the end of a touch, and a click, as a tap that may start sound.
  for (const tap of ['touchend', 'click'] as const) {
    document.addEventListener(tap, startAgain, { capture: true, passive: true })
  }
}

/**
 * Heard through the silent switch, where the browser lets a page say what its sound is: a short
 * alert (`transient`), which lowers the music the athlete trains to for a moment — `playback`
 * would stop it.
 */
function asAlert(): void {
  const session: unknown = Reflect.get(navigator, 'audioSession')
  if (typeof session === 'object' && session !== null) Reflect.set(session, 'type', 'transient')
}

/** Native: the player, made once — on the first tap that logs a set, or the first rest's end. */
let player: Promise<ExpoAudio.AudioPlayer> | null = null

async function makePlayer(): Promise<ExpoAudio.AudioPlayer> {
  const { createAudioPlayer, setAudioModeAsync } = await import('expo-audio')
  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    shouldPlayInBackground: false,
  })
  return createAudioPlayer(restOver)
}

function nativePlayer(): Promise<ExpoAudio.AudioPlayer> {
  player ??= makePlayer().catch((error: unknown) => {
    // Tried again at the next rest's end, rather than silent for the rest of the session.
    player = null
    throw error
  })
  return player
}

async function playNative(): Promise<void> {
  const ready = await nativePlayer()
  await ready.seekTo(0)
  ready.play()
}

async function buzzNative(): Promise<void> {
  const { impactAsync, ImpactFeedbackStyle } = await import('expo-haptics')
  for (const start of TAP_STARTS_S) {
    setTimeout(() => {
      void impactAsync(ImpactFeedbackStyle.Heavy)
    }, sToMs(start))
  }
}

/** Called from a tap: starts — or resumes — what the chime will play through. */
export function primeChime(): void {
  if (!isWeb) {
    nativePlayer().catch((error: unknown) => {
      console.warn('[chime] the rest-over sound could not be loaded', error)
    })
    return
  }
  arm()
}

export function chime(): void {
  if (!isWeb) {
    void buzzNative()
    playNative().catch((error: unknown) => {
      console.warn('[chime] the rest-over sound could not be played', error)
    })
    return
  }
  // A buzz where there is one — not an iPhone, from a web app — whether or not sound can play.
  if (typeof navigator.vibrate === 'function') navigator.vibrate([...BUZZ_MS])
  if (audio?.state !== 'running') return
  const from = audio.currentTime
  for (const tone of TONES) strike(audio, tone, from + tone.atS)
}

/** One sine of the chime, drawn as `toneGain` says — which the native app's sound file is too. */
function strike(context: AudioContext, tone: Tone, at: number): void {
  const sine = context.createOscillator()
  const loudness = context.createGain()
  sine.frequency.value = tone.hz
  loudness.gain.setValueAtTime(FADE_TO, at)
  loudness.gain.exponentialRampToValueAtTime(tone.peak * VOLUME, at + ATTACK_S)
  loudness.gain.exponentialRampToValueAtTime(FADE_TO, at + tone.decayS)
  sine.connect(loudness).connect(context.destination)
  sine.start(at)
  sine.stop(at + tone.stopS)
}
