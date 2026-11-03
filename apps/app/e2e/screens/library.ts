import type { EquipmentSlug, MuscleSlug, OwnableScope } from '@cedo/contract'
import type { Page } from '../harness.ts'
import { closed } from './form.ts'
import { chooseOption, rowNames } from './lines.ts'
import { placement } from './placement.ts'

/** The exercise library: its list, an exercise's detail, and the form that creates or edits one. */

type FormScreen = 'exercise-new-screen' | 'exercise-edit-screen'

const exerciseForm = (page: Page, screen: FormScreen) => ({
  name: async (name: string): Promise<void> => {
    await page.fill('exercise-name', name)
  },
  /** Chooses a muscle, its load split evenly with the others chosen (#27). */
  choose: async (muscle: string): Promise<void> => {
    await page.click(`[data-testid="muscle-option-${muscle}"]`)
  },
  /** A chosen muscle's share of the load, as its field holds it. */
  loadOf: async (muscle: string): Promise<unknown> => await page.value(`muscle-load-${muscle}`),
  /** Picks a muscle and gives it a share of the load. */
  load: async (muscle: string, percent: string): Promise<void> => {
    await page.click(`[data-testid="muscle-option-${muscle}"]`)
    await page.fill(`muscle-load-${muscle}`, percent)
  },
  /** Chooses an item the exercise needs, or drops it — or `nothing`, that it needs none (#33). */
  equipment: async (choice: EquipmentSlug | 'nothing'): Promise<void> => {
    await page.click(`[data-testid="equipment-option-${choice}"]`)
  },
  /** What the form says the exercise needs, as chosen so far. */
  equipmentSummary: async (): Promise<string> => (await page.text('equipment-summary')) ?? '',
  /** The running total the form shows under the muscles. */
  total: async (): Promise<string> => (await page.text('muscle-total')) ?? '',
  attachVideo: async (url: string): Promise<void> => {
    await page.fill('media-url', url)
    await page.click('[data-testid="attach-media"]')
    await page.waitForSelector('[data-testid^="media-row-"]')
  },
  /**
   * Uploads a file through Upload image (#13). A WebView cannot drive a native file chooser: given
   * no dialog to show, WebKit answers the picker's click with `cancel` at once, which Expo reads as
   * nothing picked. So the hidden input Expo opens it with (`file-input`, its own test id) is handed
   * `file` as it is added to the page — before that click — as a person picking it would; and its
   * `change` is fired here unless a `cancel` came first. What was patched is put back once the
   * click is done, whether or not an input came. Only once the file is handed over does it read
   * the result, so a refusal left from an earlier upload is not taken for this one's. Returns the
   * media row it lands in, or what the form says it was refused for.
   */
  upload: async (
    file: { readonly name: string; readonly type: string } & (
      | { readonly base64: string }
      /** A file of this many zero bytes, made in the page rather than sent to it. */
      | { readonly size: number }
    ),
  ): Promise<{ readonly row: string } | { readonly refused: string | null }> => {
    const rows = await page.evaluate(
      `document.querySelectorAll('[data-testid^="media-row-"]').length`,
    )
    await page.evaluate(`(() => {
      const append = document.body.appendChild
      window.__restoreAppend = () => { document.body.appendChild = append }
      window.__picked = false
      document.body.appendChild = function (node) {
        if (node.getAttribute?.('data-testid') !== 'file-input') return append.call(this, node)
        window.__restoreAppend()
        const bytes = ${'base64' in file ? `Uint8Array.from(atob(${JSON.stringify(file.base64)}), (c) => c.charCodeAt(0))` : `new Uint8Array(${String(file.size)})`}
        const picked = new DataTransfer()
        picked.items.add(new File([bytes], ${JSON.stringify(file.name)}, { type: ${JSON.stringify(file.type)} }))
        Object.defineProperty(node, 'files', { value: picked.files })
        let canceled = false
        node.addEventListener('cancel', () => { canceled = true })
        setTimeout(() => {
          if (!canceled && node.isConnected) node.dispatchEvent(new Event('change'))
          window.__picked = true
        }, 50)
        return append.call(this, node)
      }
    })()`)
    await page.click('[data-testid="upload-image"]')
    await page.evaluate(`window.__restoreAppend()`)
    const landed = await page.until(
      async () =>
        await page.evaluate(
          `!window.__picked ? null : document.querySelector('[data-testid="upload-error"]') ? 'upload-error' : document.querySelectorAll('[data-testid^="media-row-"]').length > ${String(rows)} ? [...document.querySelectorAll('[data-testid^="media-row-"]')].at(-1).dataset.testid : null`,
        ),
      (seen): seen is string => typeof seen === 'string',
    )
    return landed === 'upload-error'
      ? { refused: await page.text('upload-error') }
      : { row: landed }
  },
  /** What the form says may be uploaded, before anything is picked. */
  uploadLimits: async (): Promise<string | null> => await page.text('upload-limits'),
  /** Saves, and waits for the form to close — see `closed`. */
  save: async (): Promise<void> => {
    await page.click(`[data-testid="${screen}-save"]`)
    await closed(page, screen, `${screen}-error`)
  },
  /** Saves a form the API will refuse, and returns the message it shows instead. */
  saveRefused: async (): Promise<string> => {
    await page.click(`[data-testid="${screen}-save"]`)
    await page.waitFor(`${screen}-error`)
    return (await page.text(`${screen}-error`)) ?? ''
  },
})

