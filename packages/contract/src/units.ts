import { z } from 'zod'

/**
 * THE ONLY FILE PERMITTED TO CONVERT UNITS.
 *
 * Everything is stored and transmitted as integers in base units: grams, millimetres, seconds.
 * Integers because progression arithmetic must be exact — repeatedly adding 2.5 as a float drifts,
 * and Postgres `numeric` arrives in JavaScript as a string. Imperial support is therefore purely a
 * display concern: here, and in `dimension.ts`, which decides the unit a field is typed in — and
`typing.ts`, which reads a clock's digits through `clockToS` below.
 *
 * If you are about to write `/ 1000` or `* 2.2` anywhere else in this repository, stop and use a
 * function from this file — time included: a clock reads milliseconds, and every duration we keep
 * is seconds. `test/unit-conversions.test.ts` fails on a conversion factor anywhere else. See
 * docs/02-conventions.md, "Units".
 */

const GRAMS_PER_KILOGRAM = 1000
const GRAMS_PER_POUND = 453.592_37
const MILLIMETRES_PER_CENTIMETRE = 10
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const MINUTES_PER_HOUR = 60
const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_DAY = 86_400
const DAYS_PER_WEEK = 7

/** How a person reads and types a weight — their preference, `Account.weightUnit`. Grams either way. */
export const WEIGHT_UNITS = ['kg', 'lb'] as const
export const WeightUnit = z.enum(WEIGHT_UNITS)
export type WeightUnit = z.output<typeof WeightUnit>

export const kgToG = (kg: number): number => Math.round(kg * GRAMS_PER_KILOGRAM)
export const gToKg = (g: number): number => g / GRAMS_PER_KILOGRAM
export const lbToG = (lb: number): number => Math.round(lb * GRAMS_PER_POUND)
export const gToLb = (g: number): number => g / GRAMS_PER_POUND
/**
 * A weight as a person reads it in a field: to the hundredth, as `formatWeight` writes it. Grams are
 * not a whole number of pounds, so 135 lb is stored as 61 235 g and must read back as 135, not the
 * 134.9997 it exactly is. And kilograms likewise: a set logged as 132.5 lb is 60 101 g, which reads
 * "60.1 kg" everywhere — the field showed "60.101" beside it.
 */
export const gToLbShown = (g: number): number => Number(gToLb(g).toFixed(2))
export const gToKgShown = (g: number): number => Number(gToKg(g).toFixed(2))

export const cmToMm = (cm: number): number => Math.round(cm * MILLIMETRES_PER_CENTIMETRE)
export const mToMm = (m: number): number => Math.round(m * 1000)
export const mmToM = (mm: number): number => mm / 1000
export const mmToCm = (mm: number): number => mm / MILLIMETRES_PER_CENTIMETRE

/**
 * Round a weight to the nearest increment — you cannot load 2.847 kg on a bar, and an estimate is
 * no more precise than half a kilogram (`estimatedMax`).
 */
export const roundToIncrement = (grams: number, incrementG: number): number =>
  incrementG <= 0 ? grams : Math.round(grams / incrementG) * incrementG

/** `formatWeight(72500)` -> `'72.5 kg'`. Trailing zeros are trimmed: 70000 -> `'70 kg'`. */
export function formatWeight(grams: number, unit: WeightUnit): string {
  const value = unit === 'kg' ? gToKg(grams) : gToLb(grams)
  return `${trimZeros(value.toFixed(2))} ${unit}`
}

/** `formatDistance(5000)` -> `'5 m'`; `formatDistance(5_000_000)` -> `'5 km'`. */
export function formatDistance(millimetres: number): string {
  const metres = mmToM(millimetres)
  return metres >= 1000
    ? `${trimZeros((metres / 1000).toFixed(2))} km`
    : `${trimZeros(metres.toFixed(1))} m`
}

/**
 * A clock, as a duration is typed: `formatDuration(45)` -> `'0:45'`, `95` -> `'1:35'`, `1500` ->
 * `'25:00'`, `3725` -> `'1:02:05'`. It used to read `1m 35s` while the field took plain seconds, so
 * what you read was not what you typed. See `CLOCK` in typing.ts.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / SECONDS_PER_HOUR)
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const secs = String(total % SECONDS_PER_MINUTE).padStart(2, '0')

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`
}

/** A clock's parts to seconds: `clockToS(1, 2, 5)` -> 3725. Seconds past 59 are added as given. */
export const clockToS = (hours: number, minutes: number, seconds: number): number =>
  hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds

/** `52 min`, `1 h 5 min`: how long a session took, as a history row says it. */
export function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return `${String(minutes)} min`
  const rest = minutes % MINUTES_PER_HOUR
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  return `${String(hours)} h${rest === 0 ? '' : ` ${String(rest)} min`}`
}

/**
 * A clock — `Date.now()`, `Date.parse`, a timer — reads milliseconds; a duration we keep is seconds.
 * Exact both ways: the caller rounds, floors or ceils as it means to.
 */
export const msToS = (ms: number): number => ms / MILLISECONDS_PER_SECOND
export const sToMs = (s: number): number => s * MILLISECONDS_PER_SECOND
export const minutesToS = (minutes: number): number => minutes * SECONDS_PER_MINUTE
export const daysToMs = (days: number): number => sToMs(days * SECONDS_PER_DAY)
export const weeksToMs = (weeks: number): number => daysToMs(weeks * DAYS_PER_WEEK)
/** Days since the epoch when given `Date.now()`, so a floor of it is a UTC day. */
export const msToDays = (ms: number): number => msToS(ms) / SECONDS_PER_DAY

function trimZeros(fixed: string): string {
  return fixed.includes('.') ? fixed.replace(/\.?0+$/u, '') : fixed
}
