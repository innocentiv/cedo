import type { Page } from '../harness.ts'

/**
 * Whether something is in view (#50) — a pane, a heading: its top between the top and the bottom of
 * the window, and its sides within it — not merely in the page: a pane at the top of a page
 * scrolled down to its last day is out of sight. Its foot is not asked: a pane taller than the
 * window scrolls on its own. By where it is drawn, never a click, which scrolls its target into
 * view first.
 */
export const inView = async (page: Page, testID: string): Promise<boolean> =>
  (await page.evaluate(
    `(() => { const r = document.querySelector('[data-testid="${testID}"]')?.getBoundingClientRect(); return r !== undefined && r.height > 0 && r.top >= 0 && r.top < innerHeight && r.left >= 0 && r.right <= innerWidth })()`,
  )) === true

/** Whether an exercise is open in the pane beside the library, on a desktop (#29). */
export const paneOpen = async (page: Page): Promise<boolean> =>
  await page.shown('exercise-detail-pane')

/** What only a desktop shows (#29): the sidebar's head and foot, and the library's pane. */
export const desk = (page: Page) => ({
  /** Whether the library's pane is in view, beside however far down the list is scrolled. */
  paneInView: async (): Promise<boolean> => await inView(page, 'exercise-pane'),
  /** The product's name, at the head of the sidebar. */
  name: async (): Promise<string | null> => await page.text('sidebar-name'),
  /** Who is signed in, at its foot. */
  account: async (): Promise<string> => (await page.text('sidebar-account')) ?? '',
  /** The exercise opened beside the library, as its pane reads once it is open. */
  pane: async (): Promise<string> => {
    await page.waitFor('exercise-detail-pane')
    return (await page.text('exercise-pane')) ?? ''
  },
  /** Loads the page again at its address — a reload, or the link shared — and waits for the list. */
  reload: async (): Promise<void> => {
    await page.goto(String(await page.evaluate('location.pathname + location.search')))
    await page.waitFor('exercise-list')
  },
  /** Opens the exercise in the pane by its own address, `/exercises/:id`, as a phone links it. */
  openByItsAddress: async (): Promise<void> => {
    const open = await page.evaluate(`new URLSearchParams(location.search).get('open')`)
    await page.goto(`/exercises/${String(open)}`)
    await page.waitFor('exercise-list')
  },
})
