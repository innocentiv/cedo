import { describe, expect, test } from 'bun:test'
import type { SetTarget } from './progression.ts'
import type { FlowEntry, FlowLog } from './session-flow.ts'
import { type Chosen, NO_CHOICES, type WorkoutChoices, choicesAfter } from './workout-choices.ts'
import { workoutView } from './workout-view.ts'

/** What the workout screen shows (#24): the focus, the set shown above it, and "+ set". */

const target = (reps: number, kg: number): SetTarget => ({
  reps,
  weightG: kg * 1000,
  reserve: null,
  durationS: null,
  distanceMm: null,
})

const entry = (
  id: string,
  index: number,
  sets: { warmups?: number; working: number },
): FlowEntry => ({
  id,
  index,
  supersetGroup: null,
  exercise: {},
  sets: [
    ...Array.from({ length: sets.warmups ?? 0 }, (_, i) => ({
      index: i,
      isWarmup: true,
      target: target(5, 20 + i * 20),
    })),
    ...Array.from({ length: sets.working }, (_, i) => ({
      index: (sets.warmups ?? 0) + i,
      isWarmup: false,
      target: target(5, 100),
    })),
  ],
})

let clock = Date.parse('2026-10-25T18:00:00Z')
const log = (entryId: string | null): FlowLog => {
  clock += 60_000
  return {
    id: crypto.randomUUID(),
    entryId,
    isWarmup: false,
    loggedAt: new Date(clock).toISOString(),
    reps: 5,
    weightG: 100_000,
    durationS: null,
    distanceMm: null,
  }
}

