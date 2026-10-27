import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { AthleteNoteInput, OfAthlete } from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import * as NoteService from '../../modules/note/service.ts'
import { text } from '../format.ts'
import { noteLines } from '../format-coaching.ts'

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
