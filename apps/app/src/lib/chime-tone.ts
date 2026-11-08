/**
 * The tone when a rest is over (#24, #37), as numbers: three short beeps, and a buzz in their
 * rhythm. `chime.ts` plays it — made by the browser on the web, and on native from
 * `assets/chime.wav`, which is rendered from these numbers and nothing else:
 *
 *     bun run scripts/chime-wav.ts    # from apps/app
 *
 * Run it again after changing any of them. It imports neither React nor React Native, so the
 * script can read it.
 */
export const BEEPS = 3
export const BEEP_S = 0.18
export const GAP_S = 0.14
/** A2 on a clock's beeper: high enough to cut through a gym, loud enough to be heard there. */
export const PITCH_HZ = 880
export const VOLUME = 0.5
/** What each beep fades to, exponentially, as Web Audio's `exponentialRampToValueAtTime` does. */
export const FADE_TO = 0.0001

/** When each beep starts, in seconds after the first. */
export const BEEP_STARTS_S: readonly number[] = Array.from(
  { length: BEEPS },
  (_, i) => i * (BEEP_S + GAP_S),
)

/** The buzz keeps the beeps' rhythm: on for each, off between. */
export const BUZZ_MS: readonly number[] = Array.from({ length: BEEPS * 2 - 1 }, (_, i) =>
  Math.round((i % 2 === 0 ? BEEP_S : GAP_S) * 1000),
)
