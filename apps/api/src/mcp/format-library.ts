import {
  type AthleteEquipment,
  type Exercise,
  MISSING_EQUIPMENT,
  MUSCLES,
  type Media,
  type Page,
  type WeightUnit,
  counted,
  ownedLines,
  sayEquipment,
} from '@cedo/contract'
import type { LibraryAudit } from '../modules/review/curation.ts'
import { type GroupNameOf, ownership } from './format-group.ts'

/** The library as its tools print it, compact and by slug — see `format.ts`. */

/** Every muscle an exercise may load, by the slug the tools take, and the rule of their loads. */
export const muscleLines = (): string =>
  MUSCLES.map((m) => `${m.slug} (${m.region}) — ${m.name}`).join('\n') +
  `\n\n${MUSCLES.length} muscles. Loads on one exercise must sum to exactly 100.`

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
function exerciseLine(exercise: Exercise, groupNameOf: GroupNameOf): string {
  const flags = [
    ...ownership(exercise, groupNameOf),
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

/** A search's answer: a line an exercise, and — more than the page holds — that there is more. */
export const exerciseLines = (page: Page<Exercise>, groupNameOf: GroupNameOf): string =>
  page.items.length === 0
    ? 'No exercises matched.'
    : page.items.map((e) => exerciseLine(e, groupNameOf)).join('\n') +
      (page.nextCursor === null ? '' : '\n\n(more results exist; narrow the search)')

/** A link registered: the id an exercise's `mediaIds` takes, and whether it plays in place. */
export const mediaCreated = (media: Media): string =>
  `Created media ${media.id} (${media.kind}). Embeddable: ${media.embedUrl ?? 'no'}.`

const section = (title: string, lines: readonly string[]) =>
  lines.length === 0 ? `${title}: none` : `${title} (${lines.length}):\n  ${lines.join('\n  ')}`

/**
 * A library's problems, a section each and `none` where it has none: what to look at before
 * editing it. Says so when the duplicate scan did not reach every exercise.
 */
export const auditSummary = (audit: LibraryAudit): string =>
  [
    audit.scannedForDuplicates < audit.total
      ? `${counted(audit.total, 'exercise')} in this library. The duplicate scan compared the first ${audit.scannedForDuplicates} by name.`
      : `${counted(audit.total, 'exercise')} in this library.`,
    '',
    section(
      'Possible duplicates',
      audit.possibleDuplicates.map((d) => `"${d.a}" ~ "${d.b}"  (similarity ${d.similarity})`),
    ),
    section(
      'Thin muscle coverage',
      audit.thinCoverage.map((m) => `${m.muscle}: ${counted(m.exercises, 'exercise')}`),
    ),
    section('Missing instructions', audit.missingInstructions),
    section('Missing media', audit.missingMedia),
    section('Equipment not described', audit.undescribedEquipment),
    section(
      'Attributed to a single muscle (check these are really isolation lifts)',
      audit.singleMuscle,
    ),
  ].join('\n\n')

export function exerciseDetail(exercise: Exercise, groupNameOf: GroupNameOf): string {
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
    `owning group: ${groupNameOf(exercise.ownerGroupId)}`,
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
