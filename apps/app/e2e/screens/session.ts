import type { Page } from '../harness.ts'

/** A session being trained: its loggers, the sets logged so far, and finishing it. */

type Dimension = 'weight' | 'reps' | 'duration' | 'distance'

/** Every logged-set row on screen. */
const LOGGED_SET = '[data-testid^="logged-set-"]'

/** The logged-set rows, in order, by test id. */
async function loggedIds(page: Page): Promise<string[]> {
  const ids = await page.evaluate(
    `[...document.querySelectorAll('${LOGGED_SET}')].map((e) => e.dataset.testid)`,
  )
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
  /** "Prescribed 8 × 60 kg". */
  target: async (): Promise<string | null> => await page.text(`${id}-target`),
  /** "2 done". */
  done: async (): Promise<string | null> => {
    await page.waitFor(`${id}-done`)
    return await page.text(`${id}-done`)
  },
  /** Logs a set, and waits until it is a row: the next one is numbered from the refreshed logs. */
  log: async (): Promise<void> => {
    const before = (await loggedIds(page)).length
    await page.click(`[data-testid="${id}-log"]`)
    await page.until(
      async () => (await loggedIds(page)).length,
      (rows) => rows > before,
    )
  },
})

export const session = (page: Page) => {
  const path = async (): Promise<string> => String(await page.evaluate('location.pathname'))
  return {
    entry: (index: number) => logger(page, `log-entry-${index}`),
    adhoc: (exerciseId: string) => logger(page, `adhoc-${exerciseId}`),

    /** Starts a session without a plan, from Today. */
    startAdhoc: async (): Promise<void> => {
      await page.goto('/today')
      await page.waitFor('start-adhoc')
      await page.click('[data-testid="start-adhoc"]')
      await page.waitFor('session-screen')
    },
    /** Picks an exercise into a session without a plan; returns its id once its logger shows. */
    addExercise: async (search: string): Promise<string> => {
      await page.click('[data-testid="adhoc-add-exercise"]')
      await page.waitFor('exercise-picker')
      await page.fill('picker-search', search)
      const picked = await page.waitForSelector('[data-testid^="picker-row-"]')
      const exerciseId = picked.replace('picker-row-', '')
      await page.click(`[data-testid="${picked}"]`)
      await page.waitFor(`adhoc-${exerciseId}`)
      return exerciseId
    },

    /** The session's own address, to come back to it by URL. */
    path,
    /** Navigates to the session by URL — a reload, a shared link, coming back to the tab. */
    reopen: async (): Promise<void> => {
      await page.goto(await path())
      await page.waitFor('session-screen')
    },
    text: async (): Promise<string> => (await page.text('session-screen')) ?? '',

    loggedIds: async (): Promise<string[]> => await loggedIds(page),
    /**
     * The rendered lines of every logged set, newest last. `innerText`, not `textContent`: the
     * latter runs "Set 1" into "8 × 60 kg" as "Set 18 × 60 kg", and a `toContain('8 × 60 kg')`
     * over that also passes for 88 reps — the very bug the assertion existed to catch.
     */
    loggedLines: async (): Promise<string[]> => {
      const text = await page.evaluate(
        `[...document.querySelectorAll('${LOGGED_SET}')].map((e) => e.innerText).join('\\n')`,
      )
      return typeof text === 'string' ? text.split('\n').map((line) => line.trim()) : []
    },
    /** Undoes a logged set by its row's id, and waits until the row is gone. */
    undo: async (rowId: string): Promise<void> => {
      const before = (await loggedIds(page)).length
      await page.click(`[data-testid="${rowId}"]`)
      await page.until(
        async () => (await loggedIds(page)).length,
        (rows) => rows < before,
      )
    },

    canFinish: async (): Promise<boolean> => await page.exists('finish-session'),
    finish: async (): Promise<void> => {
      await page.waitFor('finish-session')
      await page.click('[data-testid="finish-session"]')
    },
  }
}
