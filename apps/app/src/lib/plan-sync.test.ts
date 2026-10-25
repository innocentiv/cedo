import { describe, expect, test } from 'bun:test'
import type { Workout } from '@cedo/contract'
import { type DayDraft, keyDay, keyEntry, toPlanInput } from './plan-draft.ts'
import { type PlanSync, type SyncEvent, startSync, step, unsaved } from './plan-sync.ts'

/**
 * A plan edited in place (#26, ADR-0022): every change saved as made, one save at a time, the ids
 * of what is new learned from each answer, and a refused change put back.
 */

const squat = '00000000-0000-4000-8000-000000000001'
const bench = '00000000-0000-4000-8000-000000000002'

const set = {
  targetReps: 5,
  targetWeightG: 100_000,
  targetRpe: null,
  targetDurationS: null,
  targetDistanceMm: null,
  isWarmup: false,
}

/** The server's answer to a plan: what was sent, every day and entry given an id. */
let issued = 0
const nextId = () => {
  issued += 1
  return `00000000-0000-4000-9000-${String(issued).padStart(12, '0')}`
}
const answer = (days: readonly DayDraft[], version: number): Workout =>
  ({
    id: 'w',
    version,
    days: days.map((day, d) => ({
      id: day.id ?? nextId(),
      index: d,
      name: day.name,
      entries: day.entries.map((entry, e) => ({
        id: entry.id ?? nextId(),
        index: e,
        exerciseId: entry.exerciseId,
        sets: [],
      })),
    })),
  }) as unknown as Workout

const entry = (exerciseId: string) =>
  keyEntry({
    exerciseId,
    supersetGroup: null,
    restSeconds: null,
    cue: null,
    progression: { kind: 'none' as const },
    sets: [set],
  })

const start = (): PlanSync => startSync(answer([keyDay({ name: 'A', entries: [] })], 1))

const always = (_days: readonly DayDraft[]) => true

/** Runs events, collecting what each asked to send. */
function run(sync: PlanSync, events: readonly SyncEvent[], accepts = always) {
  const sent: (readonly DayDraft[])[] = []
  let state = sync
  for (const event of events) {
    const next = step(state, event, accepts)
    state = next.state
    if (next.send !== null) sent.push(next.send)
  }
  return { state, sent }
}

const addEntry = (sync: PlanSync, exerciseId: string): readonly DayDraft[] =>
  sync.days.map((day, i) =>
    i === 0 ? { ...day, entries: [...day.entries, entry(exerciseId)] } : day,
  )

describe('a plan edited in place', () => {
  test('sends a change at once, and is saved once the answer comes', () => {
    const sync = start()
    const { state, sent } = run(sync, [{ kind: 'edit', days: addEntry(sync, squat) }])
    expect(sent).toHaveLength(1)
    expect(unsaved(state)).toBe(true)

    const done = run(state, [{ kind: 'saved', workout: answer(state.sending ?? [], 2) }]).state
    expect(unsaved(done)).toBe(false)
    expect(done.version).toBe(2)
  })

  /** The bug the keys exist for: sent again without its id, a new entry was new on every save. */
  test("learns a new entry's id from the answer, and sends it back with the next change", () => {
    const sync = start()
    const first = run(sync, [{ kind: 'edit', days: addEntry(sync, squat) }]).state
    const answered = answer(first.sending ?? [], 2)
    const saved = run(first, [{ kind: 'saved', workout: answered }]).state
    const renamed = saved.days.map((day) => ({ ...day, name: 'Legs' }))
    const { sent } = run(saved, [{ kind: 'edit', days: renamed }])

    const plan = toPlanInput(sent[0] ?? [])
    expect(plan.days[0]?.entries[0]?.id).toBe(answered.days[0]?.entries[0]?.id)
  })

  test('sends one save at a time: a change made meanwhile waits, then goes as the plan stands', () => {
    const sync = start()
    const first = run(sync, [{ kind: 'edit', days: addEntry(sync, squat) }])
    const meanwhile = run(first.state, [
      { kind: 'edit', days: addEntry(first.state, bench) },
      { kind: 'edit', days: first.state.days.map((d) => ({ ...d, name: 'Legs' })) },
    ])
    expect(meanwhile.sent).toHaveLength(0)

    const answered = answer(first.state.sending ?? [], 2)
    const after = run(meanwhile.state, [{ kind: 'saved', workout: answered }])
    // The last change, made while the first was on its way — with the squat's id learned from it.
    expect(after.sent).toHaveLength(1)
    const plan = toPlanInput(after.sent[0] ?? [])
    expect(plan.days[0]?.name).toBe('Legs')
    expect(plan.days[0]?.entries[0]?.id).toBe(answered.days[0]?.entries[0]?.id)
    expect(after.state.version).toBe(2)
  })

  test('keeps a plan the schema would refuse on screen, unsent, until it is one it accepts', () => {
    const sync = start()
    const accepts = (days: readonly DayDraft[]) => days.every((d) => d.name !== '')
    const blank = sync.days.map((d) => ({ ...d, name: '' }))
    const { state, sent } = run(sync, [{ kind: 'edit', days: blank }], accepts)
    expect(sent).toHaveLength(0)
    expect(unsaved(state)).toBe(true)
    const fixed = state.days.map((d) => ({ ...d, name: 'Legs' }))
    expect(run(state, [{ kind: 'edit', days: fixed }], accepts).sent).toHaveLength(1)
  })

  test('puts a refused change back to the plan as last saved, and says why', () => {
    const sync = start()
    const sent = run(sync, [{ kind: 'edit', days: addEntry(sync, squat) }]).state
    const { state } = run(sent, [{ kind: 'refused', reason: 'No such exercise' }])
    expect(state.days).toBe(sync.saved)
    expect(state.said).toBe('No such exercise')
    expect(unsaved(state)).toBe(false)
  })

  test('takes the plan read again after a conflict, and says it changed elsewhere', () => {
    const sync = start()
    const sent = run(sync, [{ kind: 'edit', days: addEntry(sync, squat) }]).state
    const elsewhere = answer([keyDay({ name: 'Theirs', entries: [] })], 5)
    const { state } = run(sent, [{ kind: 'reloaded', workout: elsewhere, reason: 'Changed' }])
    expect(state.days.map((d) => d.name)).toEqual(['Theirs'])
    expect(state.version).toBe(5)
    expect(state.said).toBe('Changed')
  })

  test('takes a newer plan read meanwhile only when nothing here is unsaved', () => {
    const sync = start()
    const newer = answer([keyDay({ name: 'Theirs', entries: [] })], 3)
    expect(run(sync, [{ kind: 'fetched', workout: newer }]).state.days[0]?.name).toBe('Theirs')

    const editing = run(sync, [{ kind: 'edit', days: addEntry(sync, squat) }]).state
    expect(run(editing, [{ kind: 'fetched', workout: newer }]).state).toBe(editing)
    // Its own save, read back: not newer than what it already knows.
    const same = answer(sync.days, 1)
    expect(run(sync, [{ kind: 'fetched', workout: same }]).state).toBe(sync)
  })
})
