import { sql } from 'drizzle-orm'
import { db } from '../client.ts'
import { mintToken } from '../../lib/token.ts'
import { type Caller, foldCaller } from '../../plugins/auth.ts'
import {
  MOVEMENT,
  PERF_VOLUME,
  type PerfProfile,
  type ProfileLabel,
  SHAPE,
  type Shape,
  UNUSABLE_HASH,
  attachMuscles,
  countExercises,
  required,
  scalar,
} from './shape.ts'
import { fillLogs } from './volume.ts'

/**
 * A profile is one user whose data is shaped to isolate a single N+1 dimension. Everything is
 * created by the same statements as its counterpart, so `small` and `large` differ in volume and
 * in nothing else — which is the entire basis of the invariant.
 */
export async function seedProfile(
  label: ProfileLabel,
  sharedGroupId: string,
): Promise<PerfProfile> {
  const shape = SHAPE[label]
  const username = `perf_${label}`

  const { userId, personalGroupId } = await seedProfileUser(username, shape, sharedGroupId)
  await seedProfileLibrary(username, shape, userId, personalGroupId)

  const workoutId = await required(
    sql`insert into workouts (owner_group_id, created_by, name, notes)
        values (${personalGroupId}::uuid, ${userId}::uuid, ${`${username} plan`}, 'Profile plan.')
        returning id::text`,
    `the ${username} workout`,
  )
  await expandProfilePlan(workoutId, personalGroupId, shape)
  await seedProfileHistory(userId, workoutId, shape, sharedGroupId)

  return await profileFrom(label, userId, workoutId)
}

async function seedProfileUser(
  username: string,
  shape: Shape,
  sharedGroupId: string,
): Promise<{ userId: string; personalGroupId: string }> {
  const personalGroupId = await required(
    sql`insert into groups (slug, name, kind) values (${username}, ${username}, 'personal')
        returning id::text`,
    `the ${username} group`,
  )
  const userId = await required(
    sql`insert into users (username, password_hash, display_name, personal_group_id)
        values (${username}, ${UNUSABLE_HASH}, ${username}, ${personalGroupId}::uuid)
        returning id::text`,
    username,
  )

  await db.execute(sql`
    insert into group_members (group_id, user_id, role)
    values (${personalGroupId}::uuid, ${userId}::uuid, 'editor'),
           (${sharedGroupId}::uuid, ${userId}::uuid, 'reader')
  `)

  /**
   * Extra memberships exist so the auth query is measured against a caller in 52 groups as well as
   * one in 3. It must still be a single query — a per-membership lookup is exactly the failure.
   */
  await db.execute(sql`
    with g as (
      insert into groups (slug, name, kind)
      select ${username} || '-extra-' || i, 'Extra ' || i, 'shared'::group_kind
        from generate_series(1, ${shape.extraGroups}) i
      returning id
    )
    insert into group_members (group_id, user_id, role)
    select id, ${userId}::uuid, 'reader'::group_role from g
  `)

  return { userId, personalGroupId }
}

/** The profile's own exercises, so its plan does not depend on the shared library's ordering. */
async function seedProfileLibrary(
  username: string,
  shape: Shape,
  userId: string,
  personalGroupId: string,
): Promise<void> {
  await db.execute(
    sql.raw(`
      insert into exercises (owner_group_id, created_by, name, description, instructions)
      select '${personalGroupId}'::uuid, '${userId}'::uuid,
             '${username} ' || ${MOVEMENT} || ' ' || i, 'Personal.', 'Personal.'
        from generate_series(1, ${shape.exercises}) i
    `),
  )
  await attachMuscles(personalGroupId)
}

async function seedProfileHistory(
  userId: string,
  workoutId: string,
  shape: Shape,
  sharedGroupId: string,
): Promise<void> {
  await db.execute(sql`
    insert into workout_sessions (user_id, workout_id, started_at, ended_at)
    select ${userId}::uuid, ${workoutId}::uuid,
           now() - ((s * 2) || ' days')::interval,
           now() - ((s * 2) || ' days')::interval + interval '65 minutes'
      from generate_series(1, ${shape.sessions}) s
  `)

  // One session left open, and it is filled by the same statement as the rest, so the write path
  // is measured against a session that already holds work rather than an empty one.
  await db.execute(sql`
    insert into workout_sessions (user_id, workout_id, started_at, notes)
    values (${userId}::uuid, ${workoutId}::uuid, now() - interval '20 minutes', 'In progress.')
  `)
  await fillLogs({
    sessions: sql`select id, started_at from workout_sessions where user_id = ${userId}::uuid`,
    perSession: shape.logsPerSession,
    sharedGroupId,
    workoutId,
  })
}

