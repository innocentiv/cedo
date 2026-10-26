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
