import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  DuplicateInput,
  OfAthlete,
  ScopeFields,
  WorkoutCreate,
  WorkoutUpdate,
  PlanSave,
  type ProgressionSuggestion,
  ReviewQuery,
  TargetByHand,
  planSaveFrom,
} from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import { own, ownOrCoached } from '../../modules/coaching/training.ts'
import { trainingReview } from '../../modules/review/service.ts'
import { type PlanRead, planFor, savePlanAndRead } from '../../modules/workout/plan-for.ts'
import * as ProgressionService from '../../modules/progression/service.ts'
import * as WorkoutService from '../../modules/workout/service.ts'
import { READ, REPLACES, REWRITES, WRITE, json, reviewSummary, text } from '../format.ts'
import {
  suggestionLine,
  suggestionLines,
  workoutDetail,
  workoutLine,
  workoutUpdated,
} from '../format-workout.ts'
import { groupNamesOf } from '../format-group.ts'

/**
 * OBJECTIVE 2 — reviewing and adjusting someone's training.
 *
 * `training_review` is the entry point: one call returns what a coach would actually look at, so
 * the model does not have to page through every session and do date arithmetic itself.
 * See docs/07-mcp.md.
 */
export function registerTrainingTools(server: McpServer, caller: Caller): void {
  const outline = async (
    { workout, held }: PlanRead,
    targets: readonly ProgressionSuggestion[] = [],
  ) => workoutDetail(workout, caller.weightUnit, held, await groupNamesOf(caller), targets)

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
        ...ScopeFields,
        q: z.string().max(100).optional(),
        limit: z.int().min(1).max(100).default(30),
      }),
      annotations: READ,
    },
    async ({ scope, groupId, q, limit }) => {
      const page = await WorkoutService.list(caller, { scope, groupId, q, limit })
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
        'The full plan as an outline: days, entries, supersets, each rule in full and each ' +
        'prescribed set with its reps in reserve — warm-ups marked. The plan is the PRESCRIPTION, ' +
        'where each follower starts; under an entry, `next:` is YOUR target where your own ' +
        'sessions moved it (with `athlete`, no target is shown). Read this before changing a ' +
        'plan; use `workout_get_editable` to rewrite it. An exercise your equipment — or, with ' +
        '`athlete`, theirs — lacks is marked.',
      inputSchema: z.object({ workoutId: z.uuid() }).safeExtend(OfAthlete.shape),
      annotations: READ,
    },
    async ({ workoutId, athlete }) => {
      const read = await planFor(await ownOrCoached(caller, athlete), workoutId)
      // The caller's own targets only: a coach reading an athlete's is not offered.
      const targets =
        athlete === undefined ? await ProgressionService.suggestForWorkout(caller, workoutId) : []
      return text(await outline(read, targets))
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
    'workout_update',
    {
      title: 'Rename a workout or change its notes',
      description:
        'Change the name or notes of a workout you edit; an omitted field is left alone, and ' +
        '`notes: null` clears them. `notes` REPLACES the whole text: read `workout_get` first and ' +
        'send all you keep. The notes say how the workout is run — effort, block structure, ' +
        'deload, what to do on a bad day — so change them when the plan changes. What is true ' +
        'of the person, such as their equipment or an injury, is theirs, not the workout’s: ' +
        '`equipment_set` or `note_create`. Every follower of a shared or library workout sees the ' +
        'change. ' +
        'The plan is not touched; to change it, `workout_save_plan`.',
      inputSchema: WorkoutUpdate.safeExtend({ workoutId: z.uuid() }),
      annotations: REPLACES,
    },
    async ({ workoutId, ...patch }) =>
      text(workoutUpdated(await WorkoutService.update(caller, workoutId, patch))),
  )

  server.registerTool(
    'workout_save_plan',
    {
      title: 'Save a whole workout plan',
      description:
        'Replace the ENTIRE plan atomically — days, entries and sets. Send the complete plan, not ' +
        'a patch: anything omitted is removed. Order comes from array position; never send an ' +
        'index. Each field says what it means: read them. The plan holds each entry’s ' +
        'PRESCRIPTION, where every follower starts; each follower’s target then moves on its own ' +
        'as they train (`workout_progression`), and changing what a rule moves or judges starts ' +
        'it again from the new prescription. Plan warm-ups as warm-up sets with numbers, and say ' +
        'effort in reps in reserve, never RPE. Send back the `id` of each day and entry you keep ' +
        'and the `version`, both from `workout_get_editable`: ids keep logged history and ' +
        'targets attached, and a save from a stale version is refused — read it again. Read ' +
        'note_list before changing a plan, and plan around what it says.',
      inputSchema: PlanSave.safeExtend({ workoutId: z.uuid() }),
      annotations: REWRITES,
    },
    async ({ workoutId, ...plan }) => {
      return text(`Saved.\n\n${await outline(await savePlanAndRead(caller, workoutId, plan))}`)
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
      title: 'Read your next targets',
      description:
        "Each entry's next target for YOU — what your next session asks, which the app's logger " +
        'asks too — beside what the plan prescribes, and why your latest session held it, by its ' +
        'set: `held: set 3 did 7 of 10`, short of the target, or `held for effort: set 3 left 0 ' +
        'in reserve, asked 2` — effort, not a stall, and no reason to deload. Targets move by ' +
        'themselves as sessions are finished; the plan is never rewritten. Reps in reserve are ' +
        'not part of a target: each set asks the plan’s own (`workout_get`). Read-only. To set your ' +
        'own target, `target_set`. To change where every follower starts — a new phase, after a ' +
        'deload — save the new prescriptions with `workout_save_plan`, after reading note_list: ' +
        'that restarts each follower’s target from them.',
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
    'target_set',
    {
      title: 'Set your own target',
      description:
        'Set YOUR target on one entry by hand — where your next session starts — when the rule ' +
        'has it wrong for you: after time off, on new equipment. Only what the entry’s rule ' +
        'moves: double, reps inside its range and weight; linear, weight; linear_duration, ' +
        'seconds; linear_distance, distance (time follows at the plan’s pace). Anything else is a ' +
        'plan edit (`workout_save_plan`), and a Manual entry has no target: its numbers are the ' +
        'plan’s. The plan is not changed. Your own target only — never an athlete’s.',
      inputSchema: TargetByHand.safeExtend({ workoutId: z.uuid(), entryId: z.uuid() }),
      annotations: WRITE,
    },
    async ({ workoutId, entryId, ...target }) => {
      const set = await ProgressionService.setTargetByHand(caller, workoutId, entryId, target)
      return text(`Set.\n\n${suggestionLine(set, caller.weightUnit)}`)
    },
  )
}
