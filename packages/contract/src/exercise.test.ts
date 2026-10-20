import { describe, expect, test } from 'bun:test'
import { Exercise, ExerciseCreate, exerciseInputFrom } from './exercise.ts'

/** An exercise with every input field set away from its default, so a dropped one shows. */
const exercise = Exercise.parse({
  id: crypto.randomUUID(),
  name: 'Single-arm Row',
  tracking: 'weight_reps',
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
