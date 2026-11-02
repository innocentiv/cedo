import type { Page } from '../harness.ts'

/** The panes beside a list on a desktop: an entry of a plan's, the library's exercise. */
const PANES = { entry: 'entry-panel', exercise: 'exercise-pane' } as const

/** What only a desktop shows (#29): the sidebar's head and foot, and the library's pane. */
export const desk = (page: Page) => ({
  /**
   * Whether a pane's top is on screen, between the top and the bottom of the window — not merely in
   * the page: a pane at the top of a page scrolled down to its last day is out of sight (#50). By
   * where it is drawn, never a click, which scrolls its target into view first.
   */
  paneInView: async (pane: keyof typeof PANES): Promise<boolean> =>
    (await page.evaluate(
      `(() => { const r = document.querySelector('[data-testid="${PANES[pane]}"]')?.getBoundingClientRect(); return r !== undefined && r.height > 0 && r.top >= 0 && r.top < innerHeight })()`,
    )) === true,
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
