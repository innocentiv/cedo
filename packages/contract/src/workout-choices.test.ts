import { describe, expect, test } from 'bun:test'
import {
  type ChoiceEvent,
  type Chosen,
  NO_CHOICES,
  type Undone,
  type WorkoutChoices,
  choicesAfter,
} from './workout-choices.ts'

/**
 * What the athlete chose, after what they did (GLOSSARY.md, "Focus"): `choicesAfter`, the one rule
 * of it — each thing done on the workout screen, from what was held. What a choice puts in focus is
 * workout-view.test.ts's, where these same events are run as the athlete goes.
 */

/** A set undone of `entryId` — null, of an exercise logged with none — as it said 6 × 95 kg. */
const undone = (entryId: string | null, exerciseId = entryId ?? 'curl'): Undone => ({
  entryId,
  exerciseId,
  effort: { reps: 6, weightG: 95_000, durationS: null, distanceMm: null },
  reserve: 2,
})

/** The set itself, as Undo is sent it: what `undone(…)` says it said. */
const undoneSet = (entryId: string | null, exerciseId = entryId ?? 'curl') => ({
  id: crypto.randomUUID(),
  entryId,
  exerciseId,
  isWarmup: false,
  loggedAt: '2026-10-25T18:00:00Z',
  reps: 6,
  weightG: 95_000,
  durationS: null,
  distanceMm: null,
  reserve: 2,
})

const chose = (chosen: Chosen): WorkoutChoices => ({ chosen, undone: null })
const tapped = (chosen: Chosen): ChoiceEvent => ({ kind: 'tapped', chosen })
const heldUndo: WorkoutChoices = { chosen: null, undone: undone('rdl') }

describe('what the athlete chose, after what they did', () => {
  test('a tap chooses, over what was chosen; a set undone stays undone', () => {
    expect(choicesAfter(chose({ entry: 'squat' }), tapped({ added: 'dip' }))).toEqual(
      chose({ added: 'dip' }),
    )
    expect(choicesAfter(heldUndo, tapped({ entry: 'squat' }))).toEqual({
      chosen: { entry: 'squat' },
      undone: undone('rdl'),
    })
  })

  test('picking chooses the first picked, as a tap would; picking nothing changes nothing', () => {
    const picked = choicesAfter(chose({ entry: 'rdl' }), {
      kind: 'picked',
      exercises: [{ id: 'dip' }, { id: 'curl' }],
    })
    expect(picked).toEqual(chose({ added: 'dip' }))
    expect(choicesAfter(heldUndo, { kind: 'picked', exercises: [] })).toBe(heldUndo)
  })

  test('opening the picker forgets what was chosen: what is picked takes the focus', () => {
    expect(choicesAfter(chose({ entry: 'rdl' }), { kind: 'pickerOpened' })).toEqual(NO_CHOICES)
  })

  test('opening the picker keeps a set undone: only the next set ends it', () => {
    const held = { chosen: { entry: 'squat' }, undone: undone('rdl') }
    expect(choicesAfter(held, { kind: 'pickerOpened' })).toEqual(heldUndo)
  })

  test('a set logged forgets everything: the next set ends a choice, and an undo', () => {
    const held = { chosen: { entry: 'rdl' }, undone: undone('squat') }
    expect(choicesAfter(held, { kind: 'logged' })).toEqual(NO_CHOICES)
  })

  test('a set undone is held, as it said, over what was chosen and any set undone before', () => {
    const held = { chosen: { entry: 'squat' }, undone: undone(null, 'dip') }
    expect(choicesAfter(held, { kind: 'undone', set: undoneSet('rdl') })).toEqual(heldUndo)
  })
})
