import type { OwnableScope } from '@cedo/contract'
import type { Page } from '../harness.ts'
import { inView } from './desk.ts'
import { chooseOption } from './lines.ts'
import { picker } from './picker.ts'
import { placement } from './placement.ts'
import { session } from './session.ts'

/** Plans: the list, and a plan's page — its outline, edited in place (#26). */

/** A numeric field of a plan entry: a dimension, or `sets` / `warmups`. */
type EntryField = 'weight' | 'reps' | 'duration' | 'distance' | 'sets' | 'warmups'

/**
 * A plan entry, by its place: its line in the outline, and its settings — opened from the line, in
 * a sheet on a phone (#26). Every field action opens them first, as an athlete would.
 */
const planEntry = (page: Page, day: number, index: number) => {
  const id = `plan-entry-${String(day)}-${String(index)}`
  const open = async (): Promise<void> => {
    if (await page.shown(id)) return
    await page.click(`[data-testid="plan-line-${String(day)}-${String(index)}"]`)
    await page.waitFor(id)
  }
  return {
    /** Taps its line, opening its settings: in a sheet on a phone, the pane on a desktop. */
    open,
    /** Its line in the outline, as it reads: the exercise, what it prescribes, how it progresses. */
    text: async (): Promise<string> =>
      (await page.text(`plan-line-${String(day)}-${String(index)}`)) ?? '',
    has: async (field: EntryField): Promise<boolean> => {
      await open()
      return await page.exists(`${id}-${field}`)
    },
    /** Taps a field, which selects its text: the next key replaces it. */
    focus: async (field: EntryField): Promise<void> => {
      await open()
      await page.click(`[data-testid="${id}-${field}"]`)
    },
    value: async (field: EntryField): Promise<unknown> => {
      await open()
      return await page.value(`${id}-${field}`)
    },
    progression: async (kind: string): Promise<void> => {
      await open()
      await page.click(`[data-testid="${id}-progression-${kind}"]`)
    },
    /** The rest between its sets, typed as the field reads it: `90`, `1:30`. */
    rest: async (text: string): Promise<void> => {
      await open()
      await page.fill(`${id}-rest`, text)
    },
    /** What the athlete is told about it, typed. */
    cue: async (text: string): Promise<void> => {
      await open()
      await page.fill(`${id}-cue`, text)
    },
    /** The reps to leave in reserve, as offered: `0` to `5`. */
    reserve: async (reps: string): Promise<void> => {
      await open()
      await page.click(`[data-testid="${id}-reserve-${reps}"]`)
    },
    progressionSummary: async (): Promise<string | null> => {
      await open()
      return await page.text(`${id}-progression-summary`)
    },
    /** What an unavailable entry prescribes, on its line — it has no settings to open. */
    target: async (): Promise<string | null> => await page.text(`${id}-target`),
    /** Whether its line says it is an unavailable exercise. */
    unavailable: async (): Promise<boolean> => await page.exists(`${id}-unavailable`),
    /** To the end of another day, from its settings (#26). */
    moveToDay: async (to: number): Promise<void> => {
      await open()
      await page.click(`[data-testid="${id}-day-${String(to)}"]`)
    },
    /** Out of the plan — asked twice: the bin on an unavailable line, else in its settings. */
    remove: async (): Promise<void> => {
      if (!(await page.shown(`${id}-remove`))) await open()
      await page.click(`[data-testid="${id}-remove"]`)
      await page.click(`[data-testid="${id}-remove-confirm"]`)
    },
  }
}

