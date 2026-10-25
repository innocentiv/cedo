import type { Page } from '../harness.ts'
import { picker } from './picker.ts'

/** A session being trained: its loggers, the sets logged so far, and finishing it. */

type Dimension = 'weight' | 'reps' | 'duration' | 'distance'

/**
 * Every logged-set row SHOWN. A tab keeps its stack mounted, so the same session can be in the page
 * twice — once hidden — and counting both would read every set double.
 */
const VISIBLE_ROWS = `[...document.querySelectorAll('[data-testid^="logged-set-"]')].filter((e) => e.offsetParent != null)`

/** The logged-set rows, in order, by test id. */
async function loggedIds(page: Page): Promise<string[]> {
  const ids = await page.evaluate(`${VISIBLE_ROWS}.map((e) => e.dataset.testid)`)
  if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) {
    throw new Error(`Could not read the logged sets: ${JSON.stringify(ids)}`)
  }
  return ids
}

/** A working set's mark that is logged: done, a personal best, or waiting for a signal. */
const LOGGED_MARK = /, (done|best|waiting)$/u

/**
 * The exercise in focus (#24): a plan entry's (`log-entry-0`), or an exercise's in a session
 * without a plan (`adhoc-<id>`). Only the entry in focus has a logger on screen, so every action
 * makes it current first — by tapping it in the day (`choose`), as an athlete would.
 */
const logger = (page: Page, id: string, choose: string) => {
  const current = async (): Promise<void> => {
    if (await page.shown(id)) return
    await page.click(`[data-testid="${choose}"]`)
    await page.waitFor(id)
  }
  /**
   * The reserve offered on the set just logged, as chosen — `1`, or `none` when nothing is said yet;
   * null when none is asked.
   */
  const reserveChosen = async (): Promise<string | null> => {
    if (!(await page.shown('last-set-reserve'))) return null
    const chosen = await page.evaluate(
      `document.querySelector('[data-testid^="last-set-reserve-"][aria-selected="true"]')?.dataset.testid ?? null`,
    )
    return typeof chosen === 'string' ? chosen.slice('last-set-reserve-'.length) : 'none'
  }
  return {
    /** On a bodyweight movement: whether the weight is added load or assistance (#19). */
    assistance: async (choice: 'added' | 'assisted'): Promise<void> => {
      await current()
      await page.click(`[data-testid="${id}-weight-assistance-${choice}"]`)
    },
    shown: async (): Promise<void> => {
      await current()
    },
    fill: async (dimension: Dimension, text: string): Promise<void> => {
      await current()
      await page.fill(`${id}-${dimension}`, text)
    },
    /** Taps a field, which selects its text: the next key replaces it. */
    focus: async (dimension: Dimension): Promise<void> => {
      await current()
      await page.click(`[data-testid="${id}-${dimension}"]`)
    },
    value: async (dimension: Dimension): Promise<unknown> => {
      await current()
      return await page.value(`${id}-${dimension}`)
    },
    /** "Prescribed 8 × 60 kg", or "Progressed to … · the plan says …". */
    target: async (): Promise<string | null> => {
      await current()
      return await page.text(`${id}-target`)
    },
    /** What the plan tells the athlete about this entry — null when nothing. */
    cue: async (): Promise<string | null> => {
      await current()
      return await page.text(`${id}-cue`)
    },
    /**
     * "Rest 1:28", or "Rest over — ready for the next set"; null when no rest runs. The band is the
     * session's, across the top: the rest of the set logged last.
     */
    rest: async (): Promise<string | null> => {
      if (!(await page.shown('rest-band'))) return null
      const left = await page.text('rest-band-left')
      return left === 'Next set' ? 'Rest over — ready for the next set' : `Rest ${left ?? ''}`
    },
    /** "Last time 5, 5, 5 × 60 kg" — null when the exercise was never done before. */
    last: async (): Promise<string | null> => {
      await current()
      return await page.text(`${id}-last`)
    },
    /**
     * Says how many reps were left in the set just logged, as offered — `0` to `5` — and waits until
     * the server has it: asked after a set, not before (#24).
     */
    reserve: async (reps: string): Promise<void> => {
      await page.click(`[data-testid="last-set-reserve-${reps}"]`)
      await page.until(reserveChosen, (chosen) => chosen === reps)
    },
    reserveChosen,
    /** Whether it offers a Log button at all. */
    canLog: async (): Promise<boolean> => {
      await current()
      return await page.exists(`${id}-log`)
    },
    /** Whether it is shown as an unavailable exercise. */
    unavailable: async (): Promise<boolean> => await page.exists(`${id}-unavailable`),
    /** Taps Log for a set the server will refuse: the screen says why (`session.error`). */
    attemptLog: async (): Promise<void> => {
      await current()
      await page.click(`[data-testid="${id}-log"]`)
    },
    /** "2 done": its working sets logged, as its marks show them. */
    done: async (): Promise<string | null> => {
      await current()
      const labels = await page.evaluate(
        `[...document.querySelectorAll('[data-testid^="${id}-sets-s"], [data-testid^="${id}-sets-x"]')].map((e) => e.getAttribute('aria-label') ?? '')`,
      )
      const count = Array.isArray(labels)
        ? labels.filter((l) => typeof l === 'string' && LOGGED_MARK.test(l)).length
        : 0
      return `${count} done`
    },
    /**
     * Logs a set, and waits until it is a row: the next one is numbered from the refreshed logs. The
     * rows before are counted from the same session read the logger is drawn from, so a logger on
     * screen has its rows on screen too.
     */
    log: async (): Promise<void> => {
      await current()
      const before = (await loggedIds(page)).length
      await page.click(`[data-testid="${id}-log"]`)
      await page.until(
        async () => (await loggedIds(page)).length,
        (rows) => rows > before,
      )
    },
    /** Logs a set with no signal: it shows at once, as waiting to be sent (#9). */
    logWhileOffline: async (): Promise<void> => {
      await current()
      const before = await waitingCount(page)
      await page.click(`[data-testid="${id}-log"]`)
      await page.until(
        async () => await waitingCount(page),
        (rows) => rows > before,
      )
    },
  }
}

