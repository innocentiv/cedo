import { describe, expect, test } from 'bun:test'
import { type ProseBlock, type ProseInline, inlineProse, prose } from './prose.ts'

/**
 * Long text as the app draws it (#51): a small Markdown subset — what an AI writes over MCP and a
 * person types on a phone — and everything else as the text it was written as. Nothing runs.
 */
describe('prose', () => {
  const text = (t: string): ProseInline => ({ kind: 'text', text: t })
  const paragraph = (...inline: ProseInline[]): ProseBlock => ({ kind: 'paragraph', inline })

  test('is nothing for blank text', () => {
    expect(prose('')).toEqual([])
    expect(prose('  \n\n ')).toEqual([])
  })

  test('keeps plain text as typed: each line its own, a blank line a new paragraph', () => {
    expect(prose('Four days a week.\nAdd weight.\n\nBad day: drop 10%.')).toEqual([
      paragraph(text('Four days a week.\nAdd weight.')),
      paragraph(text('Bad day: drop 10%.')),
    ])
  })

  test('marks bold and italic, nested', () => {
    expect(prose('Stop with **2 reps *in reserve***.')).toEqual([
      paragraph(
        text('Stop with '),
        {
          kind: 'strong',
          children: [text('2 reps '), { kind: 'em', children: [text('in reserve')] }],
        },
        text('.'),
      ),
    ])
  })

  test('has two sizes of heading: a page’s, and a section’s', () => {
    expect(prose('# Block 2\n## Effort\n### Main lifts\n#### Accessories')).toEqual([
      { kind: 'heading', level: 1, inline: [text('Block 2')] },
      { kind: 'heading', level: 1, inline: [text('Effort')] },
      { kind: 'heading', level: 2, inline: [text('Main lifts')] },
      { kind: 'heading', level: 2, inline: [text('Accessories')] },
    ])
  })

  test('lists, bulleted and numbered from where they start, nested', () => {
    expect(prose('- Squat\n  1. heavy\n  2. light\n- Bench')).toEqual([
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [
          [
            paragraph(text('Squat')),
            {
              kind: 'list',
              ordered: true,
              start: 1,
              items: [[paragraph(text('heavy'))], [paragraph(text('light'))]],
            },
          ],
          [paragraph(text('Bench'))],
        ],
      },
    ])
    expect(prose('3. Deload')).toEqual([
      { kind: 'list', ordered: true, start: 3, items: [[paragraph(text('Deload'))]] },
    ])
  })

  test('says a task’s box as it was written', () => {
    expect(prose('- [ ] book the deload\n- [x] buy chalk')).toEqual([
      {
        kind: 'list',
        ordered: false,
        start: 1,
        items: [[paragraph(text('[ ] book the deload'))], [paragraph(text('[x] buy chalk'))]],
      },
    ])
  })

  test('tables: a head, rows, and how each column aligns', () => {
    expect(prose('| Week | Sets |\n|:--|--:|\n| 1–2 | **3** |')).toEqual([
      {
        kind: 'table',
        align: ['left', 'right'],
        head: [[text('Week')], [text('Sets')]],
        rows: [[[text('1–2')], [{ kind: 'strong', children: [text('3')] }]]],
      },
    ])
  })

  test('links to the web and to mail; any other address is its text', () => {
    expect(prose('[form](https://e.com/squat) and mailto: [me](mailto:a@b.c)')).toEqual([
      paragraph(
        { kind: 'link', href: 'https://e.com/squat', children: [text('form')] },
        text(' and mailto: '),
        { kind: 'link', href: 'mailto:a@b.c', children: [text('me')] },
      ),
    ])
    expect(prose('See https://e.com')).toEqual([
      paragraph(text('See '), {
        kind: 'link',
        href: 'https://e.com',
        children: [text('https://e.com')],
      }),
    ])
    for (const unsafe of [
      '[x](javascript:alert(1))',
      '[x](JAVASCRIPT:alert(1))',
      "[x](javascript:location='https://evil.com')",
      '[x](data:text/html,<script>alert(1)</script>)',
      '[x](/settings)',
      '[x](//evil.com)',
    ]) {
      expect(prose(unsafe)).toEqual([paragraph(text(unsafe))])
    }
  })

  test('runs no HTML: it is the text it was written as', () => {
    expect(prose('Felt <b>strong</b> today')).toEqual([paragraph(text('Felt <b>strong</b> today'))])
    expect(prose('<script>alert(1)</script>')).toEqual([
      paragraph(text('<script>alert(1)</script>')),
    ])
    expect(prose('<div>\nhi\n</div>')).toEqual([paragraph(text('<div>\nhi\n</div>'))])
  })

  test('shows what is outside the subset as it was written, not dropped', () => {
    expect(prose('![bar](https://e.com/bar.png) `code` ~~skip~~')).toEqual([
      paragraph(text('![bar](https://e.com/bar.png) `code` ~~skip~~')),
    ])
    expect(prose('> quoted\n\n```\nsquat()\n```\n\n---')).toEqual([
      paragraph(text('> quoted')),
      paragraph(text('```\nsquat()\n```')),
      paragraph(text('---')),
    ])
  })

  test('keeps an escaped mark as the mark', () => {
    expect(prose('5 \\* 5')).toEqual([paragraph(text('5 * 5'))])
  })
})

describe('inline prose — a cue’s', () => {
  const text = (t: string): ProseInline => ({ kind: 'text', text: t })

  test('marks bold, italic and links, and nothing that takes a line of its own', () => {
    expect(inlineProse('# Pause *1 s* [why](https://e.com)')).toEqual([
      text('# Pause '),
      { kind: 'em', children: [text('1 s')] },
      text(' '),
      { kind: 'link', href: 'https://e.com', children: [text('why')] },
    ])
    expect(inlineProse('- Brace, <b>then</b> drive')).toEqual([text('- Brace, <b>then</b> drive')])
  })

  test('is nothing for blank text', () => {
    expect(inlineProse('')).toEqual([])
  })
})
