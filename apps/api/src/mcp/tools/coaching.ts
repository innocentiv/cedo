import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { OfAthlete, SessionQuery } from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import * as CoachingService from '../../modules/coaching/service.ts'
import { text } from '../format.ts'
import { athleteLines, sessionDetail, sessionLines } from '../format-coaching.ts'

const READ = { readOnlyHint: true, openWorldHint: false } as const

/**
 * OBJECTIVE 2, for someone else — a coach's AI reading the athletes who share their training (#11).
 * Every tool here reads: a coach changes none of an athlete's training. What a coach writes of
 * theirs is their athlete records — `note_create`, `note_update`, `weigh_in_create`
 * (athlete-file.ts). Every tool that takes the optional `athlete` reads, or writes, for them. See
 * docs/adr/0021-coaching-through-groups.md.
 */
export function registerCoachingTools(server: McpServer, caller: Caller): void {
  server.registerTool(
    'athlete_list',
    {
      title: 'List the athletes you coach',
      description:
        'Members who share their training with a group you edit, while they share it. Pass an ' +
        'id as `athlete` to read their training instead of yours — training_review, ' +
        'session_list, session_get, exercise_history, workout_get, exercise_search, ' +
        'equipment_get — which you cannot change; and their notes and weigh-ins (note_list, ' +
        'weigh_in_list), which you may also write (note_create, note_update, weigh_in_create). ' +
        'Names of what you cannot see stay unavailable in their training.',
      inputSchema: z.object({}),
      annotations: READ,
    },
    async () => text(athleteLines(await CoachingService.athletes(caller))),
  )

  server.registerTool(
    'session_list',
    {
      title: 'List sessions',
      description:
        'Sessions newest first, one line each: date, plan and day, working sets, weight lifted, ' +
        'the personal bests it set, whether it is in progress, and the notes. Yours, or an athlete’s with `athlete`. For ' +
        'the sets of one exercise use exercise_history.',
      inputSchema: SessionQuery.pick({ limit: true, cursor: true, since: true }).safeExtend(
        OfAthlete.shape,
      ),
      annotations: READ,
    },
    async ({ athlete: athleteId, ...query }) =>
      text(
        sessionLines(await CoachingService.sessions(caller, athleteId, query), caller.weightUnit),
      ),
  )

  server.registerTool(
    'session_get',
    {
      title: 'One session, set by set',
      description:
        'Every set of one session from session_list, in the order done, grouped by exercise — ' +
        'w marks a warm-up — with the notes. Yours, or an athlete’s with `athlete`. An exercise ' +
        'you cannot see reads "unavailable exercise", its sets still shown. Your own sets carry ' +
        'their [id], which session_fix_set takes.',
      inputSchema: z.object({ sessionId: z.uuid() }).safeExtend(OfAthlete.shape),
      annotations: READ,
    },
    async ({ sessionId, athlete: athleteId }) =>
      text(
        sessionDetail(
          await CoachingService.session(caller, athleteId, sessionId),
          caller.weightUnit,
          athleteId === undefined,
        ),
      ),
  )
}
