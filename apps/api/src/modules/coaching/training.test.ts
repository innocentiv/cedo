import { expect, test } from 'bun:test'
import type { Caller } from '../../plugins/auth.ts'
import { type Training, isTraining, own } from './training.ts'

/**
 * Whose training a read is of is told only by `own` and `ownOrCoached` (#11): a `Training` written
 * by hand — or spread from one resolved for someone else — names an athlete the caller was never
 * checked against, and does not compile. `tsc` is the test; each directive below fails it the day
 * such a forgery would pass.
 */
const forged = (reader: Caller, athleteId: string): Training =>
  // @ts-expect-error — not resolved: no `own` or `ownOrCoached` said whose it is.
  ({ reader, athleteId })

const respread = (reader: Caller, athleteId: string): Training =>
  // @ts-expect-error — a copy of one resolved for the reader, pointed at another athlete.
  // oxlint-disable-next-line typescript/no-misused-spread -- the forgery under test; lint refuses it too.
  ({ ...own(reader), athleteId })

test('a Training cannot be written by hand, nor spread from another, only resolved', () => {
  const reader: Caller = {
    userId: 'me',
    username: 'me',
    displayName: 'Me',
    weightUnit: 'kg',
    personalGroupId: 'mine',
    groupIds: [],
    editorGroupIds: [],
  }
  expect(isTraining(own(reader))).toBe(true)
  // At run time too: what the compiler refuses above is no Training here.
  expect(isTraining(forged(reader, 'them'))).toBe(false)
  expect(isTraining(respread(reader, 'them'))).toBe(false)
})
