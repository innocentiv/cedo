import { z } from 'zod'

/**
 * Muscles are a hardcoded set — human anatomy does not vary by deployment, so this is a constant
 * rather than user data. `seed.ts` upserts it into the `muscles` table so exercises still get
 * foreign-key integrity and joinability, but THIS ARRAY IS THE SOURCE OF TRUTH.
 *
 * To add a muscle: add it at the end of its region, then re-run the seed — the order here is the
 * picker's, re-derived into `sort_index` on every seed. The end of its region, not the top: the
 * perf seed weights its data by that order, toward the first muscles. Never insert one directly
 * into the database.
 */
export const MUSCLE_REGIONS = ['upper', 'core', 'lower'] as const
export const MuscleRegion = z.enum(MUSCLE_REGIONS)

/** A region as a person reads it: where the muscle filter groups its choices (#27). */
export const MUSCLE_REGION_LABELS: Readonly<Record<(typeof MUSCLE_REGIONS)[number], string>> = {
  upper: 'Upper body',
  core: 'Core',
  lower: 'Lower body',
}
export type MuscleRegion = z.output<typeof MuscleRegion>

export const MUSCLES = [
  // upper — shoulders and chest
  { slug: 'deltoid_anterior', name: 'Front delt', region: 'upper' },
  { slug: 'deltoid_lateral', name: 'Side delt', region: 'upper' },
  { slug: 'deltoid_posterior', name: 'Rear delt', region: 'upper' },
  { slug: 'pectoralis_major', name: 'Chest', region: 'upper' },
  { slug: 'serratus_anterior', name: 'Serratus', region: 'upper' },
  { slug: 'rotator_cuff', name: 'Rotator cuff', region: 'upper' },
  // upper — back
  { slug: 'latissimus_dorsi', name: 'Lats', region: 'upper' },
  { slug: 'trapezius_upper', name: 'Upper traps', region: 'upper' },
  { slug: 'trapezius_middle', name: 'Mid traps', region: 'upper' },
  { slug: 'trapezius_lower', name: 'Lower traps', region: 'upper' },
  { slug: 'rhomboids', name: 'Rhomboids', region: 'upper' },
  { slug: 'teres_major', name: 'Teres major', region: 'upper' },
  // upper — arms
  { slug: 'biceps_brachii', name: 'Biceps', region: 'upper' },
  { slug: 'brachialis', name: 'Brachialis', region: 'upper' },
  { slug: 'brachioradialis', name: 'Brachioradialis', region: 'upper' },
  { slug: 'triceps_brachii', name: 'Triceps', region: 'upper' },
  { slug: 'forearm_flexors', name: 'Forearm flexors', region: 'upper' },
  { slug: 'forearm_extensors', name: 'Forearm extensors', region: 'upper' },
  // upper — neck: flexion (curls) and extension trained, and so counted, apart
  { slug: 'neck_flexors', name: 'Neck (front)', region: 'upper' },
  { slug: 'neck_extensors', name: 'Neck (back)', region: 'upper' },
  // core
  { slug: 'rectus_abdominis', name: 'Abs', region: 'core' },
  { slug: 'obliques', name: 'Obliques', region: 'core' },
  { slug: 'transverse_abdominis', name: 'Deep core', region: 'core' },
  { slug: 'erector_spinae', name: 'Spinal erectors', region: 'core' },
  { slug: 'quadratus_lumborum', name: 'QL', region: 'core' },
  // lower
  { slug: 'gluteus_maximus', name: 'Glute max', region: 'lower' },
  { slug: 'gluteus_medius', name: 'Glute med', region: 'lower' },
  { slug: 'quadriceps', name: 'Quads', region: 'lower' },
  { slug: 'hamstrings', name: 'Hamstrings', region: 'lower' },
  { slug: 'adductors', name: 'Adductors', region: 'lower' },
  { slug: 'hip_flexors', name: 'Hip flexors', region: 'lower' },
  { slug: 'gastrocnemius', name: 'Calves (gastroc)', region: 'lower' },
  { slug: 'soleus', name: 'Calves (soleus)', region: 'lower' },
  { slug: 'tibialis_anterior', name: 'Tibialis anterior', region: 'lower' },
] as const satisfies readonly { slug: string; name: string; region: MuscleRegion }[]

export const MUSCLE_SLUGS = MUSCLES.map((m) => m.slug)

/**
 * A real `z.enum`, not a refinement, so `z.toJSONSchema` emits the full list of valid values.
 * That list is what an AI calling an MCP tool sees, so it must be enumerated, not validated blind.
 */
export const MuscleSlug = z.enum(MUSCLE_SLUGS)
export type MuscleSlug = z.output<typeof MuscleSlug>

/** An exercise's muscles as read: most worked first, each by its name. */
export const musclesByLoad = (
  muscles: readonly { readonly muscle: string; readonly loadPct: number }[],
): { readonly name: string; readonly loadPct: number }[] =>
  muscles
    .toSorted((a, b) => b.loadPct - a.loadPct)
    .map((m) => ({
      name: MUSCLES.find((x) => x.slug === m.muscle)?.name ?? m.muscle,
      loadPct: m.loadPct,
    }))

/**
 * `Quads, Glute max, Adductors`: what an exercise mostly works, in one line, most loaded first — an
 * exercise's row in a list says it (#27).
 */
export const mainMuscles = (
  muscles: readonly { readonly muscle: string; readonly loadPct: number }[],
): string =>
  musclesByLoad(muscles)
    .slice(0, 3)
    .map((m) => m.name)
    .join(', ')
