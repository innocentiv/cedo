import {
  LOAD_LIMIT_WORDS,
  type EntryTarget,
  type Exercise,
  NO_TARGET,
  type SessionDay,
  type SessionEntry,
  type SessionExercise,
  type WeightUnit,
  adHocSetsOf,
  focusOf,
  formatEffort,
  formatSets,
  formatWithReserve,
  markedSets,
  nextSet,
  nextSetWords,
  prescriptionOf,
  setsOf,
} from '@cedo/contract'
import { ConfirmButton, FocusLogger, Stack, Text } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import type { Reopened } from './shown-set.tsx'
import { useLoads } from './use-loads.ts'
import { useUntilNextSet } from './until-next-set.ts'
import { AdHocFocus, adHocFocus } from './workout-adhoc.tsx'
import type { WorkoutSets } from './workout-state.ts'

/**
 * What a planned day has in focus (#24), and how it shows. The rules are the contract's
 * `session-flow`; this holds what the athlete chose, until the next set is logged.
 */

/** What the athlete tapped to work on: an entry of the day, or an exercise added to it. */
type Chosen = { readonly entry: string } | { readonly added: string }

/** An entry whose exercise the reader can no longer see: what it asked, and nothing to log. */
function Unavailable({
  entry,
  unit,
}: {
  readonly entry: SessionEntry
  readonly unit: WeightUnit
}): React.JSX.Element {
  const asked = prescriptionOf(entry)?.target
  return (
    <Stack gap="sm" testID={`log-entry-${entry.index}`}>
      <Text variant="title">{exerciseName(null)}</Text>
      <Text tone="muted" testID={`log-entry-${entry.index}-target`}>
        {`Prescribed ${asked === undefined ? 'nothing' : formatEffort(asked, null, unit)}`}
      </Text>
      <Text variant="caption" tone="muted" testID={`log-entry-${entry.index}-unavailable`}>
        Nothing more can be logged against it.
      </Text>
    </Stack>
  )
}

/** The entry in focus: its sets, the next one large, and Log. */
function Focus({
  entry,
  exercise,
  sets,
  entrySets,
  asked,
  selected,
  onSelect,
  onHowTo,
  unit,
}: {
  readonly entry: SessionEntry
  readonly exercise: Exercise
  readonly sets: WorkoutSets
  readonly entrySets: ReturnType<typeof setsOf<WorkoutSets['all'][number]>>
  readonly asked: EntryTarget | undefined
  readonly selected: string | null
  readonly onSelect: (key: string) => void
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly unit: WeightUnit
}): React.JSX.Element {
  const next = nextSet(entrySets)
  const words = nextSetWords(entrySets, next, true)
  const target = next?.target ?? asked?.target ?? prescriptionOf(entry)?.target ?? NO_TARGET
  const load = useLoads()(exercise)
  // Where the athlete's equipment stopped it (#36): their heaviest, or their lightest.
  const limit = asked?.limit == null ? '' : ` · ${LOAD_LIMIT_WORDS[asked.limit]}`
  const { tracking } = exercise
  return (
    <FocusLogger
      // Keyed by the set it logs: the numbers start again from what the NEXT set asks.
      key={`${entry.id}:${next?.key ?? 'more'}:${sets.all.at(-1)?.id ?? ''}`}
      name={exercise.name}
      cue={entry.cue}
      tracking={tracking}
      sets={markedSets(entrySets, sets.waiting)}
      selected={selected}
      onSelect={onSelect}
      next={{ target, isWarmup: next?.isWarmup ?? false, title: words.title, action: words.action }}
      progressed={
        asked === undefined
          ? null
          : asked.changed
            ? `Progressed to ${formatWithReserve(asked.target, tracking, unit)}${limit} · the plan says ${formatEffort(asked.prescribed, tracking, unit)}`
            : `Prescribed ${formatWithReserve(asked.target, tracking, unit)}${limit}`
      }
      last={asked?.last == null ? null : `Last time ${formatSets(asked.last, tracking, unit)}`}
      busy={sets.record.busy}
      load={load}
      onLog={(effort, isWarmup, rpe) => {
        sets.record.log({ exerciseId: entry.exerciseId, entryId: entry.id, effort, isWarmup, rpe })
      }}
      onHowTo={() => {
        onHowTo(exercise, entry.cue)
      }}
      testID={`log-entry-${entry.index}`}
    />
  )
}

/**
 * What the planned day shows (#24): the entry in focus — chosen, else the contract's `focusOf` — or an
 * added exercise — chosen, just added, or the one a swap was logged to last; and the set shown above
 * it — re-opened from its mark, else the one logged last — and whether its entry has all it asked.
 * The choices hold until the next set is logged.
 */
