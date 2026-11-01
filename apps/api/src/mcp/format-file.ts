import {
  type AthleteNote,
  type Bodyweight,
  type TrainingReview,
  type WeightUnit,
  ageLine,
  formatCalendarDay,
  formatWeight,
  noteByline,
  trendLine,
} from '@cedo/contract'

/**
 * The athlete's file, compact for the model to read: their notes (#41), their weigh-ins and what a
 * review says of them (#42). See docs/07-mcp.md.
 */

/**
 * `Coach Kim · Mon 12 Oct · <id>`, then its words indented beneath — a note's id is what
 * `note_update` takes. Newest first, as written.
 */
export const noteLines = (notes: readonly AthleteNote[], readerId: string): string =>
  notes.length === 0
    ? 'No notes yet.'
    : notes
        .map((n) => `${noteByline(n, readerId)} · ${n.id}\n  ${n.text.replaceAll('\n', '\n  ')}`)
        .join('\n\n')

/** The trend first, then `2026-10-30 (Fri 30 Oct): 82.4 kg` a line, newest first. */
export function weighInLines(bodyweight: Bodyweight, weeks: number, unit: WeightUnit): string {
  const line = (w: Bodyweight['weighIns'][number]) =>
    `${w.day} (${formatCalendarDay(w.day)}): ${formatWeight(w.weightG, unit)}`
  const { weighIns, before } = bodyweight
  return [
    weighIns.length === 0
      ? `No weigh-ins in the last ${String(weeks)} weeks.`
      : `Weigh-ins in the last ${String(weeks)} weeks, newest first:\n  ${weighIns.map((w) => line(w)).join('\n  ')}`,
    ...(before === null ? [] : [`The latest before them: ${line(before)}`]),
  ].join('\n')
}

/** `Bodyweight 82.4 kg on Fri 30 Oct, −1.6 kg since Tue 1 Sep. Age 36 this year.` */
export function aboutLine(
  review: Pick<TrainingReview, 'bodyweight' | 'birthYear'>,
  unit: WeightUnit,
  now: Date,
): string {
  const weight =
    review.bodyweight === null
      ? 'No weigh-ins yet.'
      : `Bodyweight ${trendLine(review.bodyweight, unit)}.`
  const age =
    review.birthYear === null ? 'Age not given.' : `Age ${ageLine(review.birthYear, now)}.`
  return `${weight} ${age}`
}
