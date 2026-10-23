import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  DuplicateInput,
  ExerciseHistoryQuery,
  SessionLogInput,
  WorkoutCreate,
  WorkoutPlanInput,
  planInputFrom,
} from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import * as ProgressionService from '../../modules/progression/service.ts'
import { logWhole } from '../../modules/session/start.ts'
import * as WorkoutService from '../../modules/workout/service.ts'
import { trainingReview } from '../../modules/review/service.ts'
import {
  historyLines,
  json,
  reviewSummary,
  suggestionLines,
  text,
  workoutDetail,
  workoutLine,
} from '../format.ts'

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
        '(sessions per week, streak, longest gap), which planned days are being skipped, working ' +
        'sets per muscle (and weight lifted) against the preceding period, and which exercises ' +
        'have stalled.',
      inputSchema: z.object({
        weeks: z.int().min(1).max(52).default(8).describe('How far back to look'),
      }),
      annotations: READ,
    },
    async ({ weeks }) =>
      text(reviewSummary(await trainingReview(caller, weeks), caller.weightUnit)),
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
    async ({ workoutId }) =>
      text(workoutDetail(await WorkoutService.get(caller, workoutId), caller.weightUnit)),
  )

  server.registerTool(
    'workout_get_editable',
    {
      title: 'Get a plan as editable JSON',
      description:
        'The same plan in exactly the shape `workout_save_plan` expects. Fetch this, modify it, ' +
        'and send it back — that round trip is why this returns JSON rather than an outline. ' +
        'Keep each day and entry `id` you are not replacing: logged history and progression ' +
        'stay attached to them.',
      inputSchema: z.object({ workoutId: z.uuid() }),
      annotations: READ,
    },
    async ({ workoutId }) => json(planInputFrom(await WorkoutService.get(caller, workoutId))),
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
        'index. Every entry needs at least one non-warm-up set. Weights are in GRAMS; on a ' +
        'bodyweight exercise a weight is ADDED load, and a negative one is assistance (a band ' +
        'worth 20 kg is -20000), allowed there only. Send back ' +
        'the `id` of each day and entry you keep (from `workout_get_editable`): that keeps its ' +
        'logged history and progression. An entry with no id, or whose exercise you changed, ' +
        'starts with no history.',
      inputSchema: WorkoutPlanInput.safeExtend({ workoutId: z.uuid() }),
      annotations: WRITE,
    },
    async ({ workoutId, days }) =>
      text(
        `Saved.\n\n${workoutDetail(await WorkoutService.replacePlan(caller, workoutId, { days }), caller.weightUnit)}`,
      ),
  )

  server.registerTool(
    'workout_duplicate',
    {
      title: 'Duplicate a workout',
      description:
        'Deep-copy a workout and its whole plan into a group you edit — your personal group ' +
        'unless `toGroupId` names another — so you can edit the copy. The usual way to ' +
        'personalise a shared workout.',
      inputSchema: DuplicateInput.safeExtend({ workoutId: z.uuid() }),
      annotations: WRITE,
    },
    async ({ workoutId, toGroupId }) => {
      const copy = await WorkoutService.duplicate(caller, workoutId, toGroupId)
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
      text(
        suggestionLines(
          await ProgressionService.suggestForWorkout(caller, workoutId),
          caller.weightUnit,
        ),
      ),
  )

  server.registerTool(
    'exercise_history',
    {
      title: 'History for one exercise',
      description:
        'Logged sessions for one exercise, newest first, with each set and its RPE, the ' +
        "session's best estimated max for a weight lift, and — when it has stalled — how many " +
        'sessions it has repeated one top set.',
      inputSchema: ExerciseHistoryQuery.safeExtend({ exerciseId: z.uuid() }),
      annotations: READ,
    },
    async ({ exerciseId, ...query }) => {
      const { history } = await import('../../modules/session/history.ts')
      return text(historyLines(await history(caller, exerciseId, query), caller.weightUnit))
    },
  )

  server.registerTool(
    'session_log',
    {
      title: 'Log a training session',
      description:
        'Record a whole, finished session in ONE call. All or nothing: if any set is invalid, ' +
        'nothing is logged, so fix it and retry. Weights are in GRAMS; on a bodyweight exercise ' +
        'a weight is ADDED load, and a negative one is assistance (a band), allowed there only. ' +
        'Sets are numbered for you, ' +
        'per plan entry (or per exercise, without one), in the order you send them, warm-ups ' +
        'included — send them in the order they were done. Give `workoutId` and ' +
        '`dayId` to tie it to a plan (then `entryId` may name the plan entry a set fulfils), or ' +
        'omit both for ad-hoc training.',
      inputSchema: SessionLogInput,
      annotations: WRITE,
    },
    async (input) => {
      const session = await logWhole(caller, input)
      return text(`Logged session ${session.id} with ${session.logs.length} set(s).`)
    },
  )
}
