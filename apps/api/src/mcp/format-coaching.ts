import {
  type Athlete,
  type AthleteNote,
  type Page,
  type SessionDetail,
  type SetLog,
  type WeightUnit,
  type WorkoutSessionSummary,
  counted,
  formatEffort,
  formatWeight,
  noteByline,
} from '@cedo/contract'
import { atRpe } from './format.ts'

/**
 * Coaching's lines (#11): who shares their training with you, and a run of someone's sessions —
 * compact text for the model to read, as `format.ts` is for the rest. See docs/07-mcp.md.
 */

/** `Sam Lee (@sam) · via Squad, Team · <id>` — the id is what every coaching tool takes. */
export const athleteLine = (athlete: Athlete): string =>
  `${athlete.user.displayName} (@${athlete.user.username}) · via ${athlete.groups.map((g) => g.name).join(', ')} · ${athlete.user.id}`

export const athleteLines = (athletes: readonly Athlete[]): string =>
  athletes.length === 0
    ? 'Nobody shares their training with a group you edit.'
    : athletes.map((a) => athleteLine(a)).join('\n')

/**
 * `2026-10-20 · PPL / Push · 18 sets · 4,250 kg · in progress · "felt heavy" · <id>`. The plan and
 * day read "unavailable" where the reader cannot see them (ADR-0019); the notes are the athlete's.
 */
export function sessionLine(session: WorkoutSessionSummary, unit: WeightUnit): string {
  const plan =
    session.workoutId === null
      ? 'no plan'
      : `${session.workoutName ?? 'unavailable plan'} / ${session.dayName ?? 'unavailable day'}`
  return [
    session.startedAt.slice(0, 10),
    plan,
    `${session.setCount} sets`,
    formatWeight(session.liftedG, unit),
    session.personalBests === 0 ? null : counted(session.personalBests, 'personal best'),
    session.endedAt === null ? 'in progress' : null,
    session.notes === null || session.notes === '' ? null : JSON.stringify(session.notes),
    session.id,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

export function sessionLines(sessions: Page<WorkoutSessionSummary>, unit: WeightUnit): string {
  if (sessions.items.length === 0) return 'No sessions.'
  const lines = sessions.items.map((s) => sessionLine(s, unit))
  return sessions.nextCursor === null
    ? lines.join('\n')
    : `${lines.join('\n')}\nMore: pass cursor ${sessions.nextCursor}`
}

/** `w5 × 40 kg @ RPE 8`, `w` for a warm-up — and ` [<id>]` when it is the reader's to fix (#31). */
const setText = (log: SetLog, unit: WeightUnit, withId: boolean): string =>
  `${log.isWarmup ? 'w' : ''}${formatEffort(log, log.exercise?.tracking ?? null, unit)}${atRpe(log.rpe)}${withId ? ` [${log.id}]` : ''}`

/** One set, by its exercise: `Bench Press: 5 × 80 kg [<id>]` — how a corrected set is answered. */
export const setLine = (log: SetLog, unit: WeightUnit): string =>
  `${log.exercise?.name ?? 'unavailable exercise'}: ${setText(log, unit, true)}`

/**
 * One session, set by set: a line per run of one exercise, in the order done — `Squad Sled Push: 5 ×
 * 80 kg, w5 × 40 kg @ RPE 8`, `w` for a warm-up. An exercise the reader cannot see is "unavailable
 * exercise", its efforts still said (ADR-0019): the sets are the athlete's, the name is not theirs.
 * Each set's id `withIds` — the reader's own, which `session_fix_set` takes (#31).
 */
export function sessionDetail(session: SessionDetail, unit: WeightUnit, withIds = false): string {
  const head = [
    session.startedAt.slice(0, 10),
    session.endedAt === null ? 'in progress' : null,
    session.notes === null || session.notes === '' ? null : JSON.stringify(session.notes),
  ]
    .filter((part) => part !== null)
    .join(' · ')
  const runs: SetLog[][] = []
  for (const log of session.logs) {
    const run = runs.at(-1)
    if (run?.[0]?.exerciseId === log.exerciseId) run.push(log)
    else runs.push([log])
  }
  const lines = runs.map((run) => {
    const sets = run.map((log) => setText(log, unit, withIds)).join(', ')
    return `${run[0]?.exercise?.name ?? 'unavailable exercise'}: ${sets}`
  })
  return [head, ...(lines.length === 0 ? ['No sets.'] : lines)].join('\n')
}

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
