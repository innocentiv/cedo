import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from './client.ts'
import { exerciseMedia, exercises, media } from './schema.ts'
import { EXERCISE_LIBRARY } from './seed-data/exercises.ts'
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
