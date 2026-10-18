/**
 * What to call an exercise the API sent back as null — one the caller can no longer see, because
 * visibility is not permanent (docs/03-domain-model.md). Said the same way on every screen.
 */
export const exerciseName = (exercise: { readonly name: string } | null | undefined): string =>
  exercise?.name ?? 'Unavailable exercise'
