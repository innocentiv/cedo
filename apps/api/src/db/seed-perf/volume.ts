import { sql } from 'drizzle-orm'
import { DEFAULT_GROUP_SLUG } from '@cedo/contract'
import { db } from '../client.ts'
import {
  EQUIPMENT,
  MOVEMENT,
  PERF_VOLUME,
  UNUSABLE_HASH,
  attachMuscles,
  countEntries,
  countExercises,
  required,
} from './shape.ts'

/** The background: everything that is volume rather than a fixture the suite reads back. */

export async function truncateAll(): Promise<void> {
  await db.execute(sql`
    do $$
    declare statement text;
    begin
      select 'truncate table ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' cascade'
        into statement
        from pg_tables
       where schemaname = 'public' and tablename <> '__drizzle_migrations';
      if statement is not null then execute statement; end if;
    end $$;
  `)
}

export async function seedSharedGroup(): Promise<string> {
  return await required(
    sql`insert into groups (slug, name, kind)
        values (${DEFAULT_GROUP_SLUG}, 'cedo', 'shared') returning id::text`,
    'the shared group',
  )
}

/** Returns the first background user, which owns the seeded library rows. */
export async function seedBackgroundUsers(sharedGroupId: string): Promise<string> {
  await db.execute(sql`
    with g as (
      insert into groups (slug, name, kind)
      select 'perf-u' || i, 'Perf User ' || i, 'personal'::group_kind
        from generate_series(1, ${PERF_VOLUME.users}) i
      returning id, slug
    ), u as (
      insert into users (username, password_hash, display_name, personal_group_id)
      select 'perf_u' || split_part(g.slug, 'perf-u', 2), ${UNUSABLE_HASH}, 'Perf ' || g.slug, g.id
        from g
      returning id, personal_group_id
    )
    insert into group_members (group_id, user_id, role)
    select personal_group_id, id, 'editor'::group_role from u
    union all
    select ${sharedGroupId}::uuid, id, 'reader'::group_role from u
  `)

  return await required(sql`select id::text from users order by username limit 1`, 'a seeded user')
}

export async function seedSharedLibrary(
  sharedGroupId: string,
  systemUserId: string,
): Promise<void> {
  await db.execute(
    sql.raw(`
      insert into exercises (owner_group_id, created_by, name, description, instructions, equipment)
      select '${sharedGroupId}'::uuid, '${systemUserId}'::uuid,
             ${EQUIPMENT} || ' ' || ${MOVEMENT} || ' ' || i,
             'Seeded for the performance suite.', 'Set up, execute, rack.', ${EQUIPMENT}
        from generate_series(1, ${PERF_VOLUME.sharedExercises}) i
    `),
  )
  await attachMuscles(sharedGroupId)
}

export async function seedBackgroundWorkouts(
  sharedGroupId: string,
  systemUserId: string,
): Promise<void> {
  await db.execute(sql`
    insert into workouts (owner_group_id, created_by, name, notes)
    select ${sharedGroupId}::uuid, ${systemUserId}::uuid, 'Perf Plan ' || i, 'Seeded.'
      from generate_series(1, ${PERF_VOLUME.workouts}) i
  `)

  await db.execute(sql`
    insert into workout_days (workout_id, index, name)
    select w.id, d, 'Day ' || (d + 1)
      from workouts w
      cross join generate_series(0, ${PERF_VOLUME.daysPerWorkout - 1}) d
     where w.owner_group_id = ${sharedGroupId}::uuid
  `)

  const libraryCount = await countExercises(sharedGroupId)
  await db.execute(sql`
    with target_days as (
      select d.id, (row_number() over (order by d.id))::int as rn
        from workout_days d
        join workouts w on w.id = d.workout_id
       where w.owner_group_id = ${sharedGroupId}::uuid
    ), library as (
      select id, (row_number() over (order by name))::int - 1 as rn
        from exercises where owner_group_id = ${sharedGroupId}::uuid
    )
    insert into workout_entries (day_id, index, exercise_id, superset_group, rest_seconds, progression)
    select t.id, e, l.id,
           case when e % 4 = 0 then 'A' else null end,
           90 + (e % 3) * 30,
           case when e % 3 = 0
                then '{"kind":"linear","incrementG":2500,"afterSuccesses":1}'::jsonb
                else '{"kind":"none"}'::jsonb end
      from target_days t
      cross join generate_series(0, ${PERF_VOLUME.entriesPerDay - 1}) e
      join library l on l.rn = (t.rn * 7 + e) % ${libraryCount}
  `)

  await expandSets(sharedGroupId)
}