/** The plans list, and a plan's detail. */
export const workouts = (page: Page) => {
  const shown = async (): Promise<void> => {
    await page.waitFor('workout-detail-screen')
  }
  return {
    /** Which group the open plan is in, and transferring it to another. */
    placement: placement(page, 'workout-transfer', 'workout-pin'),
    /** Opens the first plan in the list on screen. */
    openFirst: async (): Promise<void> => {
      const row = await page.waitForSelector('[data-testid^="workout-row-"]')
      await page.click(`[data-testid="${row}"]`)
      await shown()
    },
    /** Waits for a plan's detail. */
    shown,
    detailText: async (): Promise<string> => {
      await shown()
      return (await page.text('workout-detail-screen')) ?? ''
    },
    startDay: async (day: number): Promise<void> => {
      await page.click(`[data-testid="start-day-${day}"]`)
      await session(page).shown()
    },
    /** Waits for the plan to say a session is in progress — in place of its Start buttons. */
    inProgressShown: async (): Promise<void> => {
      await page.waitFor('workout-in-progress')
    },
    canStart: async (day: number): Promise<boolean> => await page.exists(`start-day-${day}`),
    /** Deletes the plan, asked twice, and waits to be back where it was opened from. */
    delete: async (): Promise<void> => {
      await page.click('[data-testid="workout-delete"]')
      await page.click('[data-testid="workout-delete-confirm"]')
      await page.until(
        async () => await page.shown('workout-detail-screen'),
        (open) => !open,
      )
    },
    /** Asks to delete it, and returns what it says beside Delete it was refused for. */
    deleteRefused: async (): Promise<string | null> => {
      await page.click('[data-testid="workout-delete"]')
      await page.click('[data-testid="workout-delete-confirm"]')
      await page.waitFor('workout-delete-error')
      await page.waitFor('workout-delete')
      return await page.text('workout-delete-error')
    },
    /** Asks for the next page of plans (#52). */
    more: async (): Promise<void> => {
      await page.click('[data-testid="workouts-more"]')
    },
    /** The plans listed under a scope — `favourites` is shown as Pinned. */
    listed: async (scope: OwnableScope): Promise<string[]> => {
      await page.goto('/workouts')
      await chooseOption(page, 'workout-scope', scope)
      return await workouts(page).showing()
    },
    /**
     * The plans the list shows where it stands — no reload, so a journey can watch a cached list
     * change — once it has answered: rows, or "No plans yet".
     */
    showing: async (): Promise<string[]> => {
      const names = await page.until(
        async () =>
          await page.evaluate(
            `document.querySelector('[data-testid="workouts-empty"]') ? [] : document.querySelector('[data-testid="workout-list"]') ? [...document.querySelectorAll('[data-testid^="workout-row-"]')].map((e) => e.innerText.split('\\n')[0].trim()) : null`,
          ),
        (seen) => Array.isArray(seen),
      )
      return Array.isArray(names) ? names.map(String) : []
    },
    /**
     * Copies a plan shared with you into your own group; lands on the copy's page, and returns the
     * copy's id — from the address it landed on.
     */
    duplicate: async (): Promise<string> => {
      await page.waitFor('duplicate-workout')
      const original = String(await page.evaluate('location.pathname'))
      await page.click('[data-testid="duplicate-workout"]')
      const id = await page.until(
        async () => {
          const path = String(await page.evaluate('location.pathname'))
          return path === original ? undefined : /^\/workouts\/([^/]+)$/u.exec(path)?.[1]
        },
        (copy) => copy !== undefined && copy !== '',
      )
      if (id === undefined) throw new Error('Duplicating did not land on the copy')
      return id
    },
    /** Asks for a copy, and returns what it says beside the button it was refused for. */
    duplicateRefused: async (): Promise<string | null> => {
      await page.waitFor('duplicate-workout')
      await page.click('[data-testid="duplicate-workout"]')
      await page.waitFor('duplicate-workout-error')
      return await page.text('duplicate-workout-error')
    },
    /** Opens the session in progress from the plan. */
    resume: async (): Promise<void> => {
      await page.click('[data-testid="workout-resume"]')
      await session(page).shown()
    },
  }
}

/**
 * A workout's plan, edited in place on its page (#26, ADR-0022): every change saved as it is made.
 * `save` waits for the page to say so, then goes back where it came from, as Save used to.
 */
