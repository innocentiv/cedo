import { useState } from 'react'
import {
  type EntryTarget,
  type Exercise,
  type SessionDay,
  type SessionEntry,
  type SetLog,
  type WeightUnit,
  focusOf,
  formatEffort,
  formatPrescription,
  formatSets,
  formatWithReserve,
  markedSets,
  nextSet,
  nextSetWords,
  progressOf,
  setsOf,
} from '@cedo/contract'
import type { PendingLog } from '../api/pending.ts'
import { ConfirmButton, FocusLogger, Stack, Text, UpNext } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import type { useRecordSet } from './record-set.ts'
import { ShownSet, useShown } from './shown-set.tsx'
import { useWeightUnit } from './weight-unit.ts'

/**
 * A session that follows a plan's day (#24): the entry in focus, the set just logged, and the rest
 * of the day — every rule the contract's `session-flow`, this only what the athlete chose to look
 * at, which holds until the next set is logged. See docs/08-frontend.md, "The workout screen".
 */
export function PlannedDay({
  day,
  targets,
  serverLogs,
  logs,
  waiting,
  record,
  onUndo,
  onHowTo,
  onFinish,
  finishing,
}: {
  readonly day: SessionDay
  readonly targets: readonly EntryTarget[]
  /** The sets as the server has them: what can be undone, or given a reserve. */
  readonly serverLogs: readonly SetLog[]
  /** Those and the ones still waiting for a signal (`withPending`), which count as done. */
  readonly logs: readonly PendingLog[]
  readonly waiting: ReadonlySet<string>
  readonly record: ReturnType<typeof useRecordSet>
  readonly onUndo: (logId: string) => void
  readonly onHowTo: (exercise: Exercise) => void
  readonly onFinish: () => Promise<void>
  readonly finishing: boolean
}): React.JSX.Element {
  const unit = useWeightUnit()
  const latest = logs.at(-1)?.id ?? null
  const [choice, setChoice] = useState<{ readonly entryId: string; readonly at: string | null }>()
  const shown = useShown(latest)

  const chosen =
    choice?.at === latest ? day.entries.find((e) => e.id === choice.entryId) : undefined
  const focus = chosen?.exercise == null ? focusOf(day, logs) : chosen
  const working = (entry: SessionEntry) => targets.find((t) => t.entryId === entry.id)
  const setsFor = (entry: SessionEntry) => setsOf(entry, logs, working(entry)?.target ?? null)
  // The set re-opened from a mark, `<entry>:<set>`; otherwise the one logged last.
  const [shownEntry, shownKey] = shown.key?.split(':') ?? []
  const reopened = day.entries.find((e) => e.id === shownEntry)
  const shownLog =
    reopened === undefined
      ? (logs.at(-1) ?? null)
      : (setsFor(reopened).find((s) => s.key === shownKey)?.log ?? null)

  return (
    <Stack gap="xl">
      <ShownSet
        log={shownLog}
        exercise={day.entries.find((e) => e.id === shownLog?.entryId)?.exercise ?? null}
        serverLogs={serverLogs}
        waiting={waiting}
        record={record}
        onUndo={onUndo}
      />
      {chosen !== undefined && chosen.exercise === null ? (
        <Stack gap="sm" testID={`log-entry-${chosen.index}`}>
          <Text variant="title">{exerciseName(null)}</Text>
          <Text tone="muted" testID={`log-entry-${chosen.index}-target`}>
            {`Prescribed ${formatPrescriptionTarget(chosen, unit)}`}
          </Text>
          <Text variant="caption" tone="muted" testID={`log-entry-${chosen.index}-unavailable`}>
            Nothing more can be logged against it.
          </Text>
        </Stack>
      ) : focus === null || focus.exercise === null ? (
        <Stack gap="md" testID="day-done">
          <Text variant="heading">Every set of the day is logged.</Text>
          <ConfirmButton
            title="Finish session"
            busy={finishing}
            onConfirm={onFinish}
            testID="finish-session"
          />
        </Stack>
      ) : (
        <Focus
          entry={focus}
          exercise={focus.exercise}
          sets={setsFor(focus)}
          asked={working(focus)}
          waiting={waiting}
          latest={latest}
          selected={shown.key}
          onSelect={(key) => {
            shown.select(`${focus.id}:${key}`)
          }}
          record={record}
          onHowTo={onHowTo}
          unit={unit}
        />
      )}
      <UpNext
        items={day.entries.map((entry) => ({
          id: String(entry.index),
          name: exerciseName(entry.exercise),
          detail: formatPrescription(entry.sets, entry.exercise?.tracking ?? null, unit),
          progress: progressOf(setsFor(entry)),
          done: nextSet(setsFor(entry)) === null,
          superset: entry.supersetGroup,
        }))}
        current={focus === null ? null : String(focus.index)}
        onChoose={(index) => {
          const entry = day.entries.find((e) => String(e.index) === index)
          if (entry !== undefined) setChoice({ entryId: entry.id, at: latest })
        }}
        testID="up-next"
      />
    </Stack>
  )
}

