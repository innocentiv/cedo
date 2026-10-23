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

/** One logger: a plan entry's (`log-entry-0`) or an exercise's in a session without a plan. */
const logger = (page: Page, id: string) => ({
  shown: async (): Promise<void> => {
    await page.waitFor(id)
  },
  fill: async (dimension: Dimension, text: string): Promise<void> => {
    await page.fill(`${id}-${dimension}`, text)
  },
  /** Taps a field, which selects its text: the next key replaces it. */
  focus: async (dimension: Dimension): Promise<void> => {
    await page.click(`[data-testid="${id}-${dimension}"]`)
  },
  value: async (dimension: Dimension): Promise<unknown> => await page.value(`${id}-${dimension}`),
  /** "Prescribed 8 × 60 kg", or "Progressed to … · the plan says …". */
  target: async (): Promise<string | null> => await page.text(`${id}-target`),
  /** What the plan tells the athlete about this entry — null when nothing. */
  cue: async (): Promise<string | null> => await page.text(`${id}-cue`),
  /** "Rest 1:28", or "Rest over — ready for the next set"; null before the first working set. */
  rest: async (): Promise<string | null> => await page.text(`${id}-rest`),
  /** "Last: 5, 5, 5 × 60 kg" — null when the exercise was never done before. */
  last: async (): Promise<string | null> => await page.text(`${id}-last`),
  /** Says how many reps were left in reserve, as offered: `1`, `1.5`, or `none` for not said. */
  reserve: async (reps: string): Promise<void> => {
    await page.click(`[data-testid="${id}-reserve-${reps}"]`)
  },
  /** The reps in reserve chosen now, as offered — `none` when not said. */
  reserveChosen: async (): Promise<string | null> => {
    const chosen = await page.evaluate(
      `document.querySelector('[data-testid^="${id}-reserve-"][aria-selected="true"]')?.dataset.testid ?? null`,
    )
    return typeof chosen === 'string' ? chosen.slice(`${id}-reserve-`.length) : null
  },
  /** Whether it offers a Log button at all. */
  canLog: async (): Promise<boolean> => await page.exists(`${id}-log`),
  /** Whether it is shown as an unavailable exercise. */
  unavailable: async (): Promise<boolean> => await page.exists(`${id}-unavailable`),
  /** Taps Log for a set the server will refuse: the screen says why (`session.error`). */
  attemptLog: async (): Promise<void> => {
    await page.click(`[data-testid="${id}-log"]`)
  },
  /** "2 done". */
  done: async (): Promise<string | null> => {
    await page.waitFor(`${id}-done`)
    return await page.text(`${id}-done`)
  },
  /**
   * Logs a set, and waits until it is a row: the next one is numbered from the refreshed logs. The
   * rows before are counted from the same session read the logger is drawn from, so a logger on
   * screen has its rows on screen too.
   */
  log: async (): Promise<void> => {
    const before = (await loggedIds(page)).length
    await page.click(`[data-testid="${id}-log"]`)
    await page.until(
      async () => (await loggedIds(page)).length,
      (rows) => rows > before,
    )
  },
  /** Logs a set with no signal: it shows at once, as waiting to be sent (#9). */
  logWhileOffline: async (): Promise<void> => {
    const before = await waitingCount(page)
    await page.click(`[data-testid="${id}-log"]`)
    await page.until(
      async () => await waitingCount(page),
      (rows) => rows > before,
    )
  },
})

/** The sets shown as logged but not yet sent. */
async function waitingCount(page: Page): Promise<number> {
  const count = await page.evaluate(
    `document.querySelectorAll('[data-testid^="waiting-set-"]').length`,
  )
  return typeof count === 'number' ? count : 0
}

export const session = (page: Page) => {
  const shown = async (): Promise<void> => {
    await page.waitFor('session-screen')
  }
  return {
    shown,
    entry: (index: number) => logger(page, `log-entry-${index}`),
    adhoc: (exerciseId: string) => logger(page, `adhoc-${exerciseId}`),

    /** Starts a session without a plan, from Today. */
    startAdhoc: async (): Promise<void> => {
      await page.goto('/today')
      await page.waitFor('start-adhoc')
      await page.click('[data-testid="start-adhoc"]')
      await page.waitFor('session-adhoc')
    },
    /** Picks an exercise into a session without a plan; returns its id once its logger shows. */
    addExercise: async (search: string): Promise<string> => {
      await page.click('[data-testid="adhoc-add-exercise"]')
      const exerciseId = await picker(page).pick(search)
      await page.waitFor(`adhoc-${exerciseId}`)
      return exerciseId
    },

    /** Navigates to the session by its URL — a reload, a shared link, coming back to the tab. */
    reopen: async (): Promise<void> => {
      await page.goto(String(await page.evaluate('location.pathname')))
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
    /** Undoes a logged set by its row's id. */
    undo: async (rowId: string): Promise<void> => {
      await page.click(`[data-testid="${rowId}"]`)
    },

    canFinish: async (): Promise<boolean> => await page.exists('finish-session'),
    /** Finishes the session; where that goes depends on where it was reached from. */
    finish: async (): Promise<void> => {
      await page.waitFor('finish-session')
      await page.click('[data-testid="finish-session"]')
    },
  }
}
