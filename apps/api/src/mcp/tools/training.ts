import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  DuplicateInput,
  OfAthlete,
  WorkoutCreate,
  PlanSave,
  ReviewQuery,
  planSaveFrom,
} from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import { own, ownOrCoached } from '../../modules/coaching/training.ts'
import { trainingReview } from '../../modules/review/service.ts'
import { planFor, savePlanAndRead } from '../../modules/workout/plan-for.ts'
import * as ProgressionService from '../../modules/progression/service.ts'
import * as WorkoutService from '../../modules/workout/service.ts'
import {
  json,
  reviewSummary,
  suggestionLines,
  text,
  workoutDetail,
  workoutLine,
} from '../format.ts'
import { groupNamesOf } from '../format-group.ts'

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
        'have stalled — and their bodyweight, its change, and their age. Read note_list first: ' +
        'what they said of their training is there.',
      // The weeks to look back, as `GET /review` takes them: one schema, the contract's.
      inputSchema: ReviewQuery.safeExtend(OfAthlete.shape),
      annotations: READ,
    },
    async ({ weeks, athlete: athleteId }) =>
      text(
        reviewSummary(
          await trainingReview(await ownOrCoached(caller, athleteId), weeks),
          caller.weightUnit,
        ),
      ),
  )

  server.registerTool(
    'workout_list',
    {
      title: 'List workouts',
      description:
        'Workouts visible to you, as one line each ending with the id, after the group that ' +
        'owns it — mine, library, or a group by name.',
      inputSchema: z.object({
        scope: z.enum(['all', 'mine', 'favourites']).default('all'),
        q: z.string().max(100).optional(),
        limit: z.int().min(1).max(100).default(30),
      }),
      annotations: READ,
    },
    async ({ scope, q, limit }) => {
      const page = await WorkoutService.list(caller, { scope, q, limit })
      const groupNameOf = await groupNamesOf(caller)
      return text(
        page.items.length === 0
          ? 'No workouts yet.'
          : page.items.map((w) => workoutLine(w, groupNameOf)).join('\n'),
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
        'rewrite it. An exercise your equipment — or, with `athlete`, theirs — lacks is marked.',
      inputSchema: z.object({ workoutId: z.uuid() }).safeExtend(OfAthlete.shape),
      annotations: READ,
    },
    async ({ workoutId, athlete }) => {
      const { workout, held } = await planFor(await ownOrCoached(caller, athlete), workoutId)
      return text(workoutDetail(workout, caller.weightUnit, held, await groupNamesOf(caller)))
    },
  )

  server.registerTool(
    'workout_get_editable',
    {
      title: 'Get a plan as editable JSON',
      description:
        'The same plan in exactly the shape `workout_save_plan` expects. Fetch this, modify it, ' +
        'and send it back — that round trip is why this returns JSON rather than an outline. ' +
        'Keep each day and entry `id` you are not replacing: logged history and progression ' +
        'stay attached to them. Its `version` goes back with the save.',
      inputSchema: z.object({ workoutId: z.uuid() }),
      annotations: READ,
    },
    async ({ workoutId }) => json(planSaveFrom(await WorkoutService.get(own(caller), workoutId))),
  )

  server.registerTool(
    'workout_create',
    {
      title: 'Create an empty workout',
      description:
        'Create a workout with no days. Follow with `workout_save_plan`. Read note_list first: ' +
        'injuries, preferences and time away are noted there.',
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
        'worth 20 kg is -20000), allowed there only. A `targetRpe` is a CEILING, not an aim: ' +
        'write a range as its top (RPE 7-8 is 8). A working set logged more than half a point ' +
        'past it holds progression, as a missed rep does. Send back ' +
        'the `id` of each day and entry you keep (from `workout_get_editable`): that keeps its ' +
        'logged history and progression. An entry with no id, or whose exercise you changed, ' +
        'starts with no history. Send the `version` workout_get_editable gave: if the plan was ' +
        'changed since — by its owner, in the app — the save is refused, and you read it again. ' +
        'Read note_list before changing a plan, and plan around what it says.',
      inputSchema: PlanSave.safeExtend({ workoutId: z.uuid() }),
      annotations: WRITE,
    },
    async ({ workoutId, ...plan }) => {
      const { workout, held } = await savePlanAndRead(caller, workoutId, plan)
      return text(
        `Saved.\n\n${workoutDetail(workout, caller.weightUnit, held, await groupNamesOf(caller))}`,
      )
    },
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
        'by the same rules the app uses, and why each one that held did: short of its targets, ' +
        'or a set done past its RPE — that is effort, not a stall, and no reason to deload. ' +
        'Read-only: apply them with `workout_save_plan`, ' +
        'after reading note_list — a sore shoulder outranks a rule.',
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
}