/** The exercise detail screen — reached however the journey reached it. */
export const exercise = (page: Page) => ({
  /** Which group it is in, and transferring it to another. */
  placement: placement(page, 'exercise-transfer'),
  /** Its progress, as the trend says it: the latest point in words, and a stall when there is one. */
  trend: async (): Promise<{
    first: string | null
    latest: string | null
    stalled: string | null
  }> => {
    await page.waitFor('exercise-trend')
    return {
      first: await page.text('exercise-trend-first'),
      latest: await page.text('exercise-trend-latest'),
      stalled: await page.text('exercise-trend-stalled'),
    }
  },
  shown: async (): Promise<void> => {
    await page.waitFor('exercise-detail-screen')
  },
  /** What it needs, as its Equipment card reads under its label: "High pulley", "Not described". */
  equipment: async (): Promise<string> => {
    await page.waitFor('exercise-equipment')
    return String(
      await page.evaluate(
        `document.querySelector('[data-testid="exercise-equipment"]').innerText.split('\\n').slice(1).join(' ').trim()`,
      ),
    )
  },
  historyText: async (): Promise<string> => {
    await page.waitFor('exercise-history')
    return (await page.text('exercise-history')) ?? ''
  },
  edit: async () => {
    await page.waitFor('edit-exercise')
    await page.click('[data-testid="edit-exercise"]')
    await page.waitFor('exercise-edit-screen')
    return exerciseForm(page, 'exercise-edit-screen')
  },
  /** Deletes it, asked twice, and waits to be back where it was opened from. */
  delete: async (): Promise<void> => {
    await page.click('[data-testid="exercise-delete"]')
    await page.click('[data-testid="exercise-delete-confirm"]')
    await page.until(
      async () => await page.shown('exercise-detail-screen'),
      (shown) => !shown,
    )
  },
  /**
   * Asks to delete it, and returns what it says beside Delete it was refused for — once it asks
   * again: armed after a refusal, the next tap would send the same delete unasked.
   */
  deleteRefused: async (): Promise<string | null> => {
    await page.click('[data-testid="exercise-delete"]')
    await page.click('[data-testid="exercise-delete-confirm"]')
    await page.waitFor('exercise-delete-error')
    await page.waitFor('exercise-delete')
    return await page.text('exercise-delete-error')
  },
  /** Copies a shared exercise; lands in the editor for the copy. */
  duplicate: async () => {
    await page.waitFor('duplicate-exercise')
    await page.click('[data-testid="duplicate-exercise"]')
    await page.waitFor('exercise-edit-screen')
    return exerciseForm(page, 'exercise-edit-screen')
  },
})

