import { Platform } from 'react-native'

/**
 * One short tone when a rest is over (#24), made by the browser — nothing bundled, nothing fetched.
 * Only while the app is open: an installed web app cannot be relied on to sound in the background on
 * an iPhone, so this is a nudge, never an alarm.
 *
 * iOS lets a page make sound only from an audio context started by a tap. So the context is started
 * on the tap that logs a set (`primeChime`), and the tone after that set's rest plays through it;
 * until a set is logged on this open, the rest is silent.
 */
let audio: AudioContext | null = null

const supported = (): boolean => Platform.OS === 'web' && typeof AudioContext !== 'undefined'

/** Called from a tap: starts — or resumes — the context the tone will play through. */
export function primeChime(): void {
  if (!supported()) return
  audio ??= new AudioContext()
  if (audio.state === 'suspended') void audio.resume()
}

export function chime(): void {
  if (audio?.state !== 'running') return
  const tone = audio.createOscillator()
  const volume = audio.createGain()
  tone.frequency.value = 880
  volume.gain.setValueAtTime(0.18, audio.currentTime)
  volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.6)
  tone.connect(volume).connect(audio.destination)
  tone.start()
  tone.stop(audio.currentTime + 0.6)
}
