import { sql } from 'drizzle-orm'
import {
  type Instance,
  type InstancePatch,
  PRODUCT,
  type SignUpState,
  signUpOf,
} from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { instanceSettings } from '../../db/schema.ts'
import { signUpClosed } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { VERSION } from '../../version.ts'
import { isCurator, requireCurator } from '../review/curation.ts'

/**
 * The instance itself (#71): what it is, and whether it takes new accounts. Sign-up is one row,
 * `first` on a fresh instance, then `open` or `closed` at the curator's word. A missing row reads as
 * closed: an instance that cannot say it takes accounts does not. See ADR-0029.
 */

const CLOSED: SignUpState = 'closed'

/** `GET /instance`, signed in or not. */
export async function describe(): Promise<Instance> {
  const [row] = await db.select({ signUp: instanceSettings.signUp }).from(instanceSettings)
  return { product: PRODUCT, version: VERSION, signUp: signUpOf(row?.signUp ?? CLOSED) }
}

/** The curator opens sign-up, for testers, or closes it again. Anyone else is told nothing. */
export async function update(caller: Caller, patch: InstancePatch): Promise<Instance> {
  await requireCurator(caller)
  await db
    .insert(instanceSettings)
    .values({ signUp: patch.signUp })
    .onConflictDoUpdate({
      target: instanceSettings.one,
      set: { signUp: patch.signUp, updatedAt: sql`now()` },
    })
  return await describe()
}

/**
 * Registration's first step, inside its transaction: refuses when sign-up is closed, and otherwise
 * says whether this is a fresh instance's first account. The row stays locked until the
 * registration commits, so of two registrations racing on a fresh instance exactly one is first;
 * the other waits, and then finds sign-up closed behind it.
 */
export async function admit(tx: Transaction): Promise<'first' | 'open'> {
  const [row] = await tx
    .select({ signUp: instanceSettings.signUp })
    .from(instanceSettings)
    .for('update')
  const state = row?.signUp ?? CLOSED
  if (state === 'closed') throw signUpClosed()
  return state
}

/** Whether the caller curates this instance, for `Me.curator`. */
export async function curates(caller: Caller): Promise<boolean> {
  return await isCurator(caller)
}

/** After a fresh instance's first account, which curates it: sign-up closes behind them. */
export async function closeBehindFirst(tx: Transaction): Promise<void> {
  await tx.update(instanceSettings).set({ signUp: 'closed', updatedAt: sql`now()` })
}