function Focus({
  entry,
  exercise,
  sets,
  asked,
  waiting,
  latest,
  selected,
  onSelect,
  record,
  onHowTo,
  unit,
}: {
  readonly entry: SessionEntry
  readonly exercise: Exercise
  readonly sets: ReturnType<typeof setsOf<PendingLog>>
  readonly asked: EntryTarget | undefined
  readonly waiting: ReadonlySet<string>
  readonly latest: string | null
  readonly selected: string | null
  readonly onSelect: (key: string) => void
  readonly record: ReturnType<typeof useRecordSet>
  readonly onHowTo: (exercise: Exercise) => void
  readonly unit: WeightUnit
}): React.JSX.Element {
  const next = nextSet(sets)
  const words = nextSetWords(sets, next, true)
  const target = next?.target ?? asked?.target ?? sets.find((s) => !s.isWarmup)?.target
  const { tracking } = exercise
  return (
    <FocusLogger
      // Keyed by the set it logs: the numbers start again from what the NEXT set asks.
      key={`${entry.id}:${next?.key ?? 'more'}:${latest ?? ''}`}
      name={exercise.name}
      cue={entry.cue}
      tracking={tracking}
      sets={markedSets(sets, waiting)}
      selected={
        selected?.startsWith(`${entry.id}:`) === true ? selected.slice(entry.id.length + 1) : null
      }
      onSelect={onSelect}
      next={{
        target: target ?? {
          reps: null,
          weightG: null,
          rpe: null,
          durationS: null,
          distanceMm: null,
        },
        isWarmup: next?.isWarmup ?? false,
        title: words.title,
        action: words.action,
      }}
      progressed={
        asked === undefined
          ? null
          : asked.changed
            ? `Progressed to ${formatWithReserve(asked.target, tracking, unit)} · the plan says ${formatEffort(asked.prescribed, tracking, unit)}`
            : `Prescribed ${formatWithReserve(asked.target, tracking, unit)}`
      }
      last={
        asked?.last === null || asked?.last === undefined
          ? null
          : `Last time ${formatSets(asked.last, tracking, unit)}`
      }
      busy={record.busy}
      onLog={(effort, isWarmup) => {
        record.log({ exerciseId: entry.exerciseId, entryId: entry.id, effort, isWarmup })
      }}
      onHowTo={() => {
        onHowTo(exercise)
      }}
      testID={`log-entry-${entry.index}`}
    />
  )
}

/** An unavailable exercise's prescription, as measured: no mode is known to read it by. */
const formatPrescriptionTarget = (entry: SessionEntry, unit: WeightUnit): string => {
  const target = entry.sets.find((set) => !set.isWarmup)?.target
  return target === undefined ? 'nothing' : formatEffort(target, null, unit)
}
