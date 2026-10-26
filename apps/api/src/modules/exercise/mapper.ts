import { asc, desc, eq, inArray } from 'drizzle-orm'
import {
  type Exercise,
  type AthleteEquipment,
  type Media,
  isDoable,
  videoEmbedUrl,
  videoThumbnailUrl,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupBy } from '../../lib/keyset.ts'
import { media } from '../../db/schema.ts'
import { type ExerciseRow, visibleExerciseMedia, visibleExerciseMuscles } from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { heldBy } from '../equipment/held.ts'
import { ownableFieldsOf } from '../ownable/service.ts'

export type { ExerciseRow }
type MediaRow = typeof media.$inferSelect
type AttachedMedia = { sortIndex: number; row: MediaRow }

/**
 * Relative to the API ROOT, not to the site. The API does not know what it is mounted under — Caddy
 * puts it at `/api` in the deployed shape, a native build reaches it at an absolute host — so
 * prefixing here would bake one deployment into the payload.
 *
 * A client MUST resolve it: `apiUrl(media.url)` in `apps/app/src/api/http.ts`. Rendering
 * `<img src={media.url}>` directly asks the SITE for `/media/…`, which Caddy answers with the SPA's
 * own index.html — HTTP 200, `text/html`, a broken image that never fires an error handler.
 * Blob keys never reach a client either way. See docs/04-contract.md.
 */
const mediaUrl = (mediaId: string, variant: 'blob' | 'thumb') => `/media/${mediaId}/${variant}`

export function toMedia(row: MediaRow): Media {
  const payload = row.payload
  if (payload.kind === 'image') {
    return {
      id: row.id,
      kind: 'image',
      title: row.title,
      url: mediaUrl(row.id, 'blob'),
      thumbnailUrl: row.thumbnailKey === null ? null : mediaUrl(row.id, 'thumb'),
      embedUrl: null,
      width: payload.width,
      height: payload.height,
      createdAt: row.createdAt.toISOString(),
    }
  }
  return {
    id: row.id,
    kind: 'video_link',
    title: row.title,
    url: payload.sourceUrl,
    thumbnailUrl: videoThumbnailUrl(payload),
    embedUrl: videoEmbedUrl(payload),
    width: null,
    height: null,
    createdAt: row.createdAt.toISOString(),
  }
}

interface Attachments {
  readonly muscles: Exercise['muscles']
  readonly media: AttachedMedia[]
  readonly isFavourite: boolean
  readonly caller: Caller
  /** What the athlete judged for has: whether each exercise is doable for them (#35). */
  readonly equipment: AthleteEquipment
}

function toExercise(row: ExerciseRow, attachments: Attachments): Exercise {
  const { muscles, media: attached, isFavourite, caller, equipment } = attachments
  return {
    id: row.id,
    name: row.name,
    tracking: row.tracking,
    description: row.description,
    instructions: row.instructions,
    equipment: row.equipment,
    isUnilateral: row.isUnilateral,
    muscles,
    mediaIds: attached.map((m) => m.row.id),
    media: attached.map((m) => toMedia(m.row)),
    doable: isDoable(row.equipment, equipment),
    ...ownableFieldsOf(row, isFavourite, caller),
  }
}

/**
 * Loading exercises means loading their muscles and media too. Doing that per row is the textbook
 * N+1, so this issues exactly THREE queries regardless of how many rows it is given — one `inArray`
 * for muscles, one for media, and what the athlete judged for has to train with (#35). Together
 * with the caller's own query that is four per read, at any page size.
 *
 * `bun run perf` asserts that count is identical whether the page holds 5 rows or 50.
 * See docs/adr/0018-n1-detection.md.
 */
export async function hydrate(
  caller: Caller,
  listed: readonly { readonly row: ExerciseRow; readonly isFavourite: boolean }[],
  /** Whose equipment says what is doable (#35): the caller's, or an athlete's, checked theirs. */
  judgedFor: string = caller.userId,
): Promise<Exercise[]> {
  if (listed.length === 0) return []
  const ids = listed.map((l) => l.row.id)

  const muscles = visibleExerciseMuscles(caller)
  // In one order every read agrees on — most loaded first — not whichever the planner returns: two
  // reads of one exercise, or of an exercise and its copy, compared unequal by chance.
  const muscleRows = await db
    .select()
    .from(muscles)
    .where(inArray(muscles.exerciseId, ids))
    .orderBy(desc(muscles.loadPct), asc(muscles.muscleSlug))

  const attached = visibleExerciseMedia(caller)
  const mediaRows = await db
    .select({ exerciseId: attached.exerciseId, sortIndex: attached.sortIndex, media })
    .from(attached)
    .innerJoin(media, eq(media.id, attached.mediaId))
    .where(inArray(attached.exerciseId, ids))

  const equipment = await heldBy(judgedFor)

  const musclesByExercise = groupBy(
    muscleRows,
    (m) => m.exerciseId,
    (m) => ({ muscle: m.muscleSlug, loadPct: m.loadPct }),
  )
  const mediaByExercise = groupBy(
    mediaRows,
    (m) => m.exerciseId,
    (m): AttachedMedia => ({ sortIndex: m.sortIndex, row: m.media }),
  )

  return listed.map(({ row, isFavourite }) =>
    toExercise(row, {
      muscles: musclesByExercise.get(row.id) ?? [],
      media: (mediaByExercise.get(row.id) ?? []).toSorted((a, b) => a.sortIndex - b.sortIndex),
      isFavourite,
      caller,
      equipment,
    }),
  )
}
