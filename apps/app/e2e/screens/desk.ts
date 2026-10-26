import type { Page } from '../harness.ts'

/** What only a desktop shows (#29): the sidebar's head and foot, and the library's pane. */
export const desk = (page: Page) => ({
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