export const library = (page: Page) => {
  const newExercise = async () => {
    await page.goto('/exercises/new')
    await page.waitFor('exercise-new-screen')
    return exerciseForm(page, 'exercise-new-screen')
  }
  const list = async (): Promise<void> => {
    await page.goto('/exercises')
    await page.waitFor('exercise-list')
  }
  const openRow = async () => {
    const row = await page.waitForSelector('[data-testid^="exercise-row-"]')
    await page.click(`[data-testid="${row}"]`)
    const detail = exercise(page)
    await detail.shown()
    return detail
  }
  return {
    newExercise,
    /** One exercise loading one muscle fully, through the form. */
    create: async (name: string, muscle: string): Promise<void> => {
      const form = await newExercise()
      await form.name(name)
      await form.load(muscle, '100')
      await form.save()
    },
    openFirst: async () => {
      await list()
      return await openRow()
    },
    /** Searches the library tab as it stands — no reload — and opens the first match. */
    find: async (name: string) => {
      await page.waitFor('exercises-screen')
      await page.fill('exercise-search', name)
      return await openRow()
    },
    /**
     * Searches the library and chooses the first match, opening it where this layout opens one: a
     * screen of its own on a phone, the pane beside the list on a desktop (#29).
     */
    choose: async (name: string): Promise<void> => {
      await page.goto('/exercises')
      await page.fill('exercise-search', name)
      const row = await page.waitForSelector('[data-testid^="exercise-row-"]')
      await page.click(`[data-testid="${row}"]`)
    },
    /**
     * Opens the library afresh and chooses the last exercise on its first page — far down the list,
     * so reaching it scrolls (#50). Returns its name.
     */
    chooseLast: async (): Promise<string> => {
      await list()
      await page.waitForSelector('[data-testid^="exercise-row-"]')
      const last = await page.evaluate(
        `[...document.querySelectorAll('[data-testid="exercise-list"] [data-testid^="exercise-row-"]')].map((row) => row.dataset.testid).filter((id) => /^exercise-row-[0-9a-f-]{36}$/.test(id)).at(-1) ?? null`,
      )
      if (typeof last !== 'string') throw new Error('The library lists no exercise to choose')
      const name = (await page.text(`${last}-name`)) ?? ''
      await page.click(`[data-testid="${last}"]`)
      return name
    },
    /** Opens the library afresh, searched for `name`. */
    search: async (name: string): Promise<void> => {
      await list()
      await page.fill('exercise-search', name)
    },
    /**
     * What each row named exactly `name` says under it, in list order — `Library · Quads, Glutes`
     * — the list as it stands, so a journey can wait on it.
     */
    captions: async (name: string): Promise<string[]> => {
      // A row's name by its own test id, and the caption the line after it.
      const rows = await page.evaluate(
        `[...document.querySelectorAll('[data-testid="exercise-list"] [data-testid^="exercise-row-"][data-testid$="-name"]')].map((shown) => [shown.innerText.trim(), shown.nextElementSibling?.innerText.trim() ?? ''])`,
      )
      return (Array.isArray(rows) ? rows : [])
        .map((row) => (Array.isArray(row) ? row.map(String) : []))
        .filter(([shown]) => shown === name)
        .map(([, caption]) => caption ?? '')
    },
    /** The rows' names as listed, the list as it stands. */
    names: async (): Promise<string[]> => await rowNames(page, 'exercise-list'),
    /** Asks for the next page (#52). */
    more: async (): Promise<void> => {
      await page.click('[data-testid="exercises-more"]')
    },
    /** Whether it offers another page. */
    moreShown: async (): Promise<boolean> => await page.shown('exercises-more'),
    /** Whether the list is on screen. */
    listShown: async (): Promise<boolean> => await page.shown('exercise-list'),
    /** The library as it stands, without loading it again: the switch below keeps its choice. */
    shownText: async (): Promise<string> => {
      await page.waitFor('exercise-list')
      return (await page.text('exercise-list')) ?? ''
    },
    /** Whether the library asks you to say what you train with (#35) — until you have. */
    prompted: async (): Promise<boolean> => {
      await list()
      await page.waitFor('exercise-list')
      return await page.shown('equipment-prompt')
    },
    /** What the library offers (#35): only what you can do, or everything — chosen in its sheet. */
    showing: async (showing: 'doable' | 'all'): Promise<void> => {
      await list()
      await chooseOption(page, 'exercise-showing', showing)
    },
    /** Narrows the list to a scope, chosen in its sheet (#52). */
    scope: async (scope: OwnableScope): Promise<void> => {
      await page.goto('/exercises')
      await chooseOption(page, 'exercise-scope', scope)
    },
    emptyShown: async (): Promise<void> => {
      await page.waitFor('exercises-empty')
    },
    /** Narrows the list as it stands to one of your groups, chosen in the Show sheet by its id. */
    narrowToGroup: async (groupId: string): Promise<void> => {
      await chooseOption(page, 'exercise-scope', `group-${groupId}`)
    },
    /** Narrows the list as it stands to one muscle, chosen in the Muscles sheet. */
    narrowToMuscle: async (muscle: MuscleSlug): Promise<void> => {
      await chooseOption(page, 'exercise-muscle', muscle)
    },
    /** What a filter says it is set to: "All Groups", "Squad", "Quads". */
    filterValue: async (filter: 'scope' | 'muscle' | 'showing'): Promise<string> =>
      (await page.text(`exercise-${filter}-value`)) ?? '',
    /** Puts every filter back with the ×, which is there only while one narrows the list. */
    clearFilters: async (): Promise<void> => {
      await page.click('[data-testid="exercise-filters-clear"]')
      await page.until(
        async () => await page.shown('exercise-filters-clear'),
        (shown) => !shown,
      )
    },
    /** The filters' row height, in CSS pixels. */
    filtersHeight: async (): Promise<unknown> =>
      await page.evaluate(
        `document.querySelector('[data-testid="exercise-filters"]').getBoundingClientRect().height`,
      ),
  }
}