export const planEditor = (page: Page) => {
  /** Puts an entry's settings away: they cover the outline on a phone. */
  const closeSettings = async (): Promise<void> => {
    if (!(await page.shown('entry-sheet'))) return
    await page.click('[data-testid="entry-sheet-close"]')
    await page.until(
      async () => await page.shown('entry-sheet'),
      (open) => !open,
    )
  }
  /** Waits until the page says the plan is saved — failing with why, if it was refused. */
  const saved = async (): Promise<void> => {
    await closeSettings()
    const status = await page.until(
      async () =>
        (await page.shown('plan-said'))
          ? `refused: ${(await page.text('plan-said')) ?? ''}`
          : await page.text('plan-status'),
      (seen) => seen === 'Saved' || seen?.startsWith('refused') === true,
    )
    if (status !== 'Saved') throw new Error(`Saving was ${String(status)}`)
  }
  const save = async (): Promise<void> => {
    await saved()
    await page.click('[data-testid="workout-back"]')
    await page.until(
      async () => await page.shown('workout-detail-screen'),
      (open) => !open,
    )
  }
  return {
    /**
     * A new plan with one day around the first exercise matching `exercise`, open on its page. From
     * the shared library by default, so no exercise has to be created first. Returns the
     * exercise's id.
     */
    create: async (exercise = 'Bench', name = 'Push Day'): Promise<string> => {
      await page.goto('/workouts')
      await page.waitFor('workouts-screen')
      await page.fill('workout-name', name)
      await page.click('[data-testid="create-workout"]')

      await page.waitFor('workout-detail-screen')
      await page.click('[data-testid="add-day"]')
      await page.waitFor('plan-day-0')
      await page.click('[data-testid="add-entry-0"]')
      const exerciseId = await picker(page).pick(exercise)
      await page.waitFor('plan-line-0-0')
      return exerciseId
    },
    /** An existing plan, opened on its page by its address. */
    open: async (workoutId: string): Promise<void> => {
      await page.goto(`/workouts/${workoutId}`)
      await page.waitFor('workout-detail-screen')
    },
    entry: (day: number, index: number) => planEntry(page, day, index),
    /** On a desktop, whether the entry's pane is in view, beside however far down the outline is. */
    paneInView: async (): Promise<boolean> => await inView(page, 'entry-panel'),
    /** Whether the plan's name, beside Back, is in view, however far down the outline is. */
    nameInView: async (): Promise<boolean> =>
      (await inView(page, 'workout-name-edit')) && (await inView(page, 'workout-back')),
    /** Taps a day's name: a plain text input, so the caret lands where the tap did. */
    focusDayName: async (day: number): Promise<void> => {
      await closeSettings()
      await page.click(`[data-testid="day-name-${String(day)}"]`)
    },
    /** Leaves the field being typed in, as a tap on the page around it would: it is kept. */
    leaveField: async (): Promise<void> => {
      await page.click('[data-testid="plan-status"]')
    },
    /** A day's name, as its field holds it. */
    dayName: async (day: number): Promise<unknown> => await page.value(`day-name-${String(day)}`),
    /** Opens the picker to add exercises to a day (#27). */
    addTo: async (day: number): Promise<void> => {
      await closeSettings()
      await page.click(`[data-testid="add-entry-${String(day)}"]`)
      await page.waitFor('exercise-picker')
    },
    /** How many entries a day's outline shows. */
    entries: async (day: number): Promise<number> => {
      const count = await page.evaluate(
        `document.querySelectorAll('[data-testid="plan-day-${String(day)}"] [data-testid^="plan-line-"]').length`,
      )
      return Number(count)
    },
    /** Adds a day at the foot of the outline. */
    addDay: async (): Promise<void> => {
      await closeSettings()
      await page.click('[data-testid="add-day"]')
    },
    /** What the page said of a save it put back, or a plan it read again; null when nothing. */
    said: async (): Promise<string | null> =>
      (await page.exists('plan-said')) ? await page.text('plan-said') : null,
    /** What the page says the schema would refuse, or null when it says nothing. */
    issues: async (): Promise<string | null> =>
      (await page.exists('plan-issues')) ? await page.text('plan-issues') : null,
    /** Whether the plan on screen is one that will be saved: nothing the schema would refuse. */
    canSave: async (): Promise<boolean> => !(await page.exists('plan-issues')),
    /** Waits until every change is saved, staying on the page. */
    saved,
    save,
    /** Saves, opens the plan, and starts its first day. */
    saveAndStart: async (): Promise<void> => {
      await save()
      await workouts(page).openFirst()
      await workouts(page).startDay(0)
    },
  }
}
