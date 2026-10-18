import type { WorkoutSummary } from '@cedo/contract'
import type { WorkoutRow } from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { ownableFieldsOf } from '../ownable/service.ts'

export function toSummary(
  row: WorkoutRow,
  dayCount: number,
  isFavourite: boolean,
  caller: Caller,
): WorkoutSummary {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    dayCount,
    ...ownableFieldsOf(row, isFavourite, caller),
  }
}
