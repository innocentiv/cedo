import type { Page } from '../harness.ts'

/**
 * An element's text as it reads, a line at a time and blank lines dropped — `innerText`, never
 * `textContent`, which runs a label into the line under it.
 */
export const linesOf = async (page: Page, testID: string): Promise<string[]> =>
  String(
    await page.evaluate(`document.querySelector('[data-testid="${testID}"]')?.innerText ?? ''`),
  )
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

/** Opens a list filter's sheet and chooses one of its options, which closes it (#52). */
export const chooseOption = async (page: Page, filter: string, option: string): Promise<void> => {
  await page.waitFor(filter)
  await page.click(`[data-testid="${filter}"]`)
  await page.waitFor(`${filter}-sheet`)
  await page.click(`[data-testid="${filter}-${option}"]`)
  await page.until(
    async () => await page.shown(`${filter}-sheet`),
    (shown) => !shown,
  )
}

/** The names of the rows a list holds, in order — the library's, or the picker's (#52). */
export const rowNames = async (page: Page, list: string): Promise<string[]> => {
  const names = await page.evaluate(
    `[...document.querySelectorAll('[data-testid="${list}"] [data-testid$="-name"]')].map((e) => e.innerText.trim())`,
  )
  return Array.isArray(names) ? names.map(String) : []
}
