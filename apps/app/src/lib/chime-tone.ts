/**
 * The tone when a rest is over (#24, #37, #39), as numbers: "Heavy plates" — a big steel plate
 * tapped twice, then a higher one left to ring — and a buzz on each tap. `chime.ts` plays it, made
 * by the browser on the web; the native app plays `assets/chime.wav`, as does a rest's end told
 * with the app closed, rendered from these numbers and nothing else:
 *
 *     bun run scripts/chime-wav.ts    # from apps/app
 *
 * Run it again after changing any of them. It imports neither React nor React Native, so the
 * script can read it. Chosen by ear from the candidates in #39.
 */

/** An overtone of a plate: its pitch as a ratio of the note's, its loudness, how much faster it fades. */
type Overtone = readonly [ratio: number, loudness: number, fade: number]

/**
 * A big plate: overtones close together, and slow to fade — weight more than ping. Not whole-number
 * ratios: struck metal is inharmonic, which is what makes it sound like steel and not a string.
 */
const HEAVY_PLATE: readonly Overtone[] = [
  [1, 1, 1],
  [1.47, 0.75, 1.15],
  [1.98, 0.5, 1.5],
  [2.62, 0.3, 2],
  [3.3, 0.15, 2.6],
]

/** A tap on the plate: its pitch, when, how long it rings, and how hard. */
interface Tap {
  readonly hz: number
  readonly atS: number
  readonly ringsS: number
  readonly gain: number
}

/** G5 twice, then D6 a fifth above, left to ring. */
const TAPS: readonly Tap[] = [
  { hz: 784, atS: 0, ringsS: 0.45, gain: 0.4 },
  { hz: 784, atS: 0.22, ringsS: 0.45, gain: 0.4 },
  { hz: 1174.7, atS: 0.44, ringsS: 1.2, gain: 0.45 },
]

/** The whole chime's loudness, as it was heard when chosen. */
export const VOLUME = 0.7
/** A strike: up to its loudest in 5 ms, which is too quick to hear as a fade and not a click. */
export const ATTACK_S = 0.005
/** What a tone fades to, exponentially — Web Audio's `exponentialRampToValueAtTime` cannot reach 0. */
export const FADE_TO = 0.0001
/** No overtone fades quicker than this, or it is a click rather than a ring. */
const SHORTEST_FADE_S = 0.03
/** Each tone sounds a little past its fade, so it is silent before it stops. */
const TAIL_S = 0.05

/** One sine of the chime, as both the browser and the native app's sound file draw it. */
export interface Tone {
  readonly hz: number
  readonly ratio: number
  /** When it is struck, in seconds after the first tap. */
  readonly atS: number
  readonly peak: number
  /** When, after it is struck, it has faded to `FADE_TO`. */
  readonly decayS: number
  /** When, after it is struck, it stops. */
  readonly stopS: number
}

export const TONES: readonly Tone[] = TAPS.flatMap((tap) =>
  HEAVY_PLATE.map(([ratio, loudness, fade]) => ({
    hz: tap.hz * ratio,
    ratio,
    atS: tap.atS,
    peak: tap.gain * loudness,
    decayS: Math.max(tap.ringsS / fade, SHORTEST_FADE_S),
    stopS: tap.ringsS + TAIL_S,
  })),
)

/**
 * A tone's loudness `t` seconds after it is struck, as Web Audio's exponential ramps draw it: up
 * from silence to its peak, then down to `FADE_TO`, and nothing once it stops.
 */
export function toneGain(tone: Tone, t: number): number {
  if (t < 0 || t >= tone.stopS) return 0
  if (t < ATTACK_S) return FADE_TO * (tone.peak / FADE_TO) ** (t / ATTACK_S)
  if (t < tone.decayS) {
    return tone.peak * (FADE_TO / tone.peak) ** ((t - ATTACK_S) / (tone.decayS - ATTACK_S))
  }
  return FADE_TO
}

/** When each tap is struck, in seconds after the first. */
export const TAP_STARTS_S: readonly number[] = TAPS.map((tap) => tap.atS)

/** From the first tap until the last tone stops. */
export const LENGTH_S = Math.max(...TONES.map((tone) => tone.atS + tone.stopS))

/** How long the buzz lasts on each tap, where a browser can vibrate. */
const BUZZ_ON_MS = 80

/** The buzz on each tap, still between: on, off, on… as `navigator.vibrate` takes it. */
export const BUZZ_MS: readonly number[] = TAP_STARTS_S.flatMap((start, i) => {
  const previous = TAP_STARTS_S[i - 1]
  return previous === undefined
    ? [BUZZ_ON_MS]
    : [Math.round((start - previous) * 1000) - BUZZ_ON_MS, BUZZ_ON_MS]
})
