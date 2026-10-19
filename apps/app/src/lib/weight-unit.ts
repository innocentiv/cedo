import { createContext, useContext } from 'react'
import type { WeightUnit } from '@cedo/contract'

/**
 * How the signed-in person reads and types weights. Every weight on screen goes through
 * `useWeightUnit()`, so no screen assumes kilograms.
 *
 * A context of its own, provided by `AuthProvider` from the account, rather than read from the auth
 * context: the field and logger primitives need the unit and nothing else about who is signed in,
 * and outside a provider — a primitive rendered alone — this is simply kilograms, never a throw.
 */
const WeightUnitContext = createContext<WeightUnit>('kg')

export const WeightUnitProvider = WeightUnitContext.Provider

export function useWeightUnit(): WeightUnit {
  return useContext(WeightUnitContext)
}
