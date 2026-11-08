import { Platform } from 'react-native'
import type * as ExpoAudio from 'expo-audio'
import restOver from '../../assets/chime.wav'
import { BEEP_S, BEEP_STARTS_S, BUZZ_MS, FADE_TO, PITCH_HZ, VOLUME } from './chime-tone.ts'

/**
 * The tone when a rest is over (#24, #37): three short beeps (`chime-tone.ts`), and a buzz in their
 * rhythm where the device has one. Only while the app is open: told with it closed is #39.
 *
 * **On the web** the browser makes the beeps: the native app's sound file is in the export, never
 * fetched. iOS lets a page
 * make sound only from an audio context started by a tap. So the context is started on the tap that
 * logs a set (`primeChime`), and the beeps after that set's rest play through it; until a set is
 * logged on this open, the rest is silent. And iOS mutes a page's sound with the silent switch,
 * unless the page says its sound is an alert (Safari 17's `audioSession`).
 *
 * **On native** (#77) they are `assets/chime.wav`, rendered from the same numbers, played by
 * expo-audio through the silent switch, with the athlete's music lowered while they play and given
 * back after — expo-audio ends its session when playback completes. The buzz is three taps of
 * expo-haptics at the beeps' starts. Both modules are imported lazily, so the web never evaluates
 * them.
 */
const isWeb = Platform.OS === 'web'

let audio: AudioContext | null = null

const supported = (): boolean => isWeb && typeof AudioContext !== 'undefined'

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
  for (const start of BEEP_STARTS_S) {
    setTimeout(() => {
      void impactAsync(ImpactFeedbackStyle.Heavy)
    }, start * 1000)
  }
}

/** Called from a tap: starts — or resumes — what the beeps will play through. */
export function primeChime(): void {
  if (!isWeb) {
    nativePlayer().catch((error: unknown) => {
      console.warn('[chime] the rest-over sound could not be loaded', error)
    })
    return
  }
  if (!supported()) return
  asAlert()
  audio ??= new AudioContext()
  if (audio.state === 'suspended') void audio.resume()
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
  for (const start of BEEP_STARTS_S) beep(audio, audio.currentTime + start)
}

function beep(context: AudioContext, at: number): void {
  const tone = context.createOscillator()
  const volume = context.createGain()
  tone.frequency.value = PITCH_HZ
  volume.gain.setValueAtTime(VOLUME, at)
  volume.gain.exponentialRampToValueAtTime(FADE_TO, at + BEEP_S)
  tone.connect(volume).connect(context.destination)
  tone.start(at)
  tone.stop(at + BEEP_S)
}
