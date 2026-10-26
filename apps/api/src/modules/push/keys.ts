import { eq } from 'drizzle-orm'
import webpush from 'web-push'
import { db } from '../../db/client.ts'
import { instanceSecrets } from '../../db/schema.ts'
import { env } from '../../env.ts'

/**
 * The key pair rest alerts are pushed with (#38): the environment's when it gives both, else the one
 * this instance made on its first start and keeps in the database — so someone self-hosting has
 * nothing to set up. Made once: two first starts at once both insert, and the second's is dropped
 * for the first's. Read once a process.
 */
export interface PushKeys {
  readonly publicKey: string
  readonly privateKey: string
}

const NAME = 'vapid'

let cached: Promise<PushKeys> | null = null

export const pushKeys = (): Promise<PushKeys> => (cached ??= load())

async function load(): Promise<PushKeys> {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = env
  if (publicKey !== undefined && privateKey !== undefined) return { publicKey, privateKey }
  await db
    .insert(instanceSecrets)
    .values({ name: NAME, value: JSON.stringify(webpush.generateVAPIDKeys()) })
    .onConflictDoNothing()
  const [row] = await db
    .select()
    .from(instanceSecrets)
    .where(eq(instanceSecrets.name, NAME))
    .limit(1)
  if (row === undefined) throw new Error('The push key pair was not kept')
  const kept: unknown = JSON.parse(row.value)
  if (!isKeys(kept)) throw new Error('The kept push key pair is not one')
  return kept
}

const isKeys = (value: unknown): value is PushKeys =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'publicKey') === 'string' &&
  typeof Reflect.get(value, 'privateKey') === 'string'

/** Forgets what was read — a test that empties the database makes a new pair. */
export function forgetPushKeys(): void {
  cached = null
}
