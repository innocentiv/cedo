import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ERROR_CODES, ErrorCode, HTTP_STATUS_BY_ERROR_CODE } from './error.ts'
import { ExerciseCreate, ExerciseQuery, ExerciseUpdate } from './exercise.ts'
import { MUSCLES, MUSCLE_SLUGS, MuscleSlug } from './muscle.ts'
import { PaginationQuery } from './primitives.ts'
import { MeUpdate, RegisterInput } from './user.ts'
import { WorkoutPlanInput, WorkoutQuery, WorkoutUpdate } from './workout.ts'

const validMuscles = [
  { muscle: 'pectoralis_major', loadPct: 70 },
  { muscle: 'triceps_brachii', loadPct: 30 },
]

describe('muscles are a closed, hardcoded set', () => {
  test('slugs are unique', () => {
    expect(new Set(MUSCLE_SLUGS).size).toBe(MUSCLES.length)
  })

  test('every muscle has a name and a valid region', () => {
    for (const m of MUSCLES) {
      expect(m.name.length).toBeGreaterThan(0)
      expect(['upper', 'core', 'lower']).toContain(m.region)
    }
  })

  /**
   * MCP exposes input schemas as JSON Schema, and that is how an AI learns which muscles exist.
   * A refinement would validate correctly but advertise nothing — so this must stay a real enum.
   */
  test('serialises to JSON Schema as an explicit enum of every slug', () => {
    const json = z.toJSONSchema(MuscleSlug) as { enum?: unknown[] }
    expect(json.enum).toEqual(MUSCLE_SLUGS)
  })

  test('rejects a plausible-but-wrong slug', () => {
    expect(MuscleSlug.safeParse('bicep').success).toBe(false)
    expect(MuscleSlug.safeParse('Quadriceps').success).toBe(false)
  })
})

describe('input schemas are strict', () => {
  /**
   * Strictness is an AI-safety property: `{ nam: 'Bench' }` from a mistaken tool call becomes a
   * loud validation error instead of an exercise with an empty name.
   */
  test.each([
    ['ExerciseCreate', ExerciseCreate, { name: 'Bench', muscles: validMuscles }],
    [
      'RegisterInput',
      RegisterInput,
      { username: 'val', password: 'hunter2hunter2', displayName: 'Val' },
    ],
    ['WorkoutPlanInput', WorkoutPlanInput, { days: [{ name: 'Day 1', entries: [] }] }],
  ] as const)('%s rejects unknown keys', (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true)
    expect(schema.safeParse({ ...valid, unexpected: 'x' }).success).toBe(false)
  })
})

