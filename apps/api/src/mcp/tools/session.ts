import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { SessionLogInput, SetLogUpdate } from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import { amendLog } from '../../modules/session/write-sets.ts'
import { logWhole } from '../../modules/session/start.ts'
import { text } from '../format.ts'
import { setLine } from '../format-coaching.ts'

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const
/** It replaces what was logged, so a client that asks before a destructive write asks here. */
const CORRECTION = { ...WRITE, destructiveHint: true, idempotentHint: true } as const

/**
 * OBJECTIVE 2, as it was done — training an AI is told about: a whole session logged, and a set
 * already logged corrected (#31). Nothing is removed here: a set or a session deleted is a human
 * action in the app. See docs/07-mcp.md, "Nothing can be deleted".
 */
export function registerSessionTools(server: McpServer, caller: Caller): void {
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

  server.registerTool(
    'session_fix_set',
    {
      title: 'Correct a logged set',
      description:
        'Fix a mistake in one of your sets already logged — "I did 80, not 100, on Monday" — in a ' +
        'session in progress or finished. Name it by the [id] session_get shows. Only the fields ' +
        'you send change: weight in GRAMS, reps, time, distance, RPE, or whether it was a warm-up. ' +
        'Personal bests and progression follow. A set of an exercise you can no longer see takes ' +
        'no new weight. It cannot move a set to another exercise, add a set to a finished ' +
        'session, or remove one: removing stays in the app.',
      inputSchema: SetLogUpdate.safeExtend({ sessionId: z.uuid(), setId: z.uuid() }),
      annotations: CORRECTION,
    },
    async ({ sessionId, setId, ...patch }) =>
      text(
        `Corrected. ${setLine(await amendLog(caller, sessionId, setId, patch), caller.weightUnit)}`,
      ),
  )
}
