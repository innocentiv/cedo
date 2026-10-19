import { describe, expect, test } from 'bun:test'
import { fieldFor } from './dimension.ts'
import {
  CLOCK,
  COUNT,
  type FieldEvent,
  type Typing,
  editField,
  fieldShowing,
  fieldText,
} from './typing.ts'

/**
 * A field as the screen drives it: an input that selects its text on focus, so the first key
 * replaces it, and a parent that may answer a keystroke with a value of its own (a clamp). Each
 * keystroke settles after the parent has answered, as a render does.
 */
function field(typing: Typing, value: number | null, parent = (v: number | null) => v) {
  let edit = fieldShowing(value)
  let selected = false
  const emitted: (number | null)[] = []
  const apply = (event: FieldEvent) => {
    const step = editField(edit, event, typing)
    edit = step.edit
    return step
  }
  return {
    emitted,
    shown: () => fieldText(edit, typing),
    focus: () => {
      selected = true
    },
    blur: () => apply({ kind: 'blur' }),
    /** Keys as typed: a character, or `Backspace`. */
    press: (...keys: string[]) => {
      for (const key of keys) {
        const before = selected ? '' : fieldText(edit, typing)
        selected = false
        const text = key === 'Backspace' ? before.slice(0, -1) : before + key
        const step = apply({ kind: 'type', text })
        if (step.emit !== undefined) {
          emitted.push(step.emit)
          apply({ kind: 'value', value: parent(step.emit) })
        }
        apply({ kind: 'settled' })
      }
    },
    /** The parent's value changed for a reason of its own — another control was tapped. */
    outside: (next: number | null) => apply({ kind: 'value', value: next }),
  }
}

const kg = fieldFor('weight', 'kg')
const last = (f: { emitted: (number | null)[] }) => f.emitted.at(-1)

describe('a field being typed in', () => {
  test('keeps a half-typed "62." on screen, so 62.5 typed key by key is 62.5 kg, not 625', () => {
    const f = field(kg, null)
    f.focus()
    f.press('6', '2', '.')
    expect(f.shown()).toBe('62.')
    f.press('5')
    expect(last(f)).toBe(62_500)
  })

  test('takes a comma as the decimal separator', () => {
    const f = field(kg, null)
    f.focus()
    f.press('7', '0', ',', '5')
    expect(f.shown()).toBe('70.5')
    expect(last(f)).toBe(70_500)
  })

  test('stays empty through a clamp it caused, so backspace then 4 is 4 sets, not 14', () => {
    const f = field(COUNT, 3, (v) => Math.max(v ?? 1, 1))
    f.focus()
    f.press('Backspace')
    expect(f.shown()).toBe('')
    f.press('4')
    expect(f.shown()).toBe('4')
    expect(last(f)).toBe(4)
  })

  test('shows a duration as a clock while typed, and a backspace regroups the digits', () => {
    const f = field(CLOCK, 30)
    f.focus()
    expect(f.shown()).toBe('0:30')
    f.press('1', '3', '0')
    expect(f.shown()).toBe('1:30')
    f.press('Backspace')
    expect(f.shown()).toBe('13')
    f.press('0')
    expect(f.shown()).toBe('1:30')
    expect(last(f)).toBe(90)
  })

  test('drops its text when the value changes under it, so the next digit is not appended to it', () => {
    const f = field(COUNT, 3)
    f.focus()
    f.press('5')
    // The keyboard stays up while another entry's row moves into this field's position.
    f.outside(8)
    expect(f.shown()).toBe('8')
    f.press('0')
    expect(last(f)).toBe(80)
  })

  test('drops it too after a keystroke that changed no value — the keystroke had settled', () => {
    const f = field(kg, 62_000)
    f.focus()
    f.press('6', '2', '.')
    f.outside(40_000)
    expect(f.shown()).toBe('40')
  })

  test('shows the value until typed in, and once left whatever the parent settled to', () => {
    const f = field(COUNT, 25, (v) => Math.min(v ?? 1, 20))
    f.focus()
    expect(f.shown()).toBe('25')
    f.press('3', '0')
    expect(f.shown()).toBe('30')
    f.blur()
    expect(f.shown()).toBe('20')
  })

  test('answers an event that changes nothing with the same state, so a render can bail out', () => {
    const edit = fieldShowing(4)
    expect(editField(edit, { kind: 'settled' }, COUNT).edit).toBe(edit)
    expect(editField(edit, { kind: 'blur' }, COUNT).edit).toBe(edit)
    expect(editField(edit, { kind: 'value', value: 4 }, COUNT).edit).toBe(edit)
  })
})