/** The profile's own plan, drawing on its own exercises so the ACL work is representative. */
async function expandProfilePlan(
  workoutId: string,
  ownerGroupId: string,
  shape: Shape,
): Promise<void> {
  await db.execute(sql`
    insert into workout_days (workout_id, owner_group_id, index, name)
    select w.id, w.owner_group_id, d, 'Day ' || (d + 1)
      from workouts w
      cross join generate_series(0, ${shape.days - 1}) d
     where w.id = ${workoutId}::uuid
  `)

  const libraryCount = await countExercises(ownerGroupId)
  await db.execute(sql`
    with target_days as (
      select id, owner_group_id, (row_number() over (order by index))::int as rn
        from workout_days where workout_id = ${workoutId}::uuid
    ), library as (
      select id, (row_number() over (order by name))::int - 1 as rn
        from exercises where owner_group_id = ${ownerGroupId}::uuid
    )
    insert into workout_entries (day_id, owner_group_id, index, exercise_id, superset_group, rest_seconds, progression)
    select t.id, t.owner_group_id, e, l.id,
           case when e % 4 = 0 then 'A' else null end, 120,
           '{"kind":"linear","incrementG":2500,"afterSuccesses":1}'::jsonb
      from target_days t
      cross join generate_series(0, ${shape.entries - 1}) e
      join library l on l.rn = (t.rn * 3 + e) % ${libraryCount}
  `)

  await db.execute(sql`
    insert into workout_sets (entry_id, owner_group_id, index, is_warmup, target_reps, target_weight_g)
    select en.id, en.owner_group_id, s, s = 0, 8, 50000 + s * 5000
      from workout_entries en
      join workout_days d on d.id = en.day_id
      cross join generate_series(0, ${PERF_VOLUME.setsPerEntry - 1}) s
     where d.workout_id = ${workoutId}::uuid
  `)
}

async function profileFrom(
  label: ProfileLabel,
  userId: string,
  workoutId: string,
): Promise<PerfProfile> {
  const sessionId = await required(
    sql`select id::text from workout_sessions
         where user_id = ${userId}::uuid and ended_at is not null
         order by started_at desc limit 1`,
    `a finished session for perf_${label}`,
  )
  const openSessionId = await required(
    sql`select id::text from workout_sessions
         where user_id = ${userId}::uuid and ended_at is null limit 1`,
    `an open session for perf_${label}`,
  )
  const exerciseId = await required(
    sql`select exercise_id::text from set_logs l
          join workout_sessions s on s.id = l.session_id
         where s.user_id = ${userId}::uuid
         group by exercise_id order by count(*) desc, exercise_id limit 1`,
    `logs for perf_${label}`,
  )

  return {
    label,
    caller: await callerFor(userId),
    token: await mintSession(userId),
    workoutId,
    sessionId,
    openSessionId,
    exerciseId,
  }
}

/**
 * Only the hash of a token is stored, so the plaintext from a previous seeding run cannot be
 * recovered. Minting a fresh one on every load is cheap and keeps the auth measurement honest.
 */
async function mintSession(userId: string): Promise<string> {
  // Replaced, not appended. Minting on every load would grow `sessions` by two rows per run, and
  // the whole claim of this seed is that two runs leave the database identical.
  await db.execute(sql`delete from sessions where user_id = ${userId}::uuid`)
  const { token, hash } = mintToken()
  await db.execute(sql`
    insert into sessions (user_id, token_hash, expires_at)
    values (${userId}::uuid, ${hash}, now() + interval '365 days')
  `)
  return token
}

export async function callerFor(userId: string): Promise<Caller> {
  const rows = await db.execute<{
    user_id: string
    username: string
    display_name: string
    weight_unit: 'kg' | 'lb'
    personal_group_id: string
    group_id: string | null
    role: 'editor' | 'reader' | null
  }>(sql`
    select u.id::text as user_id, u.username, u.display_name, u.weight_unit::text as weight_unit,
           u.personal_group_id::text as personal_group_id,
           gm.group_id::text as group_id, gm.role
      from users u
      left join group_members gm on gm.user_id = u.id
     where u.id = ${userId}::uuid
  `)
  const first = rows[0]
  if (first === undefined) throw new Error(`No such user: ${userId}`)

  return foldCaller(
    {
      userId: first.user_id,
      username: first.username,
      displayName: first.display_name,
      weightUnit: first.weight_unit,
      personalGroupId: first.personal_group_id,
    },
    rows.map((r) => ({ groupId: r.group_id, role: r.role })),
  )
}

export async function loadProfile(label: ProfileLabel): Promise<PerfProfile | null> {
  const username = `perf_${label}`
  const userId = await scalar(sql`select id::text from users where username = ${username}`)
  const workoutId = await scalar(
    sql`select id::text from workouts where name = ${`${username} plan`}`,
  )
  if (userId === null || workoutId === null) return null

  return await profileFrom(label, userId, workoutId)
}