/**
 * Scoped to this group's entries. Unscoped it happens to be correct today only because profiles are
 * seeded afterwards — a reorder would silently give every profile entry a second set of sets.
 */
async function expandSets(sharedGroupId: string): Promise<void> {
  await db.execute(sql`
    insert into workout_sets (entry_id, index, is_warmup, target_reps, target_weight_g)
    select en.id, s, s = 0, 8, 40000 + s * 5000
      from workout_entries en
      join workout_days d on d.id = en.day_id
      join workouts w on w.id = d.workout_id
      cross join generate_series(0, ${PERF_VOLUME.setsPerEntry - 1}) s
     where w.owner_group_id = ${sharedGroupId}::uuid
  `)
}

/**
 * One video link per shared exercise.
 *
 * Without this the media tables are EMPTY, and every plan that touches them reads "Seq Scan on
 * media (rows=0)" — which looks like a pass and measures nothing. Media hydration is part of every
 * exercise read, so it has to carry weight.
 */
export async function seedMedia(sharedGroupId: string, systemUserId: string): Promise<void> {
  await db.execute(sql`
    with m as (
      insert into media (kind, title, payload, created_by)
      select 'video_link'::media_kind, e.name,
             jsonb_build_object(
               'kind', 'video_link', 'provider', 'youtube',
               'sourceUrl', 'https://www.youtube.com/watch?v=' || replace(e.id::text, '-', ''),
               'externalId', replace(e.id::text, '-', '')
             ),
             ${systemUserId}::uuid
        from exercises e
       where e.owner_group_id = ${sharedGroupId}::uuid
      returning id, title
    )
    insert into exercise_media (exercise_id, media_id, sort_index)
    select e.id, m.id, 0
      from m
      -- Joined back on the name, which is unique within a group: a returning clause cannot hand
      -- back a column of the row its value came FROM, so there is nothing better to match on.
      join exercises e on e.name = m.title
     where e.owner_group_id = ${sharedGroupId}::uuid
  `)
}

/**
 * Favourites, for the same reason: the list query LEFT JOINs them on every page, and an empty
 * table turns that join into a no-op the planner solves for free.
 */
export async function seedFavourites(sharedGroupId: string): Promise<void> {
  await db.execute(sql`
    with u as (
      select id, (row_number() over (order by username))::int as rn from users
    ), library as (
      select id, (row_number() over (order by name))::int - 1 as rn
        from exercises where owner_group_id = ${sharedGroupId}::uuid
    )
    insert into exercise_favourites (user_id, target_id)
    select u.id, l.id
      from u
      cross join generate_series(0, ${PERF_VOLUME.favouritesPerUser - 1}) i
      join library l on l.rn = (u.rn * 29 + i) % ${await countExercises(sharedGroupId)}
    on conflict do nothing
  `)

  await db.execute(sql`
    with u as (
      select id, (row_number() over (order by username))::int as rn from users
    ), plans as (
      select id, (row_number() over (order by name))::int - 1 as rn
        from workouts where owner_group_id = ${sharedGroupId}::uuid
    )
    insert into workout_favourites (user_id, target_id)
    select u.id, p.id
      from u
      cross join generate_series(0, 1) i
      join plans p on p.rn = (u.rn * 7 + i) % ${PERF_VOLUME.workouts}
    on conflict do nothing
  `)
}

