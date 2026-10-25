import {
  type Athlete,
  type Page,
  type SessionDetail,
  type SetLog,
  type WeightUnit,
  type WorkoutSessionSummary,
  counted,
  formatEffort,
  formatWeight,
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

/**
 * One session, set by set: a line per run of one exercise, in the order done — `Squad Sled Push: 5 ×
 * 80 kg, w5 × 40 kg @ RPE 8`, `w` for a warm-up. An exercise the reader cannot see is "unavailable
 * exercise", its efforts still said (ADR-0019): the sets are the athlete's, the name is not theirs.
 */
export function sessionDetail(session: SessionDetail, unit: WeightUnit): string {
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
    const exercise = run[0]?.exercise ?? null
    const sets = run
      .map(
        (log) =>
          `${log.isWarmup ? 'w' : ''}${formatEffort(log, exercise?.tracking ?? null, unit)}${atRpe(log.rpe)}`,
      )
      .join(', ')
    return `${exercise?.name ?? 'unavailable exercise'}: ${sets}`
  })
  return [head, ...(lines.length === 0 ? ['No sets.'] : lines)].join('\n')
}
