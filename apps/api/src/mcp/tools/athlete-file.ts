import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { AthleteNoteInput, MeUpdate, OfAthlete, ReviewQuery, WeighInInput } from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import * as AuthService from '../../modules/auth/service.ts'
import * as NoteService from '../../modules/note/service.ts'
import * as WeighInService from '../../modules/weigh-in/service.ts'
import { text } from '../format.ts'
import { noteLines, profileLine, weighInLine, weighInLines } from '../format-file.ts'

const READ = { readOnlyHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const
/** It replaces a note's words, so a client that asks before a destructive write asks here. */
const REWORD = { ...WRITE, destructiveHint: true, idempotentHint: true } as const

/**
 * Athlete notes (#41): what is known about someone, kept for planning their training — yours, or
 * an athlete's with `athlete`. Read and written; never removed here: a person removes a note in the
 * app. See docs/07-mcp.md, "Nothing can be deleted".
 */
export function registerNoteTools(server: McpServer, caller: Caller): void {
  server.registerTool(
    'note_list',
    {
      title: 'What is known about them',
      description:
        'Notes about you — or an athlete, with `athlete` — newest first: injuries, preferences, ' +
        'what they said of a plan, time away. READ THEM before planning or changing a plan, and ' +
        'plan around them.',
      inputSchema: z.object({}).safeExtend(OfAthlete.shape),
      annotations: READ,
    },
    async ({ athlete }) => text(noteLines(await NoteService.list(caller, athlete), caller.userId)),
  )

  server.registerTool(
    'note_create',
    {
      title: 'Note something to remember',
      description:
        'Write down one standing fact about you — or an athlete, with `athlete` — worth knowing ' +
        'when their training is planned: what they said of a plan, an injury, a preference, a ' +
        'week away. Not what one session was like: that is the session’s notes. Read note_list ' +
        'first, and change a note with note_update rather than write it twice.',
      inputSchema: AthleteNoteInput.safeExtend(OfAthlete.shape),
      annotations: WRITE,
    },
    async ({ athlete, ...input }) =>
      text(noteLines([await NoteService.create(caller, athlete, input)], caller.userId)),
  )

  server.registerTool(
    'note_update',
    {
      title: 'Change a note’s words',
      description:
        'Replace the words of a note you wrote, by the id note_list shows — when what it says ' +
        'is no longer quite true. Only your own notes; an athlete’s needs `athlete`.',
      inputSchema: AthleteNoteInput.safeExtend({ noteId: z.uuid() }).safeExtend(OfAthlete.shape),
      annotations: REWORD,
    },
    async ({ athlete, noteId, ...input }) =>
      text(noteLines([await NoteService.update(caller, athlete, noteId, input)], caller.userId)),
  )
}

/** It replaces what was there — that day's weigh-in, the year said before — so a client asks. */
const REPLACE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const

/**
 * Weigh-ins and the year someone was born (#42): what a plan is weighed against. Weigh-ins are
 * read and taken as notes are — yours, or an athlete's with `athlete` — and never removed here: a
 * person removes one in the app. See docs/07-mcp.md, "Nothing can be deleted".
 */
export function registerWeighInTools(server: McpServer, caller: Caller): void {
  server.registerTool(
    'weigh_in_list',
    {
      title: 'Bodyweight over a period',
      description:
        'Your weigh-ins — or an athlete’s, with `athlete` — over the last `weeks`, newest first, ' +
        'and the latest before them. One a day.',
      inputSchema: ReviewQuery.safeExtend(OfAthlete.shape),
      annotations: READ,
    },
    async ({ weeks, athlete }) =>
      text(
        weighInLines(await WeighInService.list(caller, athlete, weeks), weeks, caller.weightUnit),
      ),
  )

  server.registerTool(
    'weigh_in_create',
    {
      title: 'Record a bodyweight',
      description:
        'Record your bodyweight on a day — or an athlete’s, with `athlete` — when they tell you ' +
        'it. In GRAMS: 82.4 kg is 82400, 180 lb is 81647. One a day: it REPLACES one already ' +
        'taken that day.',
      inputSchema: WeighInInput.safeExtend(OfAthlete.shape),
      annotations: REPLACE,
    },
    async ({ athlete, ...input }) =>
      text(
        `Saved: ${weighInLine(await WeighInService.create(caller, athlete, input), caller.weightUnit)}`,
      ),
  )

  server.registerTool(
    'athlete_profile_set',
    {
      title: 'Set your year of birth',
      description:
        'Set the year you were born, when you say it — null forgets it. Yours only: an athlete ' +
        'sets their own. Whoever coaches you reads it as an age, in training_review.',
      inputSchema: MeUpdate.pick({ birthYear: true }).required(),
      annotations: REPLACE,
    },
    async (patch) =>
      text(profileLine((await AuthService.updateMe(caller, patch)).user, new Date())),
  )
}
