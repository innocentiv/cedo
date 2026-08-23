import { eq, sql } from 'drizzle-orm'
import { DEFAULT_GROUP_SLUG, ExerciseCreate, MUSCLES, parseMediaUrl } from '@cedo/contract'
import { type Transaction, closeDatabase, db } from './client.ts'
import {
  exerciseMedia,
  exerciseMuscles,
  exercises,
  groups,
  media,
  muscles,
  users,
} from './schema.ts'
import { EXERCISE_LIBRARY, type SeedExercise } from './seed-data/exercises.ts'

/**
 * Idempotent. Runs after migrations, and is safe to re-run — a self-hosted instance restarts for
 * reasons nobody planned, and an upgrade must be able to add library entries without duplicating
 * the ones already there. See docs/05-database.md.
 */

/**
 * The seeded library needs an owner, and `created_by` is NOT NULL. A system account keeps the
 * foreign key honest. Its password hash is a discarded random value, so nobody can sign in as it.
 */
const SYSTEM_USERNAME = 'cedo'

/**
 * Deliberately a YouTube SEARCH url rather than a specific video id. Inventing ids would give
 * every user dead links and broken thumbnails; a search always resolves and stays useful. Users
 * and the AI replace these with real videos through the media endpoints.
 */
function demonstrationSearchUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} form`)}`
}

async function seedMuscles(): Promise<void> {
  await db
    .insert(muscles)
    .values(MUSCLES.map((m, sortIndex) => ({ ...m, sortIndex })))
    .onConflictDoUpdate({
      target: muscles.slug,
      set: {
        name: sql`excluded.name`,
        region: sql`excluded.region`,
        sortIndex: sql`excluded.sort_index`,
      },
    })
}

async function seedSystemUser(): Promise<{ userId: string; groupId: string }> {
  const existing = await db.select().from(users).where(eq(users.username, SYSTEM_USERNAME)).limit(1)
  const found = existing[0]
  if (found !== undefined) return { userId: found.id, groupId: found.personalGroupId }

  return await db.transaction(async (tx) => {
    const [shared] = await tx
      .insert(groups)
      .values({ slug: DEFAULT_GROUP_SLUG, name: 'cedo', kind: 'shared' })
      .onConflictDoNothing()
      .returning()

    const sharedGroup =
      shared ??
      (await tx.select().from(groups).where(eq(groups.slug, DEFAULT_GROUP_SLUG)).limit(1))[0]
    if (sharedGroup === undefined) throw new Error('Could not create or find the cedo group')

    const [personal] = await tx
      .insert(groups)
      .values({ slug: 'user-cedo-system', name: 'cedo (system)', kind: 'personal' })
      .returning()
    if (personal === undefined) throw new Error('Could not create the system personal group')

    // An unusable credential: the plaintext is generated here and immediately discarded.
    const passwordHash = await Bun.password.hash(crypto.randomUUID() + crypto.randomUUID())

    const [user] = await tx
      .insert(users)
      .values({
        username: SYSTEM_USERNAME,
        passwordHash,
        displayName: 'cedo',
        personalGroupId: personal.id,
      })
      .returning()
    if (user === undefined) throw new Error('Could not create the system user')

    return { userId: user.id, groupId: sharedGroup.id }
  })
}

/**
 * Validating against the contract means a typo in the library fails the seed rather than producing
 * a silently wrong exercise — muscle loads must sum to 100 and each muscle may appear only once.
 */
function validate(entry: SeedExercise) {
  return ExerciseCreate.parse({
    name: entry.name,
    tracking: entry.tracking ?? 'weight_reps',
    description: entry.description,
    equipment: entry.equipment,
    isUnilateral: entry.isUnilateral ?? false,
    muscles: entry.muscles.map(([muscle, loadPct]) => ({ muscle, loadPct })),
  })
}

/** A library entry stays useful without its demonstration link, so this is best-effort. */
async function attachDemonstration(
  tx: Transaction,
  exerciseId: string,
  name: string,
  createdBy: string,
): Promise<void> {
  const payload = parseMediaUrl(demonstrationSearchUrl(name))
  if (payload === null) return

  const [row] = await tx
    .insert(media)
    .values({ kind: 'video_link', title: `${name} — how to`, payload, createdBy })
    .returning()
  if (row === undefined) return

  await tx.insert(exerciseMedia).values({ exerciseId, mediaId: row.id, sortIndex: 0 })
}

/** Returns false when the exercise already exists — which is what makes re-running a no-op. */
async function seedExercise(
  entry: SeedExercise,
  ownerGroupId: string,
  createdBy: string,
): Promise<boolean> {
  const parsed = validate(entry)

  const existing = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(eq(exercises.name, parsed.name))
  if (existing.some(Boolean)) return false

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(exercises)
      .values({
        ownerGroupId,
        createdBy,
        name: parsed.name,
        tracking: parsed.tracking,
        description: parsed.description,
        instructions: parsed.instructions,
        equipment: parsed.equipment,
        isUnilateral: parsed.isUnilateral,
      })
      .returning()
    if (created === undefined) throw new Error(`Could not create exercise ${parsed.name}`)

    await tx.insert(exerciseMuscles).values(
      parsed.muscles.map((m) => ({
        exerciseId: created.id,
        muscleSlug: m.muscle,
        loadPct: m.loadPct,
      })),
    )

    await attachDemonstration(tx, created.id, parsed.name, createdBy)
  })
  return true
}

export async function runSeed(): Promise<void> {
  await seedMuscles()
  const { userId, groupId } = await seedSystemUser()

  let created = 0
  for (const entry of EXERCISE_LIBRARY) {
    // Deliberately sequential: parallelising ~45 transactions would exhaust the small connection
    // pool a self-hosted box runs with, for no benefit in a one-off seed.
    // See docs/adr/0006-oxc-lint-and-format.md.
    // oxlint-disable-next-line no-await-in-loop
    if (await seedExercise(entry, groupId, userId)) created += 1
  }

  console.log(
    `Seeded ${MUSCLES.length} muscles, the '${DEFAULT_GROUP_SLUG}' group, ` +
      `and ${created} new exercises (${EXERCISE_LIBRARY.length - created} already present).`,
  )
}

if (import.meta.main) {
  await runSeed()
  await closeDatabase()
}
