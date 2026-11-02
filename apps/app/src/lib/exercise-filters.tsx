import { useState } from 'react'
import type { MuscleSlug } from '@cedo/contract'
import { FilterRow, MuscleFilter } from '../ui/index.ts'
import { type DoableFilter, EquipmentFilter, useDoableFilter } from './doable-filter.tsx'
import { ALL, type ScopeChoice, ScopeFilter } from './scope-filter.tsx'

export interface ExerciseFilters {
  readonly scope: ScopeChoice
  readonly setScope: (scope: ScopeChoice) => void
  readonly muscle: MuscleSlug | null
  readonly setMuscle: (muscle: MuscleSlug | null) => void
  readonly doable: DoableFilter
  /** What the list query adds: the scope, the muscle, and everything or only the doable. */
  readonly query: ScopeChoice & { readonly muscle?: MuscleSlug; readonly showAll?: true }
}

/**
 * The three ways a list of exercises is narrowed (#52) — whose, what it works, what it needs — held
 * together, as the library and the picker both narrow theirs.
 */
export function useExerciseFilters(): ExerciseFilters {
  const [scope, setScope] = useState<ScopeChoice>(ALL)
  const [muscle, setMuscle] = useState<MuscleSlug | null>(null)
  const doable = useDoableFilter()
  return {
    scope,
    setScope,
    muscle,
    setMuscle,
    doable,
    query: { ...scope, ...doable.query, ...(muscle === null ? {} : { muscle }) },
  }
}

/** The three on one line, and — while any narrows the list — the × that puts them all back. */
export function ExerciseFilters({
  filters,
  testID,
}: {
  readonly filters: ExerciseFilters
  readonly testID: 'exercise' | 'picker'
}): React.JSX.Element {
  const { scope, muscle, doable } = filters
  const narrowed = scope.scope !== 'all' || muscle !== null || doable.showing !== 'doable'
  return (
    <FilterRow
      onClear={
        narrowed
          ? () => {
              filters.setScope(ALL)
              filters.setMuscle(null)
              doable.setShowing('doable')
            }
          : undefined
      }
      testID={`${testID}-filters`}
    >
      <ScopeFilter value={scope} onChange={filters.setScope} testID={`${testID}-scope`} />
      <MuscleFilter value={muscle} onChange={filters.setMuscle} testID={`${testID}-muscle`} />
      <EquipmentFilter filter={doable} testID={`${testID}-showing`} />
    </FilterRow>
  )
}
