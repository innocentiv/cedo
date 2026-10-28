import type { Page } from '../harness.ts'

/** Where notes are: your own on Progress, or an athlete's on their page. */
type Where = 'progress' | 'athlete'

/**
 * Athlete notes (#41): what is known about someone, kept for planning their training — read,
 * written, reworded and removed on Progress and on an athlete's page alike, newest first.
 */
export const notes = (page: Page) => {
  const card = (where: Where) => `${where}-notes`
  const note = (where: Where, at: number) => `${card(where)}-note-${String(at)}`
  return {
    /** Each note as it reads, newest first: its byline, then its words. */
    read: async (where: Where): Promise<string[]> => {
      await page.waitFor(`${card(where)}-list`)
      const read = await page.evaluate(
        `[...document.querySelectorAll('[data-testid^="${card(where)}-note-"]')].filter((e) => /-note-\\d+$/.test(e.dataset.testid)).map((e) => e.innerText.split('\\n').map((l) => l.trim()).filter((l) => l !== '' && l !== 'Edit' && l !== 'Remove').join(' / '))`,
      )
      return Array.isArray(read) ? read.map(String) : []
    },
    /** Whether the list says nothing is noted. */
    none: async (where: Where): Promise<boolean> =>
      ((await page.text(`${card(where)}-list`)) ?? '').includes('Nothing noted yet'),
    /** Writes one down, typed as a thumb types it, and adds it. */
    add: async (where: Where, text: string): Promise<void> => {
      await page.click(`[data-testid="${card(where)}-new-text"]`)
      await page.type(text)
      await page.click(`[data-testid="${card(where)}-new-add"]`)
      await page.until(
        async () => await page.value(`${card(where)}-new-text`),
        (left) => left === '',
      )
    },
    /** Whether the note `at` offers Edit, and Remove — only to whoever may. */
    offers: async (where: Where, at: number) => ({
      edit: await page.shown(`${note(where, at)}-edit`),
      remove: await page.shown(`${note(where, at)}-remove`),
    }),
    /** Changes the words of the note `at`, and saves them. */
    reword: async (where: Where, at: number, text: string): Promise<void> => {
      await page.click(`[data-testid="${note(where, at)}-edit"]`)
      await page.fill(`${note(where, at)}-reword-text`, text)
      await page.click(`[data-testid="${note(where, at)}-reword-save"]`)
      await page.waitFor(`${note(where, at)}-text`)
    },
    /** Removes the note `at`, asked twice. */
    remove: async (where: Where, at: number): Promise<void> => {
      await page.click(`[data-testid="${note(where, at)}-remove"]`)
      await page.click(`[data-testid="${note(where, at)}-remove-confirm"]`)
    },
  }
}