export function usePlannedFocus(
  day: SessionDay,
  targets: readonly EntryTarget[],
  sets: WorkoutSets,
  extras: readonly SessionExercise[],
  added: string | null,
) {
  const latest = sets.all.at(-1)
  const [chosen, choose] = useUntilNextSet<Chosen>(latest?.id ?? null)
  const [reopened, reopen] = useUntilNextSet<Reopened>(latest?.id ?? null)
  const asked = (entry: SessionEntry) => targets.find((t) => t.entryId === entry.id)
  const loadFor = useLoads()
  const setsFor = (entry: SessionEntry) =>
    setsOf(entry, sets.all, asked(entry)?.target ?? null, loadFor(entry.exercise))

  const chosenEntry =
    chosen !== null && 'entry' in chosen
      ? day.entries.find((e) => e.id === chosen.entry)
      : undefined
  // An added exercise is in focus when chosen, just added, or the one a swap was logged to last.
  const extra = adHocFocus(
    extras,
    sets.all,
    chosen !== null && 'added' in chosen ? chosen.added : null,
    added,
  )
  const extraInFocus =
    chosenEntry === undefined &&
    extra !== undefined &&
    ((chosen !== null && 'added' in chosen) || added === extra.id || latest?.entryId === null)
      ? extra
      : undefined
  const focus = chosenEntry?.exercise == null ? focusOf(day, sets.all) : chosenEntry

  const shownEntry = day.entries.find((e) => e.id === (reopened?.entryId ?? latest?.entryId))
  const shown =
    reopened === null
      ? (latest ?? null)
      : reopened.entryId === null
        ? (adHocSetsOf(reopened.exerciseId, sets.all).find((s) => s.key === reopened.key)?.log ??
          null)
        : shownEntry === undefined
          ? null
          : (setsFor(shownEntry).find((s) => s.key === reopened.key)?.log ?? null)
  const finished = shownEntry !== undefined && nextSet(setsFor(shownEntry)) === null
  return {
    choose,
    reopen,
    reopened,
    asked,
    setsFor,
    chosenEntry,
    extraInFocus,
    focus,
    shown,
    shownEntry,
    /** The entry "+ set" adds to: the one of the set shown, once it has all it asked for. */
    another: finished && shown?.entryId === shownEntry?.id ? (shownEntry?.id ?? null) : null,
  }
}

/** What is in focus: an unavailable entry, an added exercise, the entry, or — all done — Finish. */
export function InFocus({
  focused,
  sets,
  full,
  onHowTo,
  onFinish,
  finishing,
  unit,
}: {
  readonly focused: ReturnType<typeof usePlannedFocus>
  readonly sets: WorkoutSets
  readonly full: readonly Exercise[]
  readonly onHowTo: (exercise: Exercise, cue: string | null) => void
  readonly onFinish: () => Promise<void>
  readonly finishing: boolean
  readonly unit: WeightUnit
}): React.JSX.Element {
  const { chosenEntry, extraInFocus, focus, reopened, reopen, setsFor, asked } = focused
  if (chosenEntry?.exercise === null) return <Unavailable entry={chosenEntry} unit={unit} />
  if (extraInFocus !== undefined) {
    return (
      <AdHocFocus
        exercise={extraInFocus}
        whole={full.find((e) => e.id === extraInFocus.id)}
        sets={sets}
        selected={reopened?.exerciseId === extraInFocus.id ? reopened.key : null}
        onSelect={(key) => {
          reopen({ entryId: null, exerciseId: extraInFocus.id, key })
        }}
        onHowTo={(exercise) => {
          onHowTo(exercise, null)
        }}
      />
    )
  }
  if (focus === null || focus.exercise === null) {
    return (
      <Stack gap="md" testID="day-done">
        <Text variant="heading">Every set of the day is logged.</Text>
        <ConfirmButton
          title="Finish session"
          busy={finishing}
          onConfirm={onFinish}
          testID="finish-session"
        />
      </Stack>
    )
  }
  return (
    <Focus
      entry={focus}
      exercise={focus.exercise}
      sets={sets}
      entrySets={setsFor(focus)}
      asked={asked(focus)}
      selected={reopened?.entryId === focus.id ? reopened.key : null}
      onSelect={(key) => {
        reopen({ entryId: focus.id, exerciseId: focus.exerciseId, key })
      }}
      onHowTo={onHowTo}
      unit={unit}
    />
  )
}
