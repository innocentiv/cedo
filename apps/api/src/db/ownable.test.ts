import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from './client.ts'
import { exercises } from './schema.ts'
import { seedLibrary } from './seed.ts'
import { type TestApi, type TestUser, makeApi } from '../test/harness.ts'

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

const insertExercise = async (name: string, ownerGroupId: string, createdBy: string) => {
  const [row] = await db.insert(exercises).values({ name, ownerGroupId, createdBy }).returning()
  if (row === undefined) throw new Error('insert failed')
  return row
}

/**
 * Regression: `ownable()` declared `updatedAt` with `defaultNow()` and no `$onUpdate`, so the
 * column froze at creation for every ownable entity. Every future "changed since" or sync query
 * would silently have missed every edit.
 */
describe('ownable().updatedAt', () => {
  test('advances on update', async () => {
    const created = await insertExercise('Test Lift', alice.personalGroupId, alice.userId)
    expect(created.updatedAt.getTime()).toBe(created.createdAt.getTime())

    await Bun.sleep(5)
    const [updated] = await db
      .update(exercises)
      .set({ description: 'changed' })
      .where(eq(exercises.id, created.id))
      .returning()

    expect(updated?.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
    expect(updated?.createdAt.getTime()).toBe(created.createdAt.getTime())
  })
})

/**
 * Regression: the seed matched exercise names across the WHOLE table, so a user creating an
 * exercise that shares a name with a library entry permanently suppressed it from the shared
 * library on every later upgrade.
 */
describe('seed idempotency is scoped to the seeded group', () => {
  test("a user's own exercise does not suppress the library entry", async () => {
    await insertExercise('Barbell Back Squat', alice.personalGroupId, alice.userId)

    await seedLibrary(h.groupId, h.systemUserId)

    const inLibrary = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(eq(exercises.ownerGroupId, h.groupId), eq(exercises.name, 'Barbell Back Squat')))
    expect(inLibrary).toHaveLength(1)

    const alices = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(
        and(
          eq(exercises.ownerGroupId, alice.personalGroupId),
          eq(exercises.name, 'Barbell Back Squat'),
        ),
      )
    expect(alices).toHaveLength(1)
  })

  test('re-running the seed adds nothing the second time', async () => {
    const first = await seedLibrary(h.groupId, h.systemUserId)
    expect(first).toBeGreaterThan(40)
    expect(await seedLibrary(h.groupId, h.systemUserId)).toBe(0)
  })
})
