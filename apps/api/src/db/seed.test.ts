import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from './client.ts'
import { exerciseMedia, exercises, groupMembers, media } from './schema.ts'
import { EXERCISE_LIBRARY } from './seed-data/exercises.ts'
import { promoteCurator } from './promote-curator.ts'
import { seedLibrary } from './seed.ts'
import { type TestApi, makeApi } from '../test/harness.ts'

let h: TestApi

beforeEach(async () => {
  h = await makeApi()
})

const libraryEquipment = async (name: string) => {
  const [row] = await db
    .select({ equipment: exercises.equipment })
    .from(exercises)
    .where(and(eq(exercises.ownerGroupId, h.groupId), eq(exercises.name, name)))
  return row?.equipment
}

describe('the library seeded', () => {
  test('carries each entry its instructions, not only its description', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const [row] = await db
      .select({ instructions: exercises.instructions })
      .from(exercises)
      .where(and(eq(exercises.ownerGroupId, h.groupId), eq(exercises.name, 'Seated Leg Curl')))
    const entry = EXERCISE_LIBRARY.find((e) => e.name === 'Seated Leg Curl')
    expect(entry?.instructions).toBeTruthy()
    expect(row?.instructions).toBe(entry?.instructions)
  })

  test('links the video an entry names, and a search only for one that names none', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const linked = async (name: string) =>
      await db
        .select({ payload: media.payload })
        .from(exercises)
        .innerJoin(exerciseMedia, eq(exerciseMedia.exerciseId, exercises.id))
        .innerJoin(media, eq(media.id, exerciseMedia.mediaId))
        .where(and(eq(exercises.ownerGroupId, h.groupId), eq(exercises.name, name)))

    expect(await linked('Smith Machine Squat')).toMatchObject([
      { payload: { provider: 'youtube', externalId: '8TEK4DPVVPs' } },
    ])
    expect(await linked('Incline Dumbbell Y-Raise')).toMatchObject([
      { payload: { provider: 'url', externalId: null } },
    ])
  })
})

/**
 * An installation from before equipment was a list (#33): its migration left every exercise
 * undescribed, and the boot's seed describes the library — but not over a curator's own word.
 */
describe('the library described at boot', () => {
  test('a new library is described as it is seeded: needing something, or nothing', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    expect(await libraryEquipment('Barbell Back Squat')).toEqual(['barbell', 'rack'])
    expect(await libraryEquipment('Push-Up')).toEqual([])
  })

  test('an entry left undescribed is described; one a curator described stays theirs', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const library = eq(exercises.ownerGroupId, h.groupId)
    await db.update(exercises).set({ equipment: null }).where(library)
    await db
      .update(exercises)
      .set({ equipment: ['smith_machine'] })
      .where(and(library, eq(exercises.name, 'Front Squat')))

    expect(await seedLibrary(h.groupId, h.systemUserId)).toBe(0)

    expect(await libraryEquipment('Barbell Back Squat')).toEqual(['barbell', 'rack'])
    expect(await libraryEquipment('Lat Pulldown')).toEqual(['high_pulley'])
    expect(await libraryEquipment('Front Squat')).toEqual(['smith_machine'])
  })
})

/**
 * `CEDO_CURATOR_USERNAME`, deprecated (ADR-0029): it makes a curator only where there is none. Once
 * there is one, an account registered under that name while sign-up was open must not become a
 * second curator at the next restart.
 */
describe('promoteCurator', () => {
  const role = async (userId: string) =>
    (
      await db
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, h.groupId), eq(groupMembers.userId, userId)))
    )[0]?.role

  test('makes the named account curator on an instance that has none', async () => {
    const bob = await h.as('bob')
    expect(await promoteCurator(h.groupId, 'bob')).toBe(true)
    expect(await role(bob.userId)).toBe('editor')
  })

  test('names nobody else once the instance has a curator', async () => {
    await h.curator(await h.as('alice'))
    const bob = await h.as('bob')
    expect(await promoteCurator(h.groupId, 'bob')).toBe(false)
    expect(await role(bob.userId)).toBe('reader')
  })

  test('keeps the curator it made on an earlier boot', async () => {
    const bob = await h.as('bob')
    await h.curator(bob)
    expect(await promoteCurator(h.groupId, 'bob')).toBe(true)
    expect(await role(bob.userId)).toBe('editor')
  })
})
