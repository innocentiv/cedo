/**
 * `bun run scripts/chime-wav.ts`, from `apps/app` — renders the rest-over chime the native app plays,
 * `assets/chime.wav`, from the numbers the web app makes it from
 * (`src/lib/chime-tone.ts`): sine beeps, each fading exponentially, as Web Audio draws
 * them there. Run it again after changing those numbers; the file it writes is committed.
 *
 * 16-bit mono PCM at 22.05 kHz: the beeps are 880 Hz, far below what the rate can carry, and the
 * file stays a few tens of kilobytes.
 */
import {
  BEEP_S,
  BEEP_STARTS_S,
  BEEPS,
  FADE_TO,
  GAP_S,
  PITCH_HZ,
  VOLUME,
} from '../src/lib/chime-tone.ts'

const RATE = 22_050
const HEADER_BYTES = 44
const BYTES_PER_SAMPLE = 2

const length = Math.ceil(((BEEPS - 1) * (BEEP_S + GAP_S) + BEEP_S) * RATE)
const wav = new DataView(new ArrayBuffer(HEADER_BYTES + length * BYTES_PER_SAMPLE))

function text(at: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) wav.setUint8(at + i, value.codePointAt(i) ?? 0)
}

text(0, 'RIFF')
wav.setUint32(4, wav.byteLength - 8, true)
text(8, 'WAVE')
text(12, 'fmt ')
wav.setUint32(16, 16, true)
wav.setUint16(20, 1, true) // PCM
wav.setUint16(22, 1, true) // mono
wav.setUint32(24, RATE, true)
wav.setUint32(28, RATE * BYTES_PER_SAMPLE, true)
wav.setUint16(32, BYTES_PER_SAMPLE, true)
wav.setUint16(34, BYTES_PER_SAMPLE * 8, true)
text(36, 'data')
wav.setUint32(40, length * BYTES_PER_SAMPLE, true)

const beepLength = Math.round(BEEP_S * RATE)
for (const start of BEEP_STARTS_S) {
  const first = Math.round(start * RATE)
  for (let n = 0; n < beepLength && first + n < length; n += 1) {
    const t = n / RATE
    const gain = VOLUME * (FADE_TO / VOLUME) ** (t / BEEP_S)
    const sample = Math.round(gain * Math.sin(2 * Math.PI * PITCH_HZ * t) * 32_767)
    wav.setInt16(HEADER_BYTES + (first + n) * BYTES_PER_SAMPLE, sample, true)
  }
}

const out = new URL('../assets/chime.wav', import.meta.url)
await Bun.write(out, new Uint8Array(wav.buffer))
console.log(`Wrote ${out.pathname}: ${wav.byteLength} bytes, ${(length / RATE).toFixed(2)} s.`)
