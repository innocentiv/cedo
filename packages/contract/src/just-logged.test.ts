import { describe, expect, test } from 'bun:test'
import { justLogged } from './just-logged.ts'
import type { SetTarget } from './progression.ts'
import { type RestEvent, restHeldAfter } from './rest-held.ts'
import type { SessionRest } from './rest.ts'
import { NO_CHOICES, type WorkoutChoices, choicesAfter } from './workout-choices.ts'
import { workoutView } from './workout-view.ts'

/**
 * What stands in Log's place once a set is logged (#63), as the athlete goes: the session's sets
 * read through `workoutView`, what the phone holds of the rest through `restHeldAfter`, and the
 * answer through `justLogged` — with no browser. Where a rest stands at a time, and when its end
 * chimes, are `rest.test.ts`'s tables; that the screen sends each tap is one journey's
 * (journeys.e2e.ts, "Undo in Log’s place takes the set back, holding what it said; Skip and +30 s").
 */

const asks: SetTarget = { reps: 8, weightG: 60_000, reserve: 2, durationS: null, distanceMm: null }

const entry = (id: string, name: string, restSeconds: number, supersetGroup: string | null) => ({
  id,
  index: id === 'bench' ? 0 : 1,
  supersetGroup,
  restSeconds,
  exercise: { name, tracking: 'weight_reps' as const },
  sets: [0, 1, 2].map((index) => ({ index, isWarmup: false, target: asks })),
})
const bench = entry('bench', 'Bench Press', 120, null)
const row = entry('row', 'Barbell Row', 60, null)
/** An entry of the day — its exercise null once it is out of the reader's reach. */
type Entry = Omit<typeof bench, 'exercise'> & { readonly exercise: typeof bench.exercise | null }

const START = Date.parse('2026-11-14T18:00:00Z')
/** Seconds into the session, as a time. */
const at = (seconds: number): number => START + seconds * 1000

/** A set as the phone holds it until the server has it: its id is the key it was sent under. */
const waitingSet = (entryId: string, loggedS: number, id = `key-${String(loggedS)}`) => ({
  id,
  entryId,
  exerciseId: `${entryId}-exercise`,
  isWarmup: false,
  loggedAt: new Date(at(loggedS)).toISOString(),
  reps: 8,
  weightG: 60_000,
  durationS: null,
  distanceMm: null,
  reserve: 2,
})
/** A set as the server has it. */
const set = (entryId: string, loggedS: number, personalBest = false) => ({
  ...waitingSet(entryId, loggedS, `set-${String(loggedS)}`),
  personalBest,
})
type Stored = ReturnType<typeof set>

const held = (...events: RestEvent[]) =>
  events.reduce<ReturnType<typeof restHeldAfter>>((h, event) => restHeldAfter(h, event), null)

/** Log's place, `seconds` into the session. */
const place = (
  seconds: number,
  session: {
    readonly server?: readonly Stored[]
    readonly waiting?: readonly ReturnType<typeof waitingSet>[]
    readonly entries?: readonly Entry[]
    readonly choices?: WorkoutChoices
    readonly held?: ReturnType<typeof held>
    readonly kept?: SessionRest | null
  },
) => {
  const server = session.server ?? []
  const view = workoutView({
    day: { entries: session.entries ?? [bench, row] },
    targets: [],
    sets: [...server, ...(session.waiting ?? [])],
    added: [],
    choices: session.choices ?? NO_CHOICES,
    loadFor: () => null,
  })
  return justLogged({
    shown: view.shown,
    rest: view.rest,
    server,
    held: session.held ?? null,
    kept: session.kept ?? null,
    unit: 'kg',
    now: at(seconds),
  })
}

describe('the set just logged, in Log’s place', () => {
  test('its rest runs there, with Undo and what the set said', () => {
    const first = set('bench', 0)
    const shown = place(10, { server: [first] })
    expect(shown.phase).toEqual({ phase: 'running', left: 110 })
    expect(shown.justLogged).toEqual({
      restLeft: 110,
      stored: first,
      title: 'Bench Press · set 1',
      effort: '8 × 60 kg · 2 in reserve',
      best: false,
      waiting: false,
    })
  })

  test('before the first set nothing is just logged', () => {
    const shown = place(0, {})
    expect([shown.phase, shown.justLogged]).toEqual([{ phase: 'none' }, null])
  })

  test('once its rest is over nothing is: Log is back, and the set is fixed from the list', () => {
    const shown = place(120, { server: [set('bench', 0)] })
    expect(shown.phase).toEqual({ phase: 'over', skipped: false })
    expect(shown.justLogged).toBeNull()
  })

  test('with no rest after it, it stays — Undo beside Log — until the next set', () => {
    const straightOn = [entry('bench', 'Bench Press', 0, null), row]
    const first = set('bench', 0)
    // An hour on, still: nothing but the next set ends it.
    const shown = place(3600, { server: [first], entries: straightOn })
    expect(shown.phase).toEqual({ phase: 'none' })
    expect(shown.justLogged).toMatchObject({ restLeft: null, stored: first })
    const second = set('bench', 3700)
    expect(place(3700, { server: [first, second], entries: straightOn }).justLogged).toMatchObject({
      stored: second,
      title: 'Bench Press · set 2',
    })
  })

  test('a superset’s first set keeps Undo beside the partner’s Log; the round’s last rests', () => {
    const pair = [entry('bench', 'Bench Press', 0, 'A'), entry('row', 'Barbell Row', 60, 'A')]
    const first = set('bench', 0)
    expect(place(5, { server: [first], entries: pair }).justLogged).toMatchObject({
      restLeft: null,
      stored: first,
      title: 'Bench Press · set 1',
    })
    const partner = set('row', 30)
    expect(place(40, { server: [first, partner], entries: pair }).justLogged).toMatchObject({
      restLeft: 50,
      stored: partner,
      title: 'Barbell Row · set 1',
    })
  })

  test('an undo ends it: the set before is not just logged again, nor does it rest', () => {
    const [first, second] = [set('bench', 0), set('bench', 200)]
    const choices = choicesAfter(NO_CHOICES, { kind: 'undone', set: second })
    // The first set's rest would still be running, had it come back.
    const shown = place(60, { server: [first], choices })
    expect([shown.phase, shown.justLogged]).toEqual([{ phase: 'none' }, null])
  })

  test('a personal best is said, and an exercise out of reach is named as one', () => {
    expect(place(10, { server: [set('bench', 0, true)] }).justLogged?.best).toBe(true)
    const gone = [{ ...bench, exercise: null }, row]
    expect(place(10, { server: [set('bench', 0)], entries: gone }).justLogged).toMatchObject({
      title: 'Unavailable exercise · set 1',
      effort: '8 × 60 kg · 2 in reserve',
    })
  })

  test('a set waiting for a signal rests, with no Undo yet and no number: the server has neither', () => {
    const first = set('bench', 0)
    const shown = place(210, { server: [first], waiting: [waitingSet('bench', 200)] })
    expect(shown.justLogged).toEqual({
      restLeft: 110,
      stored: null,
      title: 'Bench Press · set',
      effort: '8 × 60 kg · 2 in reserve',
      best: false,
      waiting: true,
    })
  })
})

