import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  EQUIPMENT,
  EQUIPMENT_SLUGS,
  EquipmentSlug,
  ExerciseEquipment,
  equipmentLine,
  isWeighted,
  withEquipmentToggled,
} from './equipment.ts'
import { ExerciseCreate, ExerciseUpdate } from './exercise.ts'

describe('the equipment list', () => {
  /** How an AI learns what there is: a refinement would validate, and advertise nothing. */
  test('serialises to JSON Schema as an explicit enum of every item', () => {
    const json = z.toJSONSchema(EquipmentSlug) as { enum?: unknown[] }
    expect(json.enum).toEqual(EQUIPMENT_SLUGS)
  })

  test('names each item once', () => {
    const slugs = EQUIPMENT.map((e) => e.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  test('the load sits on dumbbells, a bar, a pulley or a machine — never on a rack or a bench', () => {
    expect(isWeighted('dumbbells')).toBe(true)
    expect(isWeighted('high_pulley')).toBe(true)
    expect(isWeighted('leg_press')).toBe(true)
    expect(isWeighted('rack')).toBe(false)
    expect(isWeighted('flat_bench')).toBe(false)
  })
})

describe('what an exercise needs', () => {
  test('undescribed and needing nothing are both allowed, and kept apart', () => {
    expect(ExerciseEquipment.parse(null)).toBeNull()
    expect(ExerciseEquipment.parse([])).toEqual([])
    expect(equipmentLine(null)).toBe('Not described')
    expect(equipmentLine([])).toBe('None needed')
    expect(equipmentLine(['barbell', 'rack'])).toBe('Barbell, Rack')
  })

  test('an item only from the list, and each once', () => {
    expect(ExerciseEquipment.safeParse(['Barbell']).success).toBe(false)
    expect(ExerciseEquipment.safeParse(['rack', 'rack']).success).toBe(false)
  })

  test('the load on one item at most: dumbbells or a barbell, not both', () => {
    expect(ExerciseEquipment.safeParse(['barbell', 'rack', 'flat_bench']).success).toBe(true)
    expect(ExerciseEquipment.safeParse(['barbell', 'dumbbells']).success).toBe(false)
  })

  test('no exercise needs a weight belt — it loads one done without it', () => {
    expect(ExerciseEquipment.safeParse(['weight_belt', 'pull_up_bar']).success).toBe(false)
  })

  test('an exercise left unsaid is undescribed; a patch that names none leaves it alone', () => {
    const muscles = [{ muscle: 'quadriceps', loadPct: 100 }]
    expect(ExerciseCreate.parse({ name: 'Squat', muscles }).equipment).toBeNull()
    expect(ExerciseUpdate.parse({ name: 'Squat' })).not.toHaveProperty('equipment')
  })
})

describe('an item chosen on a form', () => {
  test('from undescribed, an item is the first need; dropping the last goes back to undescribed', () => {
    expect(withEquipmentToggled(null, 'barbell')).toEqual(['barbell'])
    expect(withEquipmentToggled(['barbell'], 'rack')).toEqual(['barbell', 'rack'])
    expect(withEquipmentToggled(['barbell', 'rack'], 'barbell')).toEqual(['rack'])
    expect(withEquipmentToggled(['rack'], 'rack')).toBeNull()
  })

  test('"nothing" drops every item, an item ends "nothing", and "nothing" again is undescribed', () => {
    expect(withEquipmentToggled(['barbell', 'rack'], 'nothing')).toEqual([])
    expect(withEquipmentToggled(null, 'nothing')).toEqual([])
    expect(withEquipmentToggled([], 'dumbbells')).toEqual(['dumbbells'])
    expect(withEquipmentToggled([], 'nothing')).toBeNull()
  })
})
