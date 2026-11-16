import { describe, expect, spyOn, test } from 'bun:test'
import { type AlertKind, createAlertKind, kindOf, offersToTell } from './rest-alert-kind.ts'

/**
 * How this phone tells a rest's end (#39): its own choice, kept in a fake keychain, allowed by a
 * fake iOS. What is set for a rest, and cleared, is rest-alert.test.ts's.
 */

describe('the rest band', () => {
  /** "Tell me when rest is over" turns on a notification: shown only while nothing tells it. */
  test('offers to tell a rest’s end only while nothing does', () => {
    expect(offersToTell('off')).toBe(true)
    expect(offersToTell('notification')).toBe(false)
    expect(offersToTell('alarm')).toBe(false)
  })
})

describe('the kind of alert this phone keeps', () => {
  test('is the one kept, or off when nothing, or something else, is', () => {
    expect(kindOf('alarm')).toBe('alarm')
    expect(kindOf('notification')).toBe('notification')
    expect(kindOf(null)).toBe('off')
    expect(kindOf('push')).toBe('off')
  })
})

/** The keychain, as a fake: what it holds, and what it is asked to keep. */
function aKeychain(held: string | null) {
  const kept: string[] = []
  return {
    kept,
    read: async () => held,
    write: async (value: string) => {
      kept.push(value)
      held = value
    },
    clear: async () => {
      held = null
    },
  }
}

/** iOS, as a fake: what it was asked, and what it answers. */
function anIos(allows: boolean) {
  const asked: string[] = []
  return {
    asked,
    allow: async (kind: AlertKind) => {
      asked.push(kind)
      return allows
    },
  }
}

/** What this phone has set, as a fake: each time it is cleared, in order with what else happens. */
function whatIsSet(happened: string[] = []) {
  return {
    happened,
    clear: async () => {
      happened.push('cleared')
    },
  }
}

const aChoice = (keychain = aKeychain(null), ios = anIos(true), set = whatIsSet()) =>
  createAlertKind({ store: keychain, allow: ios.allow, alerts: set })

describe('how this phone tells a rest’s end', () => {
  test('is off until the keychain is read, then what it keeps', async () => {
    const choice = aChoice(aKeychain('alarm'))
    expect(choice.snapshot()).toBe('off')
    await choice.restore()
    expect(choice.snapshot()).toBe('alarm')
  })

  /**
   * Cleared before the new kind is heard: the rest's screen sets the new one as it hears it, after
   * the old is gone.
   */
  test('is kept once iOS allows it, and heard once what was set is cleared', async () => {
    const keychain = aKeychain(null)
    const ios = anIos(true)
    const set = whatIsSet()
    const choice = aChoice(keychain, ios, set)
    await choice.restore()
    choice.subscribe(() => {
      set.happened.push(`heard ${choice.snapshot()}`)
    })
    expect(await choice.choose('notification')).toBe(true)
    expect(ios.asked).toEqual(['notification'])
    expect(keychain.kept).toEqual(['notification'])
    expect(set.happened).toEqual(['cleared', 'heard notification'])
  })

  /** iOS asks once; refused, nothing is kept or cleared, and the screen says where to allow it. */
  test('is not kept when iOS refuses it', async () => {
    const keychain = aKeychain('notification')
    const set = whatIsSet()
    const choice = aChoice(keychain, anIos(false), set)
    await choice.restore()
    expect(await choice.choose('alarm')).toBe(false)
    expect(keychain.kept).toEqual([])
    expect(set.happened).toEqual([])
    expect(choice.snapshot()).toBe('notification')
  })

  /** A rest whose screen is not open is not followed: turned off, what it set is cleared at once. */
  test('turned off, clears what was set, and asks iOS nothing', async () => {
    const ios = anIos(true)
    const set = whatIsSet()
    const choice = aChoice(aKeychain('notification'), ios, set)
    expect(await choice.choose('off')).toBe(true)
    expect(ios.asked).toEqual([])
    expect(set.happened).toEqual(['cleared'])
  })

  /** A keychain that throws must not take the app down: nothing tells, as before it was chosen. */
  test('is off when the keychain cannot be read', async () => {
    const choice = aChoice({
      ...aKeychain(null),
      read: async () => {
        throw new Error('keychain locked')
      },
    })
    const errors = spyOn(console, 'error').mockImplementation(() => null)
    try {
      await choice.restore()
    } finally {
      errors.mockRestore()
    }
    expect(choice.snapshot()).toBe('off')
  })
})
