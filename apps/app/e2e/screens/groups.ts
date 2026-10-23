import type { GroupRole } from '@cedo/contract'
import type { Page } from '../harness.ts'
import { nav } from './nav.ts'

/** Groups, under Settings: the ones you belong to, and one group's members. */

/** The first line of every shown element whose test id starts with `prefix`, by that id. */
const shownRows = async (page: Page, prefix: string): Promise<Record<string, string[]>> => {
  const rows = await page.evaluate(
    `Object.fromEntries([...document.querySelectorAll('[data-testid^="${prefix}"]')].filter((e) => e.offsetParent != null).map((e) => [e.dataset.testid.slice(${prefix.length}), e.innerText.split('\\n').map((l) => l.trim())]))`,
  )
  return typeof rows === 'object' && rows !== null ? (rows as Record<string, string[]>) : {}
}

export const groups = (page: Page) => {
  /** The groups listed, by name — once the list is shown, never before. */
  const names = async (): Promise<string[]> => {
    await page.until(
      async () => await page.shown('group-list'),
      (open) => open,
    )
    return Object.values(await shownRows(page, 'group-row-')).map((lines) => lines[0] ?? '')
  }

  /** Each member shown, as `username: role`. */
  const members = async (): Promise<string[]> => {
    await page.waitFor('member-list')
    return Object.entries(await shownRows(page, 'member-row-')).map(
      ([username, lines]) => `${username}: ${lines.at(-1) ?? ''}`,
    )
  }

  return {
    /** Opens Groups from the Settings tab — no reload, so every other tab keeps its cache. */
    open: async (): Promise<void> => {
      await nav(page).tab('settings')
      await page.waitFor('settings-screen')
      await page.click('[data-testid="manage-groups"]')
      await page.waitFor('groups-screen')
    },
    names,
    /** Creates a shared group, and waits until it is listed. */
    create: async (name: string): Promise<void> => {
      await page.fill('group-name', name)
      await page.click('[data-testid="create-group"]')
      await page.until(names, (listed) => listed.includes(name))
    },
    /** Opens the group listed as `name`. */
    openGroup: async (name: string): Promise<void> => {
      const rows = await shownRows(page, 'group-row-')
      const id = Object.entries(rows).find(([, lines]) => lines[0] === name)?.[0]
      if (id === undefined) throw new Error(`No group named ${name} is listed`)
      await page.click(`[data-testid="group-row-${id}"]`)
      await page.waitFor('member-list')
    },
    members,
    /** Adds an account by username, and waits until it is listed among the members. */
    addMember: async (username: string, role: GroupRole): Promise<void> => {
      await page.fill('member-username', username)
      await page.click(`[data-testid="member-role-${role}"]`)
      await page.click('[data-testid="add-member"]')
      await page.until(members, (listed) => listed.includes(`${username}: ${role}`))
    },
    /** Tries to add an account, and returns why it was refused. */
    addMemberRefused: async (username: string): Promise<string | null> => {
      await page.fill('member-username', username)
      await page.click('[data-testid="add-member"]')
      await page.waitFor('add-member-error')
      return await page.text('add-member-error')
    },
    /** Removes a member, asked twice, and waits until they are listed no more. */
    remove: async (username: string): Promise<void> => {
      await page.click(`[data-testid="member-remove-${username}"]`)
      await page.click(`[data-testid="member-remove-${username}-confirm"]`)
      await page.until(members, (listed) => !listed.some((m) => m.startsWith(`${username}:`)))
    },
    /** The members who read your training through this group, by username. */
    readers: async (): Promise<string[]> => {
      await page.waitFor('member-list')
      return Object.entries(await shownRows(page, 'member-row-'))
        .filter(([, lines]) => lines.some((l) => l.endsWith('reads your training')))
        .map(([username]) => username)
    },
    /** Whether the group offers to share your training with it at all. */
    canShareTraining: async (): Promise<boolean> => await page.exists('share-training'),
    /** Shares your training with the group's editors, or keeps it private (#11). */
    shareTraining: async (choice: 'shared' | 'private'): Promise<void> => {
      await page.click(`[data-testid="share-training-${choice}"]`)
    },
    /** Whether the group offers to let you leave it. */
    canLeave: async (): Promise<boolean> => await page.exists('group-leave'),
    /** Leaves the group, asked twice, and waits to be back on the list of groups. */
    leave: async (): Promise<void> => {
      await page.click('[data-testid="group-leave"]')
      await page.click('[data-testid="group-leave-confirm"]')
      await page.until(
        async () => await page.shown('group-detail-screen'),
        (open) => !open,
      )
    },
  }
}
