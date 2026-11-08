import { eq, sql } from 'drizzle-orm'
import {
  DEFAULT_GROUP_SLUG,
  type Instance,
  type InstancePatch,
  PRODUCT,
  type SignUpState,
  VERSION,
  signUpOf,
} from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { groupMembers, groups, instanceSettings } from '../../db/schema.ts'
import { signUpClosed } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { requireCurator } from '../review/curation.ts'

/**
 * The instance itself (#71): what it is, whether it takes new accounts, and who a fresh instance's
 * first account becomes. Sign-up is one row, `first` on a fresh instance, then `open` or `closed`
 * at the curator's word. See ADR-0029.
 */

/** An instance that cannot say it takes accounts does not. */
const WITHOUT_A_ROW: SignUpState = 'closed'

type Admitted = Exclude<SignUpState, 'closed'>

/** `GET /instance`, signed in or not. */
export async function current(): Promise<Instance> {
  const [row] = await db.select({ signUp: instanceSettings.signUp }).from(instanceSettings)
  return { product: PRODUCT, version: VERSION, signUp: signUpOf(row?.signUp ?? WITHOUT_A_ROW) }
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
  return await current()
}

/**
 * Registration's first step, inside its transaction: refuses when sign-up is closed, and otherwise
 * says whether this is a fresh instance's first account. The row stays locked until the
 * registration commits, so of two registrations racing on a fresh instance exactly one is first;
 * the other waits, and then finds sign-up closed behind it.
 */
export async function admit(tx: Transaction): Promise<Admitted> {
  const [row] = await tx
    .select({ signUp: instanceSettings.signUp })
    .from(instanceSettings)
    .for('update')
  const state = row?.signUp ?? WITHOUT_A_ROW
  if (state === 'closed') throw signUpClosed()
  return state
}

/**
 * A new account joins the shared library: as a reader, or, as a fresh instance's first, as its
 * editor — its curator — and sign-up closes behind them. Before the library is seeded there is
 * nothing to curate, so a first account is refused rather than left a reader on an instance still
 * `first`, whose next account would curate it instead.
 */
export async function joinLibrary(tx: Transaction, userId: string, admitted: Admitted) {
  const [shared] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.slug, DEFAULT_GROUP_SLUG))
    .limit(1)
  if (shared === undefined) {
    if (admitted === 'first') throw new Error('The shared library is not seeded yet')
    return
  }
  const first = admitted === 'first'
  await tx
    .insert(groupMembers)
    .values({ groupId: shared.id, userId, role: first ? 'editor' : 'reader' })
  if (first) {
    await tx.update(instanceSettings).set({ signUp: 'closed', updatedAt: sql`now()` })
  }
}
