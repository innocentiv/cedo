import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from './client.ts'
import { exercises } from './schema.ts'
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