describe('what the phone holds of a rest', () => {
  const first = set('bench', 0)
  const extended: RestEvent = { kind: 'extended', after: 1 }
  const seenRunning: RestEvent = { kind: 'seen', after: 1, running: true }

  test('+30 s lengthens the rest it was tapped on, each tap', () => {
    expect(place(10, { server: [first], held: held(extended) }).justLogged?.restLeft).toBe(140)
    const twice = place(10, { server: [first], held: held(extended, extended) })
    expect(twice.justLogged?.restLeft).toBe(170)
  })

  test('Skip ends it: Log is back, with no chime', () => {
    const skipped = held(seenRunning, { kind: 'skipped', after: 1 })
    const shown = place(10, { server: [first], held: skipped })
    expect(shown).toEqual({
      phase: { phase: 'over', skipped: true },
      chimes: false,
      justLogged: null,
    })
  })

  /** #38: held to the set's id or time, a tap was lost as a set logged without a signal landed. */
  test('a tap holds while its set reaches the server, renamed and dated again: the same rest', () => {
    const tapped = held(seenRunning, extended)
    const offline = place(10, { waiting: [waitingSet('bench', 0)], held: tapped })
    expect(offline.justLogged?.restLeft).toBe(140)
    // The server dated it two seconds after the phone did.
    const landed = place(10, { server: [set('bench', 2)], held: tapped })
    expect(landed.justLogged).toMatchObject({ restLeft: 142, waiting: false })
  })

  test('the next set — logged here or elsewhere — rests afresh: the taps were the last rest’s', () => {
    const skipped = held(extended, { kind: 'skipped', after: 1 })
    const sets = [first, set('bench', 300)]
    expect(place(310, { server: sets, held: skipped }).phase).toEqual({
      phase: 'running',
      left: 110,
    })
    // A tap on the new rest is its first.
    const again = restHeldAfter(skipped, { kind: 'extended', after: 2 })
    expect(place(310, { server: sets, held: again }).phase).toEqual({ phase: 'running', left: 140 })
  })

  test('a tap on another device, as the server keeps it, counts here too', () => {
    const kept = { since: first.loggedAt, endsAt: new Date(at(150)).toISOString() }
    expect(place(10, { server: [first], kept }).justLogged?.restLeft).toBe(140)
  })

  test('the rest seen running chimes as it runs out, and once', () => {
    const seen = held(seenRunning)
    expect(place(119, { server: [first], held: seen }).chimes).toBe(false)
    expect(place(120, { server: [first], held: seen }).chimes).toBe(true)
    // The screen, having heard it, sees a rest that no longer runs.
    const after = restHeldAfter(seen, { kind: 'seen', after: 1, running: false })
    expect(place(121, { server: [first], held: after }).chimes).toBe(false)
  })

  test('a rest opened already over is silent, and so is the one an undo goes back to', () => {
    expect(place(500, { server: [first] }).chimes).toBe(false)
    // The second set's rest was seen running; undone, the session is back at the first's, long over.
    const second = set('bench', 200)
    const seenSecond = held({ kind: 'seen', after: 2, running: true })
    const choices = choicesAfter(NO_CHOICES, { kind: 'undone', set: second })
    expect(place(500, { server: [first], held: seenSecond, choices }).chimes).toBe(false)
    // Removed from the list instead, nothing was undone here: the first set's rest is the one over.
    expect(place(500, { server: [first], held: seenSecond }).chimes).toBe(false)
  })

  test('nothing changed gives back what was held, itself', () => {
    const seen = held(seenRunning)
    expect(restHeldAfter(seen, seenRunning)).toBe(seen)
    const unseen = restHeldAfter(seen, { kind: 'seen', after: null, running: false })
    expect(restHeldAfter(unseen, { kind: 'seen', after: 1, running: false })).toBe(unseen)
    expect(restHeldAfter(null, { kind: 'seen', after: null, running: false })).toBeNull()
  })
})
