import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { LogSetInput, WorkoutCreate, WorkoutPlanInput, formatWeight } from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import * as ProgressionService from '../../modules/progression/service.ts'
import * as SessionService from '../../modules/session/service.ts'
import * as WorkoutService from '../../modules/workout/service.ts'
import { trainingReview } from '../../modules/review/service.ts'
import { json, suggestionLines, text, workoutDetail, workoutLine } from '../format.ts'

const READ = { readOnlyHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const

/**
 * OBJECTIVE 2 — reviewing and adjusting someone's training.
 *
 * `training_review` is the entry point: one call returns what a coach would actually look at, so
 * the model does not have to page through every session and do date arithmetic itself.
 * See docs/07-mcp.md.
 */
export function registerTrainingTools(server: McpServer, caller: Caller): void {
  server.registerTool(
    'training_review',
    {
      title: 'Review recent training',
      description:
        'START HERE when asked about progress, consistency or what to change. Returns adherence ' +
        '(sessions per week, streak, longest gap), which planned days are being skipped, volume ' +
        'per muscle against the preceding period, and which exercises have stalled.',
      inputSchema: z.object({
        weeks: z.int().min(1).max(52).default(8).describe('How far back to look'),
      }),
      annotations: READ,
    },
    async ({ weeks }) => {
      const review = await trainingReview(caller, weeks)
      const a = review.adherence

      const lines = [
        `Last ${weeks} weeks: ${a.sessions} sessions (${a.perWeek}/week).`,
        a.lastSessionAt === null
          ? 'No sessions logged in this window.'
          : `Last session ${a.lastSessionAt}. Current streak ${a.currentStreakDays}, longest gap ${a.longestGapDays} days.`,
        '',
        review.dayBalance.length === 0
          ? 'No sessions were tied to a planned day (all ad hoc).'
          : `Planned days trained:\n  ${review.dayBalance
              .map((d) => `${d.workout} / ${d.day}: ${d.sessions}x`)
              .join('\n  ')}`,
        '',
        review.muscleVolume.length === 0
          ? 'No working volume recorded.'
          : `Volume by muscle (vs the preceding ${weeks} weeks):\n  ${review.muscleVolume
              .slice(0, 12)
              .map(
                (m) =>
                  `${m.muscle}: ${m.volumeKg}kg` +
                  (m.changePct === null
                    ? ' (no prior data)'
                    : ` (${m.changePct > 0 ? '+' : ''}${m.changePct}%)`),
              )
              .join('\n  ')}`,
        '',
        review.stalled.length === 0
          ? 'Nothing looks stalled.'
          : `Stalled (best set unchanged across 3+ sessions):\n  ${review.stalled
              .map(
                (s) =>
                  `${s.exercise}: ${s.sessions} sessions at ${s.bestWeightKg ?? '?'}kg × ${s.bestReps ?? '?'}`,
              )
              .join('\n  ')}`,
      ]
      return text(lines.join('\n'))
    },
  )

  server.registerTool(
    'workout_list',
    {
      title: 'List workouts',
      description: 'Workouts visible to you, as one line each ending with the id.',
      inputSchema: z.object({
        scope: z.enum(['all', 'mine', 'favourites']).default('all'),
        q: z.string().max(100).optional(),
        limit: z.int().min(1).max(100).default(30),
      }),
      annotations: READ,
    },
    async ({ scope, q, limit }) => {
      const page = await WorkoutService.list(caller, { scope, q, limit })
      return text(
        page.items.length === 0
          ? 'No workouts yet.'
          : page.items.map((w) => workoutLine(w)).join('\n'),
      )
    },
  )

  server.registerTool(
    'workout_get',
    {
      title: 'Get a workout plan',
      description:
        'The full plan as an outline: days, entries, supersets, prescribed sets and progression ' +
        'rules. Read this before changing a plan. Use `workout_get_editable` if you intend to ' +
        'rewrite it.',
      inputSchema: z.object({ workoutId: z.uuid() }),
      annotations: READ,
    },
    async ({ workoutId }) => text(workoutDetail(await WorkoutService.get(caller, workoutId))),
  )

  server.registerTool(
    'workout_get_editable',
    {
      title: 'Get a plan as editable JSON',
      description:
        'The same plan in exactly the shape `workout_save_plan` expects. Fetch this, modify it, ' +
        'and send it back — that round trip is why this returns JSON rather than an outline.',
      inputSchema: z.object({ workoutId: z.uuid() }),
      annotations: READ,
    },
    async ({ workoutId }) => {
      const workout = await WorkoutService.get(caller, workoutId)
      return json({
        days: workout.days.map((day) => ({
          name: day.name,
          entries: day.entries.map((entry) => ({
            exerciseId: entry.exerciseId,
            supersetGroup: entry.supersetGroup,
            restSeconds: entry.restSeconds,
            progression: entry.progression,
            sets: entry.sets.map((set) => ({
              targetReps: set.target.reps,
              targetWeightG: set.target.weightG,
              targetRpe: set.target.rpe,
              targetDurationS: set.target.durationS,
              targetDistanceMm: set.target.distanceMm,
              isWarmup: set.isWarmup,
            })),
          })),
        })),
      })
    },
  )

  server.registerTool(
    'workout_create',
    {
      title: 'Create an empty workout',
      description: 'Create a workout with no days. Follow with `workout_save_plan`.',
      inputSchema: WorkoutCreate,
      annotations: WRITE,
    },
    async (input) => {
      const created = await WorkoutService.create(caller, input)
      return text(`Created workout ${created.id} — "${created.name}". Now call workout_save_plan.`)
    },
  )

  server.registerTool(
    'workout_save_plan',
    {
      title: 'Save a whole workout plan',
      description:
        'Replace the ENTIRE plan atomically — days, entries and sets. Send the complete plan, not ' +
        'a patch: anything omitted is removed. Order comes from array position; never send an ' +
        'index. Every entry needs at least one non-warm-up set. Weights are in GRAMS.',
      inputSchema: WorkoutPlanInput.safeExtend({ workoutId: z.uuid() }),
      annotations: WRITE,
    },
    async ({ workoutId, days }) =>
      text(
        `Saved.\n\n${workoutDetail(await WorkoutService.replacePlan(caller, workoutId, { days }))}`,
      ),
  )

  server.registerTool(
    'workout_duplicate',
    {
      title: 'Duplicate a workout',
      description:
        'Deep-copy a workout and its whole plan into your own group so you can edit the copy. The ' +
        'usual way to personalise a shared programme.',
      inputSchema: z.object({ workoutId: z.uuid() }),
      annotations: WRITE,
    },
    async ({ workoutId }) => {
      const copy = await WorkoutService.duplicate(caller, workoutId)
      return text(`Copied to workout ${copy.id} — "${copy.name}", ${copy.days.length} day(s).`)
    },
  )

  server.registerTool(
    'workout_progression',
    {
      title: 'Suggest next targets',
      description:
        "What each entry's next target should be, computed from the caller's own logged history " +
        'by the same rules the app uses. Read-only: apply them with `workout_save_plan`.',
      inputSchema: z.object({ workoutId: z.uuid() }),
      annotations: READ,
    },
    async ({ workoutId }) =>
      text(suggestionLines(await ProgressionService.suggestForWorkout(caller, workoutId))),
  )

  server.registerTool(
    'exercise_history',
    {
      title: 'History for one exercise',
      description: 'Every logged session for one exercise, newest first, with each set.',
      inputSchema: z.object({
        exerciseId: z.uuid(),
        limit: z.int().min(1).max(200).default(20),
      }),
      annotations: READ,
    },
    async ({ exerciseId, limit }) => {
      const { history } = await import('../../modules/session/history.ts')
      const result = await history(caller, exerciseId, { limit })
      if (result.sessions.length === 0) return text('No sessions logged for this exercise.')

      return text(
        result.sessions
          .map((s) => {
            const sets = s.sets
              .map(
                (set) =>
                  `${set.isWarmup ? 'w' : ''}${set.reps ?? '?'}${set.weightG === null ? '' : `×${formatWeight(set.weightG)}`}`,
              )
              .join(', ')
            return `${s.performedAt.slice(0, 10)}: ${sets}`
          })
          .join('\n'),
      )
    },
  )

  server.registerTool(
    'session_log',
    {
      title: 'Log a training session',
      description:
        'Record a whole session in ONE call: starts it, logs every set, and finishes it. Use this ' +
        'rather than logging set by set. Weights are in GRAMS. Give `workoutId` and `dayId` to tie ' +
        'it to a plan, or omit both for ad-hoc training.',
      inputSchema: z.object({
        workoutId: z.uuid().nullable().default(null),
        dayId: z.uuid().nullable().default(null),
        notes: z.string().max(4000).nullable().default(null),
        sets: z.array(LogSetInput).min(1).max(200),
      }),
      annotations: WRITE,
    },
    async ({ workoutId, dayId, notes, sets }) => {
      const session = await SessionService.start(caller, { workoutId, dayId })
      for (const set of sets) {
        // Sequential on purpose: each set is validated against what the caller may see, and a
        // failure part-way leaves the session with what was logged rather than nothing.
        // oxlint-disable-next-line no-await-in-loop
        await SessionService.logSet(caller, session.id, set)
      }
      await SessionService.update(caller, session.id, {
        endedAt: new Date().toISOString(),
        notes,
      })
      return text(`Logged session ${session.id} with ${sets.length} set(s).`)
    },
  )
}
