/**
 * THE ONLY FILE PERMITTED TO CONVERT UNITS.
 *
 * Everything is stored and transmitted as integers in base units: grams, millimetres, seconds.
 * Integers because progression arithmetic must be exact — repeatedly adding 2.5 as a float drifts,
 * and Postgres `numeric` arrives in JavaScript as a string. Imperial support is therefore purely a
 * display concern: here, and in `dimension.ts`, which decides the unit a field is typed in.
 *
 * If you are about to write `/ 1000` or `* 2.2` anywhere else in this repository, stop and use a
 * function from this file. See docs/02-conventions.md.
 */

const GRAMS_PER_KILOGRAM = 1000
const GRAMS_PER_POUND = 453.592_37
const MILLIMETRES_PER_CENTIMETRE = 10
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

export type WeightUnit = 'kg' | 'lb'

export const kgToG = (kg: number): number => Math.round(kg * GRAMS_PER_KILOGRAM)
export const gToKg = (g: number): number => g / GRAMS_PER_KILOGRAM
export const lbToG = (lb: number): number => Math.round(lb * GRAMS_PER_POUND)
export const gToLb = (g: number): number => g / GRAMS_PER_POUND

export const cmToMm = (cm: number): number => Math.round(cm * MILLIMETRES_PER_CENTIMETRE)
export const mToMm = (m: number): number => Math.round(m * 1000)
export const mmToM = (mm: number): number => mm / 1000
export const mmToCm = (mm: number): number => mm / MILLIMETRES_PER_CENTIMETRE

/**
 * Round a weight to the nearest achievable increment — you cannot load 2.847 kg on a bar.
 * Used when a progression rule produces a target that must land on real plates.
 */
export const roundToIncrement = (grams: number, incrementG: number): number =>
  incrementG <= 0 ? grams : Math.round(grams / incrementG) * incrementG

/** `formatWeight(72500)` -> `'72.5 kg'`. Trailing zeros are trimmed: 70000 -> `'70 kg'`. */
export function formatWeight(grams: number, unit: WeightUnit = 'kg'): string {
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

/** `formatDuration(3725)` -> `'1h 2m'`; `formatDuration(95)` -> `'1m 35s'`; `formatDuration(45)` -> `'45s'`. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / SECONDS_PER_HOUR)
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const secs = total % SECONDS_PER_MINUTE

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

function trimZeros(fixed: string): string {
  return fixed.includes('.') ? fixed.replace(/\.?0+$/u, '') : fixed
}
