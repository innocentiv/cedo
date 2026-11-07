import { and, eq, isNull, sql } from 'drizzle-orm'
import { DEFAULT_GROUP_SLUG, ExerciseCreate, MUSCLES, parseMediaUrl } from '@cedo/contract'
import { type Transaction, closeDatabase, db } from './client.ts'
import { promoteCurator } from './promote-curator.ts'
import {
  exerciseMedia,
  exerciseMuscles,
  exercises,
  groups,
  media,
  muscles,
  users,
} from './schema.ts'
import { EXERCISE_LIBRARY, type SeedExercise, exerciseInputOf } from './seed-data/exercises.ts'

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
 * The entry's own video — an id checked to exist when it was chosen, never invented — or else a
 * YouTube SEARCH for its name. An invented id would give every user a dead link and a broken
 * thumbnail; a search always resolves. Users and the AI replace either through the media endpoints.
 */
const demonstrationUrl = (entry: SeedExercise): string =>
  entry.video ??
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${entry.name} form`)}`

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
const validate = (entry: SeedExercise) => ExerciseCreate.parse(exerciseInputOf(entry))

/** A library entry stays useful without its demonstration link, so this is best-effort. */
async function attachDemonstration(
  tx: Transaction,
  exercise: { readonly id: string; readonly ownerGroupId: string },
  entry: SeedExercise,
  createdBy: string,
): Promise<void> {
  const payload = parseMediaUrl(demonstrationUrl(entry))
  if (payload === null) return

  const [row] = await tx
    .insert(media)
    .values({ kind: 'video_link', title: `${entry.name} — how to`, payload, createdBy })
    .returning()
  if (row === undefined) return

  await tx.insert(exerciseMedia).values({
    exerciseId: exercise.id,
    ownerGroupId: exercise.ownerGroupId,
    mediaId: row.id,
    sortIndex: 0,
  })
}

/**
 * Left undescribed, an entry takes the library's equipment (#33): how an installation made before
 * the list gets its library described, at the boot that migrates it. A curator's own stands.
 */
async function describeEntry(id: string, equipment: ExerciseCreate['equipment']): Promise<void> {
  await db
    .update(exercises)
    .set({ equipment })
    .where(and(eq(exercises.id, id), isNull(exercises.equipment)))
}

/** Returns false when the exercise already exists — which is what makes re-running a no-op. */
async function seedExercise(
  entry: SeedExercise,
  ownerGroupId: string,
  createdBy: string,
): Promise<boolean> {
  const parsed = validate(entry)

  // Scoped to the seeded group: by name alone, a user's own "Barbell Back Squat" would suppress
  // the library's entry on every future upgrade.
  const [existing] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.ownerGroupId, ownerGroupId), eq(exercises.name, parsed.name)))
    .limit(1)
  if (existing !== undefined) {
    await describeEntry(existing.id, parsed.equipment)
    return false
  }

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

    await attachDemonstration(tx, created, entry, createdBy)
  })
  return true
}

/**
 * Muscles, the `cedo` group and the system account — everything `register()` depends on, without
 * the exercise library. Tests reset to this state; it is cheap enough to run between them.
 */
export async function seedCore(): Promise<{ userId: string; groupId: string }> {
  await seedMuscles()
  const core = await seedSystemUser()
  await promoteCurator(core.groupId)
  return core
}

/** Adds the starter library on top of `seedCore`. Returns how many exercises were new. */
export async function seedLibrary(ownerGroupId: string, createdBy: string): Promise<number> {
  let created = 0
  for (const entry of EXERCISE_LIBRARY) {
    // Deliberately sequential: parallelising ~50 transactions would exhaust the small connection
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
