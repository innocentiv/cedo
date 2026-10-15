import { and, eq, sql } from 'drizzle-orm'
import { DEFAULT_GROUP_SLUG, ExerciseCreate, MUSCLES, parseMediaUrl } from '@cedo/contract'
import { type Transaction, closeDatabase, db } from './client.ts'
import { env } from '../env.ts'
import {
  exerciseMedia,
  exerciseMuscles,
  exercises,
  groupMembers,
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

let unusableHash: Promise<string> | undefined
const unusablePasswordHash = async (): Promise<string> => {
  unusableHash ??= Bun.password.hash(crypto.randomUUID() + crypto.randomUUID())
  return await unusableHash
}

/**
 * Deliberately a YouTube SEARCH url rather than a specific video id. Inventing ids would give
 * every user dead links and broken thumbnails; a search always resolves and stays useful. Users
 * and the AI replace these with real videos through the media endpoints.
 */
function demonstrationSearchUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} form`)}`
}

export async function seedMuscles(): Promise<void> {
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

/**
 * Returns the system account and the id of the SHARED group that owns the library.
 *
 * `groupId` must be the SHARED group on both paths — the one that already exists as much as the one
 * just created. Returning the system account's personal group instead makes every seed after the
 * first write the whole library into a group nobody is a member of, which is invisible rather than
 * loud.
 */
export async function seedSystemUser(): Promise<{ userId: string; groupId: string }> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, SYSTEM_USERNAME))
    .limit(1)
  const found = existing[0]

  if (found !== undefined) {
    const [shared] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.slug, DEFAULT_GROUP_SLUG))
      .limit(1)
    if (shared === undefined)
      throw new Error('The system account exists but the cedo group does not')
    return { userId: found.id, groupId: shared.id }
  }

  return await createSystemAccount()
}

/** First run only: the shared group, the system account, and its unusable credential. */
async function createSystemAccount(): Promise<{ userId: string; groupId: string }> {
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

    // An unusable credential: the plaintext is generated once per process and discarded. Derived
    // lazily and cached because the test harness truncates and re-seeds before EVERY test, and an
    // argon2id derivation per test dominates the suite's runtime.
    const passwordHash = await unusablePasswordHash()

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
  exercise: { readonly id: string; readonly ownerGroupId: string },
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

  await tx.insert(exerciseMedia).values({
    exerciseId: exercise.id,
    ownerGroupId: exercise.ownerGroupId,
    mediaId: row.id,
    sortIndex: 0,
  })
}

/** Returns false when the exercise already exists — which is what makes re-running a no-op. */
async function seedExercise(
  entry: SeedExercise,
  ownerGroupId: string,
  createdBy: string,
): Promise<boolean> {
  const parsed = validate(entry)

  // Scoped to the seeded group. Matching on name alone means a user who creates their own
  // "Barbell Back Squat" permanently suppresses that entry from the shared library on every
  // future upgrade.
  const existing = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.ownerGroupId, ownerGroupId), eq(exercises.name, parsed.name)))
    .limit(1)
  if (existing.length > 0) return false

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
        ownerGroupId,
        muscleSlug: m.muscle,
        loadPct: m.loadPct,
      })),
    )

    await attachDemonstration(tx, created, parsed.name, createdBy)
  })
  return true
}

/**
 * Muscles, the `cedo` group and the system account — everything `register()` depends on, without
 * the 45-exercise library. Tests reset to this state; it is cheap enough to run between them.
 */
export async function seedCore(): Promise<{ userId: string; groupId: string }> {
  await seedMuscles()
  const core = await seedSystemUser()
  await promoteCurator(core.groupId)
  return core
}

/**
 * Makes `CEDO_ADMIN_USERNAME` an editor of the shared `cedo` group.
 *
 * Without this NOBODY can edit the shared library: the system account owns those rows but is not a
 * member of the group, and registration only ever grants `reader`. Idempotent, and a no-op when the
 * variable is unset or names an account that does not exist yet — register first, then restart.
 * See docs/07-mcp.md.
 */
export async function promoteCurator(sharedGroupId: string): Promise<boolean> {
  const username = env.CEDO_ADMIN_USERNAME
  if (username === undefined) return false

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username.toLowerCase()))
    .limit(1)
  if (user === undefined) {
    console.warn(
      `CEDO_ADMIN_USERNAME='${username}' does not exist yet — register that account, then restart to grant it curator rights.`,
    )
    return false
  }

  await db
    .insert(groupMembers)
    .values({ groupId: sharedGroupId, userId: user.id, role: 'editor' })
    .onConflictDoUpdate({
      target: [groupMembers.groupId, groupMembers.userId],
      set: { role: 'editor' },
    })
  return true
}

/** Adds the starter library on top of `seedCore`. Returns how many exercises were new. */
export async function seedLibrary(ownerGroupId: string, createdBy: string): Promise<number> {
  let created = 0
  for (const entry of EXERCISE_LIBRARY) {
    // Deliberately sequential: parallelising ~45 transactions would exhaust the small connection
    // pool a self-hosted box runs with, for no benefit in a one-off seed.
    // See docs/adr/0006-oxc-lint-and-format.md.
    // oxlint-disable-next-line no-await-in-loop
    if (await seedExercise(entry, ownerGroupId, createdBy)) created += 1
  }
  return created
}

export async function runSeed(): Promise<void> {
  const { userId, groupId } = await seedCore()

  const created = await seedLibrary(groupId, userId)

  console.log(
    `Seeded ${MUSCLES.length} muscles, the '${DEFAULT_GROUP_SLUG}' group, ` +
      `and ${created} new exercises (${EXERCISE_LIBRARY.length - created} already present).`,
  )
}

if (import.meta.main) {
  await runSeed()
  await closeDatabase()
}