/** Browser sessions. The token lookup is the single hottest query in the system. */
export async function seedTokens(): Promise<void> {
  await db.execute(sql`
    insert into sessions (user_id, token_hash, expires_at)
    select u.id, encode(sha256((u.id::text || ':' || s)::bytea), 'hex'), now() + interval '30 days'
      from users u
      cross join generate_series(1, ${PERF_VOLUME.tokensPerUser}) s
  `)
}

/** The bulk of the volume: a quarter of a million set logs spread over the background users. */
export async function seedBackgroundSessions(sharedGroupId: string): Promise<void> {
  await db.execute(sql`
    insert into workout_sessions (user_id, started_at, ended_at)
    select u.id,
           now() - ((s * 3) || ' days')::interval,
           now() - ((s * 3) || ' days')::interval + interval '70 minutes'
      from users u
      cross join generate_series(1, ${PERF_VOLUME.sessionsPerUser}) s
  `)

  await fillLogs({
    // Explicitly the sessions with no workout — the background ones. Selecting every session would
    // be correct only until a profile is seeded before this runs.
    sessions: sql`select id, started_at from workout_sessions where workout_id is null`,
    perSession: PERF_VOLUME.logsPerSession,
    sharedGroupId,
    workoutId: null,
  })
}

export interface LogFill {
  readonly sessions: ReturnType<typeof sql>
  readonly perSession: number
  readonly sharedGroupId: string
  /** When set, logs are linked to that workout's entries, as a real logged session would be. */
  readonly workoutId: string | null
}

/**
 * Logs for a set of sessions.
 *
 * Exercise assignment is skewed on purpose: a fifth of every session's logs land on ONE exercise,
 * so per-exercise history has genuine depth. Spread evenly over 10,000 exercises each would hold
 * about 25 rows, and an index scan over 25 rows out of 250,000 proves nothing about the index.
 *
 * Exercises are drawn from the SHARED group only, so every log references something the profile
 * can actually see — otherwise history and review would silently read nothing.
 */
export async function fillLogs(fill: LogFill): Promise<void> {
  const libraryCount = await countExercises(fill.sharedGroupId)
  const entryCount =
    fill.workoutId === null ? 1 : await countEntries(fill.workoutId).then((n) => Math.max(n, 1))

  const entries =
    fill.workoutId === null
      ? sql`select null::uuid as id, 0 as rn`
      : sql`select en.id, (row_number() over (order by d.index, en.index))::int - 1 as rn
              from workout_entries en
              join workout_days d on d.id = en.day_id
             where d.workout_id = ${fill.workoutId}::uuid`

  await db.execute(sql`
    with target_sessions as (
      select id, started_at, (row_number() over (order by id))::int as rn from (${fill.sessions}) s
    ), library as (
      select id, (row_number() over (order by name))::int - 1 as rn
        from exercises where owner_group_id = ${fill.sharedGroupId}::uuid
    ), popular as (
      select id from exercises where owner_group_id = ${fill.sharedGroupId}::uuid
       order by name limit 1
    ), plan_entries as (${entries})
    insert into set_logs (session_id, entry_id, exercise_id, set_index, is_warmup,
                          weight_g, reps, rpe, logged_at)
    select t.id, pe.id,
           case when i % 5 = 0 then p.id else l.id end,
           i % 5, i % 5 = 0,
           40000 + ((t.rn + i) % 20) * 2500,
           5 + (i % 8),
           case when i % 3 = 0 then 7 + (i % 3) else null end,
           t.started_at + ((i * 90) || ' seconds')::interval
      from target_sessions t
      cross join generate_series(0, ${fill.perSession - 1}) i
      cross join popular p
      join library l on l.rn = (t.rn * 13 + i) % ${libraryCount}
      join plan_entries pe on pe.rn = i % ${entryCount}
  `)
}