/** The sets shown as logged but not yet sent. */
async function waitingCount(page: Page): Promise<number> {
  const count = await page.evaluate(
    `document.querySelectorAll('[data-testid^="unsent-set-"]').length`,
  )
  return typeof count === 'number' ? count : 0
}

export const session = (page: Page) => {
  const shown = async (): Promise<void> => {
    await page.waitFor('session-screen')
  }
  return {
    shown,
    entry: (index: number) => logger(page, `log-entry-${index}`, `up-next-${index}`),
    adhoc: (exerciseId: string) => logger(page, `adhoc-${exerciseId}`, `adhoc-row-${exerciseId}`),

    /**
     * Starts a session without a plan, from Today. It opens on the picker — there is nothing else
     * to do on it yet (#24) — which `addExercise` uses.
     */
    startAdhoc: async (): Promise<void> => {
      await page.goto('/today')
      await page.waitFor('start-adhoc')
      await page.click('[data-testid="start-adhoc"]')
      await page.waitFor('exercise-picker')
    },
    /**
     * Picks an exercise into the session — the whole day of one without a plan, or a swap in one
     * that has; returns its id once its logger shows, in focus.
     */
    addExercise: async (search: string): Promise<string> => {
      if (!(await page.shown('exercise-picker'))) {
        const add = (await page.shown('adhoc-add-exercise'))
          ? 'adhoc-add-exercise'
          : 'session-add-exercise'
        await page.click(`[data-testid="${add}"]`)
      }
      const exerciseId = await picker(page).pick(search)
      await page.waitFor(`adhoc-${exerciseId}`)
      return exerciseId
    },

    /** "+ set" on the set just logged: one more beyond its entry's prescription (#24). */
    another: async (): Promise<void> => {
      await page.click('[data-testid="last-set-another"]')
    },
    /** Whether the screen says every set of the day is logged, offering Finish in Log's place. */
    dayDone: async (): Promise<boolean> => await page.shown('day-done'),
    /** Back to the session left open, from anywhere else: the bar that follows it (#24). */
    returnTo: async (): Promise<void> => {
      await page.click('[data-testid="session-return"]')
      await shown()
    },
    /**
     * Leaves the session with its header's back, in progress: only Finish ends it (#24 review).
     */
    back: async (): Promise<void> => {
      await page.click('[data-testid="session-header-back"]')
    },
    /** Writes the session's note in its menu, and closes the menu: there is no Save to tap. */
    note: async (text: string): Promise<void> => {
      await page.click('[data-testid="session-header-menu"]')
      await page.fill('session-notes', text)
      await page.click('[data-testid="session-menu-close"]')
    },
    /** Navigates to the session by its URL — a reload, a shared link, coming back to the tab. */
    reopen: async (): Promise<void> => {
      await page.goto(String(await page.evaluate('location.pathname')))
      // A session with nothing in it and no plan opens on the picker (#24).
      await page.until(
        async () => (await page.shown('session-screen')) || (await page.shown('exercise-picker')),
        (open) => open,
      )
    },
    /** Puts away the picker a session without a plan opened on, for the session itself. */
    skipPicking: async (): Promise<void> => {
      await page.click('[data-testid="picker-cancel"]')
      await shown()
    },
    text: async (): Promise<string> => (await page.text('session-screen')) ?? '',
    /** What the screen says a write was refused for, once it says it. */
    error: async (): Promise<string | null> => {
      await page.waitFor('session-error')
      return await page.text('session-error')
    },
    /** Whether the screen says the plan behind the session is out of reach. */
    planUnavailable: async (): Promise<boolean> => await page.exists('session-plan-unavailable'),

    /** Waits until the sets logged so far are on screen. */
    logsShown: async (): Promise<void> => {
      await page.waitFor('session-logs')
    },
    loggedIds: async (): Promise<string[]> => await loggedIds(page),
    /**
     * The rendered lines of every logged set, newest last. `innerText`, not `textContent`: the
     * latter runs "Set 1" into "8 × 60 kg" as "Set 18 × 60 kg", and a `toContain('8 × 60 kg')`
     * over that also passes for 88 reps — the very bug the assertion existed to catch.
     */
    loggedLines: async (): Promise<string[]> => {
      const text = await page.evaluate(`${VISIBLE_ROWS}.map((e) => e.innerText).join('\\n')`)
      return typeof text === 'string' ? text.split('\n').map((line) => line.trim()) : []
    },
    /** The open session's id, from the address it is shown at. */
    id: async (): Promise<string> => {
      await shown()
      const path = String(await page.evaluate('location.pathname'))
      const id = /^\/today\/session\/([^/]+)$/u.exec(path)?.[1]
      if (id === undefined) throw new Error(`Not on a session: ${path}`)
      return id
    },
    /** How many sets the screen shows as waiting to be sent. */
    waiting: async (): Promise<number> => await waitingCount(page),
    /** Waits until no set is waiting any more: every one sent, and shown among the logged. */
    sent: async (): Promise<void> => {
      await page.until(
        async () => await waitingCount(page),
        (rows) => rows === 0,
      )
    },
    /** Undoes a logged set by its row's id, with the row's undo. */
    undo: async (rowId: string): Promise<void> => {
      await page.click(`[data-testid="${rowId.replace(/^logged-set-/u, 'undo-set-')}"]`)
    },

    /** Whether Finish is offered: in the day's place once all is logged, else in the menu. */
    canFinish: async (): Promise<boolean> => {
      if (await page.shown('finish-session')) return true
      await page.click('[data-testid="session-header-menu"]')
      await page.waitFor('session-menu')
      const offered = await page.exists('finish-session')
      await page.click('[data-testid="session-menu-close"]')
      return offered
    },
    /**
     * Finishes the session — asked twice, finishing being final — reads what it came to, and leaves
     * with Done: where that goes depends on where it was reached from.
     */
    finish: async (): Promise<void> => {
      if (!(await page.shown('finish-session'))) {
        await page.click('[data-testid="session-header-menu"]')
        await page.waitFor('finish-session')
      }
      await page.click('[data-testid="finish-session"]')
      await page.click('[data-testid="finish-session-confirm"]')
      await page.waitFor('session-finished')
      await page.click('[data-testid="leave-session"]')
    },
  }
}
