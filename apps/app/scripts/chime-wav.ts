/**
 * `bun run scripts/chime-wav.ts`, from `apps/app` — renders the rest-over chime the native app plays,
 * and a rest's end told with the app closed (#39), `assets/chime.wav`, from the numbers the web app
 * makes it from (`src/lib/chime-tone.ts`): each tone of the plate as `toneGain` draws it, as Web
 * Audio does there, summed. Run it again after changing those numbers; the file it writes is
 * committed.
 *
 * 16-bit mono PCM at 22.05 kHz: the plate's highest overtone is under 4 kHz, far below what the
 * rate can carry, and the file stays under a hundred kilobytes — and a WAV of linear PCM, under
 * 30 s, is what iOS plays as a notification's sound.
 */
import { LENGTH_S, TONES, VOLUME, toneGain } from '../src/lib/chime-tone.ts'

const RATE = 22_050
const HEADER_BYTES = 44
const BYTES_PER_SAMPLE = 2

const length = Math.ceil(LENGTH_S * RATE)
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

for (let n = 0; n < length; n += 1) {
  const now = n / RATE
  // Each sine from the instant it is struck, as an oscillator started then would be.
  const level = TONES.reduce((sum, tone) => {
    const t = now - tone.atS
    return sum + toneGain(tone, t) * Math.sin(2 * Math.PI * tone.hz * t)
  }, 0)
  wav.setInt16(HEADER_BYTES + n * BYTES_PER_SAMPLE, Math.round(level * VOLUME * 32_767), true)
}

const out = new URL('../assets/chime.wav', import.meta.url)
await Bun.write(out, new Uint8Array(wav.buffer))
console.log(`Wrote ${out.pathname}: ${wav.byteLength} bytes, ${(length / RATE).toFixed(2)} s.`)
