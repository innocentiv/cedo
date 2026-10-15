import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'

/**
 * The hole lint cannot see. `no-restricted-imports` stops a module importing a raw owned table, but
 * an `sql` template can still NAME one: `sql\`(select name from workouts where id = …)\`` is a join
 * no predicate is watching, and it is exactly how `dayBalance` once named a workout the caller had
 * lost. This scans every `sql` template outside the places allowed to touch raw tables and fails on
 * the name of any owned table in its literal text. See docs/adr/0019-visible-relations.md.
 */

const OWNED = [
  'exercises',
  'exercise_muscles',
  'exercise_media',
  'workouts',
  'workout_days',
  'workout_entries',
  'workout_sets',
]
const NAMED = new RegExp(String.raw`\b(${OWNED.join('|')})\b`, 'iu')

/** Where raw tables are allowed: the db layer, write files, tests, and one named exemption. */
const ALLOWED = [
  /^db\//u,
  /^modules\/[^/]+\/write[^/]*\.ts$/u,
  /^test\//u,
  /\.test\.ts$/u,
  // Instance-wide row counts for a curator, by design — every table, nobody's rows.
  /^modules\/review\/diagnostics\.ts$/u,
]

/** Index just past the expression that opens at `start` (the char after `${`). */
function skipExpression(source: string, start: number): number {
  let depth = 1
  let i = start
  while (i < source.length && depth > 0) {
    const ch = source[i]
    if (ch === '`') i = skipTemplate(source, i + 1).end
    else if (ch === "'" || ch === '"') i = skipString(source, i)
    else {
      if (ch === '{') depth += 1
      if (ch === '}') depth -= 1
      i += 1
    }
  }
  return i
}

function skipString(source: string, start: number): number {
  const quote = source[start]
  let i = start + 1
  while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1
  return i + 1
}

/** The literal text of a template opening at `start` (the char after the backtick), and its end. */
function skipTemplate(source: string, start: number): { text: string; end: number } {
  let text = ''
  let i = start
  while (i < source.length && source[i] !== '`') {
    if (source[i] === '\\') {
      text += source.slice(i, i + 2)
      i += 2
    } else if (source.startsWith('${', i)) {
      text += ' ? '
      i = skipExpression(source, i + 2)
    } else {
      text += source[i]
      i += 1
    }
  }
  return { text, end: i + 1 }
}

/** Every `sql\`…\``, `sql<T>\`…\``, `sql.raw(\`…\`)` and `sql.unsafe(\`…\`)` literal in a source file. */
export function sqlLiterals(source: string): string[] {
  const opener = /\bsql(?:<[^`>]*>)?`|\bsql\.(?:raw|unsafe)\(\s*`/gu
  const found: string[] = []
  for (const match of source.matchAll(opener)) {
    found.push(skipTemplate(source, match.index + match[0].length).text)
  }
  return found
}

export function namesOwnedTable(literal: string): string | null {
  return NAMED.exec(literal)?.[1] ?? null
}

describe('the scanner itself', () => {
  test('finds a table named in a template, the shape dayBalance leaked through', () => {
    const source =
      'const name = sql<string>`(select name from workouts where id = ${workoutDays.workoutId})`'
    expect(sqlLiterals(source).map((literal) => namesOwnedTable(literal))).toEqual(['workouts'])
  })

  test('ignores what is interpolated — a relation, a column — and reads nested templates', () => {
    const source = [
      'sql`exists (select 1 from ${exerciseFavourites} where ${f.targetId} = ${visible.id})`',
      'sql`update x set y = ${sql`(select 1 from workout_sets)`}`',
      'sql.raw(`insert into exercise_media values (1)`)',
    ].join('\n')
    // The outer template's own text names nothing; the nested one is scanned as a template too.
    expect(sqlLiterals(source).map((literal) => namesOwnedTable(literal))).toEqual([
      null,
      null,
      'workout_sets',
      'exercise_media',
    ])
  })
})

describe('no sql template outside the allowed files names an owned table', () => {
  const root = new URL('..', import.meta.url).pathname
  const files = [...new Glob('**/*.ts').scanSync(root)].filter(
    (file) => !ALLOWED.some((allowed) => allowed.test(file)),
  )

  test('the scan reaches the modules it is meant to guard', () => {
    // A glob that silently matches nothing would pass every assertion below.
    expect(files).toContain('modules/review/service.ts')
    expect(files).toContain('modules/session/list.ts')
    expect(files).not.toContain('modules/workout/write-plan.ts')
  })

  test('every file', async () => {
    const offences: string[] = []
    for (const file of files) {
      const source = await Bun.file(`${root}${file}`).text()
      for (const literal of sqlLiterals(source)) {
        const table = namesOwnedTable(literal)
        if (table !== null) offences.push(`${file}: names "${table}" in raw SQL`)
      }
    }
    expect(offences).toEqual([])
  })
})
