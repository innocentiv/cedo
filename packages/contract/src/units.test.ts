import { describe, expect, test } from 'bun:test'
import {
  cmToMm,
  daysToMs,
  formatDuration,
  formatMinutes,
  formatWeight,
  gToKg,
  gToLb,
  kgToG,
  lbToG,
  minutesToS,
  mmToCm,
  msToDays,
  msToS,
  roundToIncrement,
  sToMs,
  weeksToMs,
} from './units.ts'

describe('weight conversion', () => {
  test('kilograms round-trip exactly at gym-realistic precision', () => {
    for (const kg of [0, 1.25, 2.5, 20, 60, 72.5, 102.5, 315.5]) {
      expect(gToKg(kgToG(kg))).toBe(kg)
    }
  })

  test('grams are always integers', () => {
    for (const kg of [1.234, 0.1, 62.4999, 99.999]) {
      expect(Number.isInteger(kgToG(kg))).toBe(true)
    }
  })

  /** The reason for integer base units: repeated float addition drifts, integers do not. */
  test('repeated increments do not accumulate float error', () => {
    let grams = kgToG(60)
    for (let i = 0; i < 200; i++) grams += kgToG(2.5)
    expect(grams).toBe(kgToG(560))
    expect(gToKg(grams)).toBe(560)
  })

  test('pounds convert on the exact international definition', () => {
    // 1 lb = 453.59237 g exactly, rounded to the nearest gram.
    expect(lbToG(1)).toBe(454)
    expect(lbToG(45)).toBe(20_412)
    expect(gToLb(kgToG(100))).toBeCloseTo(220.462, 3)
  })
})

describe('formatWeight', () => {
  test('trims trailing zeros but keeps meaningful decimals', () => {
    expect(formatWeight(kgToG(70), 'kg')).toBe('70 kg')
    expect(formatWeight(kgToG(72.5), 'kg')).toBe('72.5 kg')
    expect(formatWeight(kgToG(72.25), 'kg')).toBe('72.25 kg')
    expect(formatWeight(0, 'kg')).toBe('0 kg')
  })

  test('renders imperial on request — the only place imperial exists today', () => {
    expect(formatWeight(kgToG(100), 'lb')).toBe('220.46 lb')
  })
})

describe('roundToIncrement', () => {
  test('snaps to loadable weights', () => {
    expect(roundToIncrement(73_123, 2500)).toBe(72_500)
    expect(roundToIncrement(73_800, 2500)).toBe(75_000)
    expect(roundToIncrement(kgToG(60), 2500)).toBe(kgToG(60))
  })

  test('a non-positive increment is a no-op rather than a division by zero', () => {
    expect(roundToIncrement(1234, 0)).toBe(1234)
    expect(roundToIncrement(1234, -5)).toBe(1234)
  })
})

describe('distance and duration', () => {
  test('centimetres round-trip', () => {
    expect(mmToCm(cmToMm(180))).toBe(180)
    expect(Number.isInteger(cmToMm(180.4))).toBe(true)
  })

  /** As a clock — the form a duration is typed in, so what is read is what was typed. */
  test('durations read as a clock, with hours only when there are any', () => {
    expect(formatDuration(45)).toBe('0:45')
    expect(formatDuration(95)).toBe('1:35')
    expect(formatDuration(1500)).toBe('25:00')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(0)).toBe('0:00')
  })

  test('negative durations clamp rather than rendering nonsense', () => {
    expect(formatDuration(-10)).toBe('0:00')
  })

  test('how long a session took reads in minutes, and an hour and over as hours and minutes', () => {
    expect([3540, 3600, 3900, 5400].map((s) => formatMinutes(s))).toEqual([
      '59 min',
      '1 h',
      '1 h 5 min',
      '1 h 30 min',
    ])
  })
})

/** A clock on the device or the server reads milliseconds; every duration we keep is seconds. */
describe('time', () => {
  test('milliseconds and seconds convert both ways, exactly — the caller rounds as it means to', () => {
    expect(msToS(1500)).toBe(1.5)
    expect(msToS(90_000)).toBe(90)
    expect(sToMs(1.5)).toBe(1500)
    expect(sToMs(90)).toBe(90_000)
  })

  test('minutes to seconds, and days to milliseconds', () => {
    expect(minutesToS(15)).toBe(900)
    expect(daysToMs(1)).toBe(86_400_000)
    expect(daysToMs(30)).toBe(2_592_000_000)
  })

  test('weeks to milliseconds, and milliseconds to days, exactly', () => {
    expect(weeksToMs(1)).toBe(604_800_000)
    expect(weeksToMs(4)).toBe(2_419_200_000)
    expect(msToDays(129_600_000)).toBe(1.5)
    expect(msToDays(1_779_148_800_000)).toBe(20_592)
  })
})
