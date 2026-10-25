import { describe, expect, test } from 'bun:test'
import { MUSCLES } from './muscle.ts'
import { Exercise, ExerciseCreate, evenLoads, exerciseInputFrom } from './exercise.ts'

/** An exercise with every input field set away from its default, so a dropped one shows. */
const exercise = Exercise.parse({
  id: crypto.randomUUID(),
  name: 'Single-arm Row',
  tracking: 'bodyweight_reps',
  description: 'Row one side at a time.',
  instructions: 'Brace on the bench.',
  equipment: 'Dumbbell',
  isUnilateral: true,
  muscles: [{ muscle: 'latissimus_dorsi', loadPct: 100 }],
  mediaIds: [crypto.randomUUID()],
  media: [],
  ownerGroupId: crypto.randomUUID(),
  createdBy: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  canEdit: true,
  isFavourite: false,
})

describe('an exercise as the input that would make it again', () => {
  /** Against the schema's own field list: a field added to it cannot be dropped here unseen. */
  test('carries every input field, and nothing else', () => {
    const input = exerciseInputFrom(exercise)
    expect(Object.keys(input).toSorted()).toEqual(Object.keys(ExerciseCreate.shape).toSorted())
    // Each the exercise's own value — every one set away from its default, so none is a stand-in.
    expect(exercise).toMatchObject(input)
  })

  test('is input the schema accepts as it is', () => {
    expect(ExerciseCreate.parse(exerciseInputFrom(exercise))).toEqual(exerciseInputFrom(exercise))
  })
})

describe("a new exercise's muscles (#27)", () => {
  test('start as an even split that totals 100, the first ones taking the remainder', () => {
    expect(evenLoads(['quadriceps']).map((m) => m.loadPct)).toEqual([100])
    expect(evenLoads(['quadriceps', 'gluteus_maximus']).map((m) => m.loadPct)).toEqual([50, 50])
    const three = evenLoads(['quadriceps', 'gluteus_maximus', 'adductors'])
    expect(three.map((m) => m.loadPct)).toEqual([34, 33, 33])
    // Valid as it stands: a form can be saved the moment its muscles are chosen.
    for (const n of [1, 2, 3, 6, 7, 12]) {
      const loads = evenLoads(Array.from({ length: n }, (_, i) => MUSCLES[i]?.slug ?? 'quadriceps'))
      expect(loads.reduce((sum, m) => sum + m.loadPct, 0)).toBe(100)
    }
  })

  test('are none for none', () => {
    expect(evenLoads([])).toEqual([])
  })
})
