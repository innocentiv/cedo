import { describe, expect, test } from 'bun:test'
import type { SetTarget } from './progression.ts'
import type { FlowEntry, FlowLog } from './session-flow.ts'
import { NO_CHOICES, workoutView } from './workout-view.ts'

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
    const v = view([], { choices: { chosen: { entry: 'rdl' }, reopened: null } })
    expect(focusId(v)).toBe('rdl')
    expect(v.current.upNext?.id).toBe('rdl')
  })

  test('an entry chosen that the reader cannot see says so, logs nothing, and is the row marked', () => {
    const v = view([], { choices: { chosen: { entry: 'gone' }, reopened: null } })
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
    const choices = { chosen: { added: 'curl' }, reopened: null }
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

  test('a set re-opened from its mark is shown instead, and marked on the focus', () => {
    const sets = [set('squat')]
    const reopened = { entryId: 'squat', exerciseId: 'squat', key: 's0' }
    const v = view(sets, { choices: { chosen: null, reopened } })
    expect(v.shown?.log).toBe(sets[0])
    if (v.focus.kind !== 'entry') throw new Error(v.focus.kind)
    expect(v.focus.selected).toBe('s0')
    // Of another entry than the focus, nothing is marked on it.
    const other = view(sets, { choices: { chosen: { entry: 'rdl' }, reopened } })
    expect(other.focus.kind === 'entry' && other.focus.selected).toBeNull()
  })

  test('a swap’s set re-opened is shown, as its exercise', () => {
    const sets = [set(null, 'dip'), set(null, 'dip')]
    const reopened = { entryId: null, exerciseId: 'dip', key: 's0' }
    const v = view(sets, { added, choices: { chosen: null, reopened } })
    expect(v.shown).toEqual({ log: sets[0]!, exercise: { id: 'dip' } })
    expect(v.focus.kind === 'added' && v.focus.selected).toBe('s0')
  })

  test('a swap’s set re-opened after an entry’s is shown as the swap’s exercise', () => {
    const sets = [set(null, 'dip'), set('squat')]
    const reopened = { entryId: null, exerciseId: 'dip', key: 's0' }
    const v = view(sets, { added, choices: { chosen: null, reopened } })
    expect(v.shown).toEqual({ log: sets[0]!, exercise: { id: 'dip' } })
    expect(v.another).toBeNull()
  })

  test('a set re-opened on an entry is not marked on the same exercise added to the day', () => {
    // The squat both prescribed and added: its entry's first set is no set of the one added.
    const reopened = { entryId: 'squat', exerciseId: 'squat', key: 's0' }
    const choices = { chosen: { added: 'squat' }, reopened }
    const v = view([set('squat')], { added: [{ id: 'squat' }], choices })
    expect(focusId(v)).toBe('squat')
    expect(v.focus.kind === 'added' && v.focus.selected).toBeNull()
  })

  test('"+ set" goes to the entry of the set shown once it has all it asked, and only then', () => {
    expect(view([set('squat')]).another).toBeNull()
    expect(view([set('squat'), set('squat')]).another).toBe('squat')
    // Re-opened, a set of an entry done offers it while the focus is elsewhere.
    const sets = [set('rdl'), set('squat')]
    const reopened = { entryId: 'rdl', exerciseId: 'rdl', key: 's0' }
    expect(view(sets, { choices: { chosen: null, reopened } }).another).toBe('rdl')
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
      expect(focusId(adHoc(curl, { choices: { chosen: { added: 'dip' }, reopened: null } }))).toBe(
        'dip',
      )
      expect(focusId(adHoc([set(null, 'dip'), ...curl]))).toBe('curl')
      expect(focusId(adHoc([]))).toBe('dip')
      expect(adHoc(curl).current.addedToday).toBe('curl')
    })

    test('the set shown: re-opened, else the last logged; never "+ set"', () => {
      const sets = [set(null, 'curl'), set(null, 'dip')]
      expect(adHoc(sets).shown).toEqual({ log: sets[1]!, exercise: { id: 'dip' } })
      const reopened = { entryId: null, exerciseId: 'curl', key: 's0' }
      const v = adHoc(sets, { choices: { chosen: null, reopened } })
      expect(v.shown?.log).toBe(sets[0])
      expect(v.another).toBeNull()
    })

    /** The plan gone out of reach mid-session: a set re-opened on one of its entries is no set here. */
    test('a set re-opened on a plan entry is not one of an exercise logged with none', () => {
      const sets = [set(null, 'curl'), set(null, 'curl')]
      const reopened = { entryId: 'squat', exerciseId: 'curl', key: 's0' }
      const v = adHoc(sets, { choices: { chosen: null, reopened } })
      expect(v.shown?.log).toBe(sets[1])
      expect(v.focus.kind === 'added' && v.focus.selected).toBeNull()
    })
  })
})
