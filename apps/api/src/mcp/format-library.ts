import {
  type AthleteEquipment,
  type Exercise,
  type WeightUnit,
  ownedLines,
  sayEquipment,
} from '@cedo/contract'

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

/** One line per exercise: enough to decide, not enough to bloat context. */
export function exerciseLine(exercise: Exercise): string {
  const flags = [
    exercise.tracking === 'weight_reps' ? null : exercise.tracking,
    exercise.isUnilateral ? 'unilateral' : null,
    exercise.canEdit ? null : 'read-only',
    exercise.doable ? null : 'not doable with your equipment',
  ].filter(Boolean)

  return [
    exercise.name,
    equipment(exercise),
    muscles(exercise),
    flags.length > 0 ? `[${flags.join(', ')}]` : '',
    exercise.id,
  ]
    .filter((part) => part !== '')
    .join(' | ')
}

export function exerciseDetail(exercise: Exercise): string {
  return [
    `${exercise.name}  (${exercise.id})`,
    `tracking: ${exercise.tracking}${exercise.isUnilateral ? ', unilateral' : ''}`,
    `needs: ${equipment(exercise)}${exercise.doable ? '' : ' — more than your equipment has'}`,
    `muscles: ${muscles(exercise)}`,
    exercise.description === '' ? null : `description: ${exercise.description}`,
    exercise.instructions === '' ? null : `instructions: ${exercise.instructions}`,
    exercise.media.length === 0
      ? 'media: none'
      : `media:\n${exercise.media.map((m) => `  - ${m.kind}: ${m.url}`).join('\n')}`,
    `editable: ${exercise.canEdit ? 'yes' : 'no (owned by another group)'}`,
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
