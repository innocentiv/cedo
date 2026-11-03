import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { PlanSave } from './workout.ts'

/**
 * Every field of a plan teaches the model what it means (docs/07-mcp.md, "A plan teaches its own
 * model"): the JSON Schema `workout_save_plan` publishes is all a model reads of it — a doc comment
 * never reaches it. A field added without a description fails here, by its path.
 */
const isNode = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function undescribed(schema: unknown, path: string): string[] {
  if (!isNode(schema)) return []
  const properties = isNode(schema['properties']) ? Object.entries(schema['properties']) : []
  const own = properties.flatMap(([name, field]) => {
    const at = `${path}.${name}`
    const missing = isNode(field) && 'description' in field ? [] : [at]
    return missing.concat(undescribed(field, at))
  })
  const nested = ['items', 'anyOf', 'oneOf', 'allOf', 'prefixItems'].flatMap((key) => {
    const value = schema[key]
    if (Array.isArray(value)) return value.flatMap((v, i) => undescribed(v, `${path}[${i}]`))
    return undescribed(value, `${path}[]`)
  })
  return own.concat(nested)
}

describe('the plan schema, as a model reads it', () => {
  test('every field carries a description', () => {
    expect(undescribed(z.toJSONSchema(PlanSave, { io: 'input' }), 'plan')).toEqual([])
  })
})
