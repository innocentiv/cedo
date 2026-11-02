import {
  type AthleteEquipment,
  type Exercise,
  MISSING_EQUIPMENT,
  type WeightUnit,
  ownedLines,
  sayEquipment,
} from '@cedo/contract'
import { type OwnerOf, ownership } from './format-owner.ts'

/** An exercise as the library tools print it, compact and by slug — see `format.ts`. */

const muscles = (exercise: Exercise) =>
  exercise.muscles
    .toSorted((a, b) => b.loadPct - a.loadPct)
    .map((m) => `${m.muscle} ${m.loadPct}%`)
    .join(', ')

/** What it needs, as `exercise_update` takes it (#33) — needing nothing apart from unsaid. */
const equipment = ({ equipment: items }: Exercise): string =>
  sayEquipment(items, {
    unsaid: 'equipment not described',
    nothing: 'no equipment',
    listed: (slugs) => slugs.join(' + '),
  })

/**
 * One line per exercise: enough to decide, not enough to bloat context. Its flags lead with the
 * owning group (#47), so a copy never reads like the exercise it was copied from.
 */
export function exerciseLine(exercise: Exercise, ownerOf: OwnerOf): string {
  const flags = [
    ...ownership(exercise, ownerOf),
    exercise.tracking === 'weight_reps' ? null : exercise.tracking,
    exercise.isUnilateral ? 'unilateral' : null,
    exercise.doable ? null : MISSING_EQUIPMENT,
  ].filter(Boolean)

  return [
    exercise.name,
    equipment(exercise),
    muscles(exercise),
    `[${flags.join(', ')}]`,
    exercise.id,
  ].join(' | ')
}

export function exerciseDetail(exercise: Exercise, ownerOf: OwnerOf): string {
  return [
    `${exercise.name}  (${exercise.id})`,
    `tracking: ${exercise.tracking}${exercise.isUnilateral ? ', unilateral' : ''}`,
    `needs: ${equipment(exercise)}${exercise.doable ? '' : ` [${MISSING_EQUIPMENT}]`}`,
    `muscles: ${muscles(exercise)}`,
    exercise.description === '' ? null : `description: ${exercise.description}`,
    exercise.instructions === '' ? null : `instructions: ${exercise.instructions}`,
    exercise.media.length === 0
      ? 'media: none'
      : `media:\n${exercise.media.map((m) => `  - ${m.kind}: ${m.url}`).join('\n')}`,
    `owner: ${ownerOf(exercise.ownerGroupId)}`,
    `editable: ${exercise.canEdit ? 'yes' : 'no'}`,
  ]
    .filter((line) => line !== null)
    .join('\n')
}

/**
 * What someone has to train with (#34), an item a line by the slugs `equipment_set` takes, a
 * weighted one with how its weights go — and undescribed told apart from nothing at all.
 */
export const equipmentLines = (owned: AthleteEquipment, unit: WeightUnit): string =>
  ownedLines(owned, unit, {
    unsaid: 'Not described yet: every exercise counts as doable.',
    nothing: 'No equipment at all.',
    name: (slug) => slug,
  }).join('\n')
