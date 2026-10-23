import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  DuplicateInput,
  ExerciseCreateRequest,
  ExerciseUpdate,
  MUSCLES,
  MuscleSlug,
} from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import * as ExerciseService from '../../modules/exercise/service.ts'
import * as MediaService from '../../modules/media/service.ts'
import { libraryAudit, sharedGroupId } from '../../modules/review/curation.ts'
import { exerciseDetail, exerciseLine, text } from '../format.ts'

const READ = { readOnlyHint: true, openWorldHint: false } as const

const section = (title: string, lines: readonly string[]) =>
  lines.length === 0 ? `${title}: none` : `${title} (${lines.length}):\n  ${lines.join('\n  ')}`
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const

/**
 * OBJECTIVE 1 — curating the shared exercise library from reliable sources.
 *
 * The order matters: `library_audit` and `exercise_search` come first because the expensive failure
 * here is not a missing capability, it is creating a near-duplicate or attributing muscles
 * inconsistently. Read before writing. See docs/07-mcp.md.
 */
export function registerLibraryTools(server: McpServer, caller: Caller): void {
  server.registerTool(
    'muscle_list',
    {
      title: 'List muscles',
      description:
        'The complete, fixed set of muscles an exercise may target. These slugs are the ONLY ' +
        'valid values; muscles cannot be created.',
      inputSchema: z.object({}),
      annotations: READ,
    },
    () =>
      text(
        MUSCLES.map((m) => `${m.slug} (${m.region}) — ${m.name}`).join('\n') +
          `\n\n${MUSCLES.length} muscles. Loads on one exercise must sum to exactly 100.`,
      ),
  )

  server.registerTool(
    'exercise_search',
    {
      title: 'Search exercises',
      description:
        'Find exercises visible to you. ALWAYS run this before creating one — a near-duplicate ' +
        'is the most common way a library degrades. One line per exercise, ending with its id.',
      inputSchema: z.object({
        q: z.string().max(100).optional().describe('Substring of the name'),
        muscle: MuscleSlug.optional().describe('Only exercises loading this muscle'),
        scope: z
          .enum(['all', 'mine', 'favourites'])
          .default('all')
          .describe("'mine' is your personal group only"),
        limit: z.int().min(1).max(100).default(30),
      }),
      annotations: READ,
    },
    async ({ q, muscle, scope, limit }) => {
      const page = await ExerciseService.list(caller, { q, muscle, scope, limit })
      if (page.items.length === 0) return text('No exercises matched.')
      return text(
        page.items.map((e) => exerciseLine(e)).join('\n') +
          (page.nextCursor === null ? '' : '\n\n(more results exist; narrow the search)'),
      )
    },
  )

  server.registerTool(
    'exercise_get',
    {
      title: 'Get one exercise',
      description: 'Full detail for one exercise: description, instructions, muscle loads, media.',
      inputSchema: z.object({ exerciseId: z.uuid() }),
      annotations: READ,
    },
    async ({ exerciseId }) => text(exerciseDetail(await ExerciseService.get(caller, exerciseId))),
  )

  server.registerTool(
    'exercise_create',
    {
      title: 'Create an exercise',
      description:
        'Create an exercise. Muscle loads must sum to exactly 100 and no muscle may repeat. ' +
        'Set `shared: true` to put it in the shared library — that requires curator rights. ' +
        'Search first: duplicates are hard to undo, since nothing can be deleted through MCP.',
      inputSchema: ExerciseCreateRequest,
      annotations: WRITE,
    },
    async (input) =>
      text(`Created.\n\n${exerciseDetail(await ExerciseService.create(caller, input))}`),
  )

  server.registerTool(
    'exercise_update',
    {
      title: 'Update an exercise',
      description:
        'Change any field of an exercise you can edit. Omitted fields are left alone. Supplying ' +
        '`muscles` REPLACES the whole set, so include every muscle, summing to 100.',
      inputSchema: ExerciseUpdate.safeExtend({ exerciseId: z.uuid() }),
      annotations: WRITE,
    },
    async ({ exerciseId, ...patch }) =>
      text(
        `Updated.\n\n${exerciseDetail(await ExerciseService.update(caller, exerciseId, patch))}`,
      ),
  )

  server.registerTool(
    'exercise_duplicate',
    {
      title: 'Duplicate an exercise',
      description:
        'Copy an exercise you can see — muscles, instructions, media — into a group you edit: ' +
        'your personal group unless `toGroupId` names another. The way to adapt a library ' +
        'exercise for someone without curator rights. The copy is a second exercise, so prefer ' +
        'the original unless it must change.',
      inputSchema: DuplicateInput.safeExtend({ exerciseId: z.uuid() }),
      annotations: WRITE,
    },
    async ({ exerciseId, toGroupId }) =>
      text(
        `Duplicated.\n\n${exerciseDetail(await ExerciseService.duplicate(caller, exerciseId, toGroupId))}`,
      ),
  )

  server.registerTool(
    'media_add_link',
    {
      title: 'Attach a reference video',
      description:
        'Register a link to a demonstration video (YouTube, Vimeo, or any URL) and return its ' +
        "media id. Pass that id in an exercise's `mediaIds` to attach it. No upload, no API key.",
      inputSchema: z.object({ url: z.url(), title: z.string().max(200).default('') }),
      annotations: WRITE,
    },
    async ({ url, title }) => {
      const media = await MediaService.createLink(caller, { url, title })
      return text(
        `Created media ${media.id} (${media.kind}). Embeddable: ${media.embedUrl ?? 'no'}.`,
      )
    },
  )

  server.registerTool(
    'library_audit',
    {
      title: 'Audit the exercise library',
      description:
        'Review a library for problems BEFORE editing it: likely duplicate names, muscles with ' +
        'thin or no coverage, and entries missing instructions or media. Run this first when ' +
        'asked to improve or extend the library.',
      inputSchema: z.object({
        groupId: z
          .uuid()
          .optional()
          .describe('Defaults to the shared cedo library. Pass a group id to audit your own.'),
      }),
      annotations: READ,
    },
    async ({ groupId }) => {
      const target = groupId ?? (await sharedGroupId())
      if (target === null) return text('There is no shared library on this instance.')

      const audit = await libraryAudit(caller, target)
      return text(
        [
          audit.scannedForDuplicates < audit.total
            ? `${audit.total} exercises in this library. The duplicate scan compared the first ${audit.scannedForDuplicates} by name.`
            : `${audit.total} exercises in this library.`,
          '',
          section(
            'Possible duplicates',
            audit.possibleDuplicates.map(
              (d) => `"${d.a}" ~ "${d.b}"  (similarity ${d.similarity})`,
            ),
          ),
          section(
            'Thin muscle coverage',
            audit.thinCoverage.map((m) => `${m.muscle}: ${m.exercises} exercise(s)`),
          ),
          section('Missing instructions', audit.missingInstructions),
          section('Missing media', audit.missingMedia),
          section(
            'Attributed to a single muscle (check these are really isolation lifts)',
            audit.singleMuscle,
          ),
        ].join('\n\n'),
      )
    },
  )
}
