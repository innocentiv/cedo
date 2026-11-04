import { INLINE_PROSE_WORDS, PROSE_WORDS } from './prose.ts'

/**
 * What each field of a plan says to the model that writes one (docs/07-mcp.md, "A plan teaches its
 * own model"): the descriptions `workout_save_plan` publishes in its JSON Schema, which is all a
 * model reads of a plan's fields. Kept together, so they read as one account of the model —
 * prescription and target, warm-ups, the rules, reps in reserve as a floor (ADR-0026, ADR-0027).
 * Each rule's own words are on its `kind`, in `Progression`. `plan-descriptions.test.ts` fails on a field without one.
 */
export const PLAN_WORDS = {
  targetReps: 'Reps the set asks. Under double, inside the rule’s `repRange`.',
  targetWeightG:
    'Weight in GRAMS (60 kg is 60000). On a bodyweight exercise it is ADDED load, and a ' +
    'negative one is assistance (a band worth 20 kg is -20000), allowed there only.',
  targetReserve:
    'Reps in reserve, whole, 0 to 5: the FEWEST the set must leave — a floor, not an aim, so ' +
    'write a range as its bottom (1–2 in reserve is 1). Each working set may ask its own (a ' +
    'ramp to failure is 2, 1, 0), and a set that leaves fewer holds progression, as a missed ' +
    'rep does. Never RPE, here or in a cue.',
  targetDurationS: 'Seconds: how long a hold lasts, or a run’s time for its distance.',
  targetDistanceMm: 'Distance in millimetres (5 km is 5000000).',
  isWarmup:
    'A warm-up set, planned as its own set with its own reps and weight — never as a cue. The ' +
    'logger pre-fills it; progression never judges it, and it counts as no work. As a ' +
    'follower’s target moves, its weight follows in proportion (as written, when the working ' +
    'sets have no positive weight). Warm-ups come first.',
  entryId:
    'This entry’s id from `workout_get_editable`, sent back to keep it: its logged history and ' +
    'each follower’s target stay attached. Omitted, or with its exercise changed, it starts ' +
    'with none.',
  exerciseId: 'The exercise, by id (`exercise_search`).',
  supersetGroup:
    'One capital letter shared by the entries done alternating, in the day’s order; null when ' +
    'done alone. No rest within a round: see restSeconds.',
  restSeconds:
    'Rest after each working set, in seconds. Omitted, 120; null or 0, none: straight on to ' +
    'the next. In a superset the rest comes after the round, and it is the LAST entry’s rest. ' +
    'An earlier entry’s rest never counts between partners; it counts only when that entry ' +
    'ends the round, because the entries after it have no sets left.',
  cue:
    'One short line for the athlete — technique, tempo, setup. Say effort in reps in reserve, ' +
    `never RPE. Warm-ups are sets, not a cue. ${INLINE_PROSE_WORDS}`,
  incrementG: 'Weight added at each advance, in grams (2.5 kg is 2500).',
  afterSuccesses:
    'Cleared sessions in a row an advance waits for. Default 1: every cleared session advances.',
  progression:
    'How the working sets move from session to session. The plan holds the PRESCRIPTION: where ' +
    'each follower starts. Each has their own target, moved by their own finished sessions; ' +
    'the plan is never rewritten, and editing what the rule moves or judges starts every ' +
    'target again from the new prescription. The rule must fit the exercise’s tracking: ' +
    'weight or bodyweight and reps take none, linear or double; duration takes none or ' +
    'linear_duration; distance and duration take none or linear_distance.',
  sets:
    'Warm-ups first, then at least one working set, in the order done. Under a rule, the ' +
    'working sets agree in what it moves or judges — reps and weight, a duration, or a ' +
    'distance — and only their reps in reserve may differ. On none, they may differ freely.',
  dayId:
    'This day’s id from `workout_get_editable`, sent back to keep its logged sessions attached. ' +
    'Omitted, a new day.',
  dayName: 'The day as the athlete sees it, e.g. "Push".',
  entries: 'The day’s exercises, in the order done.',
  days: 'Every day of the plan, in order: one omitted is removed.',
  version:
    'The `version` `workout_get_editable` gave. If the plan changed since, the save is refused: ' +
    'read it again. Omit only when writing a plan whole, from nothing.',
} as const

/** What the workout's own fields say to the model — beside its plan, not part of it. */
export const WORKOUT_WORDS = {
  notes: `How the workout is run — effort, progression, deload, a bad day; not its plan. ${PROSE_WORDS}`,
}
