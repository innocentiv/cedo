import { describe, expect, test } from 'bun:test'
import {
  ALARM_EVERY_S,
  ATTACK_S,
  BUZZ_MS,
  FADE_TO,
  LENGTH_S,
  TAP_STARTS_S,
  TONES,
  VOLUME,
  toneGain,
} from './chime-tone.ts'

/**
 * The rest-over chime (#39): "Heavy plates", drawn the same by the browser and in the native app's
 * sound file — whose renderer reads `toneGain`, as Web Audio's ramps draw it.
 */

const [first] = TONES

describe('a tone of the chime', () => {
  test('starts silent, and is struck at its loudest an instant later', () => {
    if (first === undefined) throw new Error('no tone')
    expect(toneGain(first, 0)).toBeCloseTo(FADE_TO, 6)
    expect(toneGain(first, ATTACK_S)).toBeCloseTo(first.peak, 6)
  })

  test('fades exponentially to nothing, then stops', () => {
    if (first === undefined) throw new Error('no tone')
    const halfway = ATTACK_S + (first.decayS - ATTACK_S) / 2
    expect(toneGain(first, halfway)).toBeCloseTo(Math.sqrt(first.peak * FADE_TO), 6)
    expect(toneGain(first, first.decayS)).toBeCloseTo(FADE_TO, 6)
    expect(toneGain(first, first.stopS)).toBe(0)
    expect(toneGain(first, -0.01)).toBe(0)
  })
})

describe('the chime', () => {
  test('is three taps — two on one plate, then a higher one', () => {
    expect(TAP_STARTS_S).toEqual([0, 0.22, 0.44])
    const pitches = [...new Set(TONES.filter((tone) => tone.ratio === 1).map((tone) => tone.hz))]
    expect(pitches).toEqual([784, 1174.7])
  })

  /** A notification's sound must be under 30 s; and a chime long enough to be missed is no cue. */
  test('is over in under two seconds', () => {
    expect(LENGTH_S).toBeLessThan(2)
  })

  /** Every overtone at its loudest at once still stays under full scale: the file never clips. */
  test('never sums past full scale', () => {
    const loudest = Math.max(
      ...Array.from({ length: Math.ceil(LENGTH_S * 1000) }, (_, ms) =>
        TONES.reduce((sum, tone) => sum + toneGain(tone, ms / 1000 - tone.atS), 0),
      ),
    )
    expect(loudest * VOLUME).toBeLessThan(1)
  })

  /** An alarm repeats its sound until stopped: the chime, then a breath before the next. */
  test('as an alarm, comes round again after a pause', () => {
    expect(ALARM_EVERY_S - LENGTH_S).toBeGreaterThanOrEqual(1)
    expect(ALARM_EVERY_S).toBeLessThan(4)
  })

  /** The buzz, where there is one, on each tap. */
  test('buzzes on each tap, still between', () => {
    expect(BUZZ_MS).toEqual([80, 140, 80, 140, 80])
  })
})
