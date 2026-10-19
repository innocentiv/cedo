import type { WeightUnit } from '@cedo/contract'
import { useAuth } from '../auth/auth-provider.tsx'

/**
 * How the signed-in person reads and types weights — every weight on screen goes through it, so a
 * screen never assumes kilograms. Kilograms before anyone is signed in.
 */
export function useWeightUnit(): WeightUnit {
  return useAuth().me?.user.weightUnit ?? 'kg'
}
