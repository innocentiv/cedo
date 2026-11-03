import { sql } from 'drizzle-orm'
import { db } from '../client.ts'

/**
 * A step for every finished session against every entry it trained (ADR-0026) — what finishing
 * would have taken — so the target read walks a realistic `progression_steps`. Every third taken
 * against a plan since edited: a read that passes over stale steps is the one being measured, and a
 * table of matching steps alone would hide it.
 */
export async function seedSteps(): Promise<void> {
  await db.execute(sql`
    with trained as (
      select distinct l.session_id, l.entry_id from set_logs l where l.entry_id is not null
    )
    insert into progression_steps (user_id, entry_id, session_id, kind, taken_at, "from", target,
                                   held, streak, against)
    select s.user_id, t.entry_id, s.id, 'session', s.started_at,
           jsonb_build_object('reps', 8, 'weightG', 60000, 'reserve', null,
                              'durationS', null, 'distanceMm', null),
           jsonb_build_object('reps', 9, 'weightG', 60000, 'reserve', null,
                              'durationS', null, 'distanceMm', null),
           null, 0,
           jsonb_build_object('rule', e.progression, 'reps', 8,
                              'weightG', case when hashtext(s.id::text) % 3 = 0 then 1 else 60000 end,
                              'durationS', null, 'distanceMm', null, 'reserves', '[]'::jsonb)
      from trained t
      join workout_sessions s on s.id = t.session_id and s.ended_at is not null
      join workout_entries e on e.id = t.entry_id
  `)
}
