import { Platform } from 'react-native'

/**
 * One short tone when a rest is over (#24), made by the browser rather than played from a file —
 * nothing to bundle, nothing to fetch. Only while the app is open: an installed web app cannot be
 * relied on to sound in the background on an iPhone, so this is a nudge, never an alarm. Silent
 * where there is no Web Audio, natively too until a native build has a sound of its own (#10).
 */
export function chime(): void {
  if (Platform.OS !== 'web' || typeof AudioContext === 'undefined') return
  const audio = new AudioContext()
  const tone = audio.createOscillator()
  const volume = audio.createGain()
  tone.frequency.value = 880
  volume.gain.setValueAtTime(0.18, audio.currentTime)
  volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.6)
  tone.connect(volume).connect(audio.destination)
  tone.start()
  tone.stop(audio.currentTime + 0.6)
  tone.addEventListener('ended', () => {
    void audio.close()
  })
}