describe('ExerciseCreate invariants', () => {
  test('muscle loads must sum to exactly 100', () => {
    for (const loads of [[70], [70, 40], [50, 49]]) {
      const muscles = loads.map((loadPct, i) => ({ muscle: MUSCLE_SLUGS[i]!, loadPct }))
      expect(ExerciseCreate.safeParse({ name: 'X', muscles }).success).toBe(false)
    }
    expect(ExerciseCreate.safeParse({ name: 'X', muscles: validMuscles }).success).toBe(true)
  })

  test('a muscle may not appear twice', () => {
    const result = ExerciseCreate.safeParse({
      name: 'X',
      muscles: [
        { muscle: 'quadriceps', loadPct: 50 },
        { muscle: 'quadriceps', loadPct: 50 },
      ],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('only once')
  })

  test('at least one muscle is required', () => {
    expect(ExerciseCreate.safeParse({ name: 'X', muscles: [] }).success).toBe(false)
  })

  test('optional fields get defaults so the database never sees undefined', () => {
    const parsed = ExerciseCreate.parse({ name: 'X', muscles: validMuscles })
    expect(parsed).toMatchObject({
      description: '',
      instructions: '',
      equipment: null,
      isUnilateral: false,
      mediaIds: [],
    })
  })
})

describe('ExerciseUpdate applies invariants only to fields being set', () => {
  test('a name-only patch is valid', () => {
    expect(ExerciseUpdate.safeParse({ name: 'Renamed' }).success).toBe(true)
  })

  test('an empty patch is valid', () => {
    expect(ExerciseUpdate.safeParse({}).success).toBe(true)
  })

  test('but a muscles patch is still checked', () => {
    expect(
      ExerciseUpdate.safeParse({ muscles: [{ muscle: 'quadriceps', loadPct: 99 }] }).success,
    ).toBe(false)
  })

  /**
   * A field the caller omitted must stay ABSENT, not arrive as its create-time default. Zod applies
   * `.default()` even inside `.partial()`, so a description-only patch used to come out carrying
   * `tracking: 'weight_reps'` and `mediaIds: []` — and the service, rightly treating every present
   * key as an instruction, reset the tracking mode and detached every image.
   */
  test('omitted fields stay omitted, rather than becoming their defaults', () => {
    expect(ExerciseUpdate.parse({ description: 'x' })).toEqual({ description: 'x' })
  })
})

describe('WorkoutUpdate', () => {
  test('omitted fields stay omitted, rather than becoming their defaults', () => {
    expect(WorkoutUpdate.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
  })

  test('an explicit null still clears the notes', () => {
    expect(WorkoutUpdate.parse({ notes: null })).toEqual({ notes: null })
  })
})

describe('query schemas coerce, because query strings are always strings', () => {
  test('limit arrives as a string and parses as a number', () => {
    expect(PaginationQuery.parse({ limit: '25' })).toEqual({ limit: 25 })
    expect(PaginationQuery.parse({})).toEqual({ limit: 50 })
  })

  test('limit is bounded so a caller cannot request the whole table', () => {
    expect(PaginationQuery.safeParse({ limit: '1000' }).success).toBe(false)
    expect(PaginationQuery.safeParse({ limit: '0' }).success).toBe(false)
  })

  test.each([
    ['exercises', ExerciseQuery],
    ['workouts', WorkoutQuery],
  ] as const)("scope 'group' requires a groupId, for %s", (_, query) => {
    expect(query.safeParse({ scope: 'group' }).success).toBe(false)
    expect(query.safeParse({ scope: 'group', groupId: crypto.randomUUID() }).success).toBe(true)
    expect(query.safeParse({ scope: 'mine' }).success).toBe(true)
  })
})

describe('workout plan input', () => {
  const entry = (supersetGroup: string | null) => ({
    exerciseId: crypto.randomUUID(),
    supersetGroup,
    sets: [{ targetReps: 10 }],
  })

  test('superset groups are single uppercase letters', () => {
    expect(
      WorkoutPlanInput.safeParse({ days: [{ name: 'D', entries: [entry('A')] }] }).success,
    ).toBe(true)
    expect(
      WorkoutPlanInput.safeParse({ days: [{ name: 'D', entries: [entry(null)] }] }).success,
    ).toBe(true)
    for (const bad of ['a', 'AB', '1', '']) {
      expect(
        WorkoutPlanInput.safeParse({ days: [{ name: 'D', entries: [entry(bad)] }] }).success,
      ).toBe(false)
    }
  })

  test('an entry must prescribe at least one set', () => {
    const noSets = { exerciseId: crypto.randomUUID(), sets: [] }
    expect(WorkoutPlanInput.safeParse({ days: [{ name: 'D', entries: [noSets] }] }).success).toBe(
      false,
    )
  })

  test('a plan must have at least one day', () => {
    expect(WorkoutPlanInput.safeParse({ days: [] }).success).toBe(false)
  })

  /** Order is array position; indices are assigned by the server. */
  test('inputs carry no indices', () => {
    const withIndex = { exerciseId: crypto.randomUUID(), index: 0, sets: [{ targetReps: 5 }] }
    expect(
      WorkoutPlanInput.safeParse({ days: [{ name: 'D', entries: [withIndex] }] }).success,
    ).toBe(false)
  })

  test('progression defaults to none', () => {
    const parsed = WorkoutPlanInput.parse({ days: [{ name: 'D', entries: [entry(null)] }] })
    expect(parsed.days[0]?.entries[0]?.progression).toEqual({ kind: 'none' })
  })
})

describe('error envelope', () => {
  test('every error code maps to an HTTP status', () => {
    for (const code of ERROR_CODES) {
      expect(HTTP_STATUS_BY_ERROR_CODE[code]).toBeGreaterThanOrEqual(400)
    }
    expect(Object.keys(HTTP_STATUS_BY_ERROR_CODE).toSorted()).toEqual([...ERROR_CODES].toSorted())
  })

  /** A 403 would confirm the resource exists. See docs/02-conventions.md. */
  test("there is deliberately no 'forbidden' code", () => {
    expect(ErrorCode.safeParse('forbidden').success).toBe(false)
  })
})

describe('what a person may change about themselves', () => {
  test('their weight unit, kg or lb, and nothing else', () => {
    expect(MeUpdate.safeParse({ weightUnit: 'lb' }).success).toBe(true)
    expect(MeUpdate.safeParse({ weightUnit: 'stone' }).success).toBe(false)
    // Strict: a stray field is a mistake to report, not a silent no-op.
    expect(MeUpdate.safeParse({ weightUnit: 'kg', displayName: 'x' }).success).toBe(false)
  })
})