describe('what the workout shows', () => {
  const squat = entry('squat', 0, { working: 2 })
  const rdl = entry('rdl', 1, { working: 1 })
  const gone = { ...entry('gone', 2, { working: 1 }), exercise: null }
  const day = { entries: [squat, rdl, gone] }
  const bar = { stepG: 5000, minG: 25_000, maxG: null, assisted: false, unit: 'kg' as const }
  /** A set as the workout reads it: of a plan entry, or — `entryId` null — of an exercise with none. */
  const set = (entryId: string | null, exerciseId = entryId ?? 'curl') => ({
    ...log(entryId),
    exerciseId,
  })
  const added = [{ id: 'curl' }, { id: 'dip' }]
  const view = (
    sets: ReturnType<typeof set>[],
    options: Partial<Parameters<typeof workoutView>[0]> = {},
  ) =>
    workoutView({
      day,
      targets: [
        {
          entryId: 'squat',
          target: target(5, 102),
          working: [target(5, 102), target(5, 102)],
          warmups: [],
        },
      ],
      sets,
      added: [],
      choices: NO_CHOICES,
      loadFor: () => bar,
      ...options,
    })
  const focusId = (v: ReturnType<typeof view>) =>
    v.focus.kind === 'entry'
      ? v.focus.entry.id
      : v.focus.kind === 'added'
        ? v.focus.exercise.id
        : v.focus.kind

  test('the day’s own focus, with its sets as the session asks them and the athlete loads them', () => {
    const v = view([])
    expect(focusId(v)).toBe('squat')
    if (v.focus.kind !== 'entry') throw new Error(v.focus.kind)
    // The session's own target as sent: the server asked it as the athlete loads it.
    expect(v.focus.sets.map((s) => s.target.weightG)).toEqual([102_000, 102_000])
    expect(v.focus.asked?.target.weightG).toBe(102_000)
    expect(v.current).toEqual({ upNext: squat, addedToday: null })
    // The plan's own warm-up, on their bar: 20 kg under a 25 kg bar is the bar.
    const warm = view([], { day: { entries: [entry('squat', 0, { warmups: 1, working: 1 })] } })
    expect(warm.focus.kind === 'entry' && warm.focus.sets[0]?.target.weightG).toBe(25_000)
  })

  test('an entry chosen takes the focus from the day’s order, and is the row marked', () => {
    const v = view([], { choices: { chosen: { entry: 'rdl' }, undone: null } })
    expect(focusId(v)).toBe('rdl')
    expect(v.current.upNext?.id).toBe('rdl')
  })

  test('an entry chosen that the reader cannot see says so, logs nothing, and is the row marked', () => {
    const v = view([], { choices: { chosen: { entry: 'gone' }, undone: null } })
    expect(v.focus).toEqual({ kind: 'unavailable', entry: gone })
    expect(v.current.upNext).toBe(gone)
  })

  test('a swap logged last keeps the focus, marked among those added', () => {
    const v = view([set('squat'), set(null, 'dip')], { added })
    expect(focusId(v)).toBe('dip')
    expect(v.current).toEqual({ upNext: null, addedToday: 'dip' })
  })

  // That picking chooses is the app's, proven by the journeys: here, only what a choice does.
  test('an exercise added and chosen takes the focus from the day', () => {
    const choices = { chosen: { added: 'curl' }, undone: null }
    expect(focusId(view([set('squat')], { added, choices }))).toBe('curl')
  })

  test('an exercise added, neither chosen nor logged last, leaves the day its focus', () => {
    // Logged, then a set of the day: the day has its focus back, though curl was the last added.
    expect(focusId(view([set(null, 'curl'), set('squat')], { added }))).toBe('squat')
  })

  test('the day done once every set it asks is logged; none marked', () => {
    const v = view([set('squat'), set('squat'), set('rdl')])
    expect(v.focus).toEqual({ kind: 'done' })
    expect(v.current.upNext).toBeNull()
  })

  test('the set shown is the one logged last, as its entry’s exercise', () => {
    const sets = [set('squat'), set('rdl')]
    expect(view(sets).shown).toEqual({ log: sets[1]!, exercise: rdl.exercise })
    expect(view([]).shown).toBeNull()
  })

  /**
   * Undo puts back what the set said (#63): one wrong number is fixed, and the set logged again.
   */
  const undone = (entryId: string | null, exerciseId = entryId ?? 'curl') => ({
    entryId,
    exerciseId,
    effort: { reps: 6, weightG: 95_000, durationS: null, distanceMm: null },
    reserve: 2,
  })

  test('a set undone takes the focus to its entry, which starts from what the set said', () => {
    // Squat has a set left, so the day's own focus is squat: the set undone was rdl's.
    const choices = { chosen: null, undone: undone('rdl') }
    const v = view([set('squat')], { choices })
    expect(focusId(v)).toBe('rdl')
    expect(v.focus.kind === 'entry' && v.focus.undone).toEqual(undone('rdl'))
    expect(v.current.upNext?.id).toBe('rdl')
  })

  /**
   * Undo ends the rest with the set (#63): the set before is not shown as just logged again — nor
   * its rest, nor its Undo — until the next set is logged. Log is back.
   */
  test('after an undo, no set is just logged — nor "+ set" — until the next', () => {
    const sets = [set('squat'), set('squat')]
    const v = view(sets, { choices: { chosen: null, undone: undone('rdl') } })
    expect(v.shown).toBeNull()
    expect(v.another).toBeNull()
    const adHoc = view([set(null, 'curl')], {
      day: null,
      added,
      choices: { chosen: null, undone: undone(null, 'curl') },
    })
    expect(adHoc.shown).toBeNull()
  })

  test('a swap’s set undone takes the focus to its exercise, which starts from it', () => {
    const v = view([set('squat')], {
      added,
      choices: { chosen: null, undone: undone(null, 'dip') },
    })
    expect(focusId(v)).toBe('dip')
    expect(v.focus.kind === 'added' && v.focus.undone).toEqual(undone(null, 'dip'))
  })

  test('a choice made after a set is undone takes the focus, and starts from its own target', () => {
    const choices = { chosen: { entry: 'squat' }, undone: undone('rdl') }
    const v = view([set('squat')], { choices })
    expect(focusId(v)).toBe('squat')
    expect(v.focus.kind === 'entry' && v.focus.undone).toBeNull()
  })

  test('a set undone of an entry does not fill the same exercise added to the day', () => {
    const choices = { chosen: { added: 'squat' }, undone: undone('squat') }
    const v = view([set('squat')], { added: [{ id: 'squat' }], choices })
    expect(focusId(v)).toBe('squat')
    expect(v.focus.kind === 'added' && v.focus.undone).toBeNull()
  })

  test('"+ set" goes to the entry of the set shown once it has all it asked, and only then', () => {
    expect(view([set('squat')]).another).toBeNull()
    expect(view([set('squat'), set('squat')]).another).toBe('squat')
    // The day's last set — its focus done — still offers one more of its entry.
    expect(view([set('squat'), set('squat'), set('rdl')]).another).toBe('rdl')
    // A swap's set shown offers nothing: there is no prescription to go beyond.
    expect(view([set('squat'), set('squat'), set(null)], { added }).another).toBeNull()
  })

  describe('without a plan', () => {
    const adHoc = (sets: ReturnType<typeof set>[], options: Parameters<typeof view>[1] = {}) =>
      view(sets, { day: null, added, ...options })

    test('nothing in focus before anything is added', () => {
      const v = view([], { day: null })
      expect(v.focus).toEqual({ kind: 'none' })
      expect(v.current).toEqual({ upNext: null, addedToday: null })
    })

    test('the focus: chosen, else logged last, else the last', () => {
      const curl = [set(null, 'curl')]
      expect(focusId(adHoc(curl, { choices: { chosen: { added: 'dip' }, undone: null } }))).toBe(
        'dip',
      )
      expect(focusId(adHoc([set(null, 'dip'), ...curl]))).toBe('curl')
      expect(focusId(adHoc([]))).toBe('dip')
      expect(adHoc(curl).current.addedToday).toBe('curl')
    })

    test('the set shown: the last logged; never "+ set"', () => {
      const sets = [set(null, 'curl'), set(null, 'dip')]
      expect(adHoc(sets).shown).toEqual({ log: sets[1]!, exercise: { id: 'dip' } })
      expect(adHoc(sets).another).toBeNull()
    })

    test('a set undone takes the focus to its exercise, which starts from it', () => {
      const v = adHoc([set(null, 'dip')], {
        choices: { chosen: null, undone: undone(null, 'curl') },
      })
      expect(focusId(v)).toBe('curl')
      expect(v.focus.kind === 'added' && v.focus.undone).toEqual(undone(null, 'curl'))
    })

    /**
     * The plan gone out of reach mid-session: a set undone on one of its entries is no set here.
     */
    test('a set undone on a plan entry is not one of an exercise logged with none', () => {
      const v = adHoc([set(null, 'curl')], {
        choices: { chosen: null, undone: undone('squat', 'curl') },
      })
      expect(v.focus.kind === 'added' && v.focus.undone).toBeNull()
    })
  })

  /**
   * What the athlete chose, after what they did (GLOSSARY.md, "Focus"): `choicesAfter`, the one rule
   * of it — each thing done on the workout screen, from what was held.
   */
  describe('what the athlete chose, after what they did', () => {
    /** A set as it is undone: what `undone(…)` says it said. */
    const undoneSet = (entryId: string | null, exerciseId = entryId ?? 'curl') => ({
      ...set(entryId, exerciseId),
      reps: 6,
      weightG: 95_000,
      reserve: 2,
    })
    const chose = (chosen: Chosen): WorkoutChoices => ({ chosen, undone: null })
    const heldUndo: WorkoutChoices = { chosen: null, undone: undone('rdl') }

    test('a tap chooses, over what was chosen; a set undone stays undone', () => {
      const tapped = (chosen: Chosen) => ({ kind: 'tapped', chosen }) as const
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

    test('a set logged forgets everything: the next set ends a choice, and an undo', () => {
      const held = { chosen: { entry: 'rdl' }, undone: undone('squat') }
      expect(choicesAfter(held, { kind: 'logged' })).toEqual(NO_CHOICES)
    })

    test('a set undone is held, as it said, over what was chosen and any set undone before', () => {
      const held = { chosen: { entry: 'squat' }, undone: undone(null, 'dip') }
      expect(choicesAfter(held, { kind: 'undone', set: undoneSet('rdl') })).toEqual(heldUndo)
    })
  })
})
