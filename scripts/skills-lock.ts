/**
 * The agent skills a contributor installs, read from `skills-lock.json` (#73).
 *
 * The lock is written by the `skills` CLI (vercel-labs/skills) and committed; the installed skills
 * are not, as `node_modules` is not. Every skill must be pinned to a full commit, so two
 * contributors never run different instructions under the same name: without a `ref`, the CLI
 * installs whatever its source's default branch holds that day.
 *
 * In `skills` 1.7.6 the restore command (`experimental_install`) writes only `.agents/skills`, which
 * Claude Code does not read, so setup runs `add` with the names from the lock instead. Pin the
 * skills or move them to a new commit with the same command:
 * `bunx --bun skills@1.7.6 add <source>#<40-hex sha> -a claude-code codex -y -s <names…>`.
 */

/** The CLI version setup runs: pinned, as the skills are. */
export const SKILLS_CLI = 'skills@1.7.6'

/** Claude Code reads `.claude/skills`; Codex (and Cursor, Copilot, Gemini CLI) `.agents/skills`. */
export const AGENTS = ['claude-code', 'codex'] as const

/** One `add`: every skill of one source at one commit. */
export interface SkillInstall {
  /** `<owner>/<repo>#<commit>`, as the CLI parses a pinned source. */
  readonly from: string
  readonly names: readonly string[]
}

const FULL_COMMIT = /^[0-9a-f]{40}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function installsFromLock(lock: unknown): SkillInstall[] {
  const version = isRecord(lock) ? lock['version'] : undefined
  if (!isRecord(lock) || version !== 1) {
    throw new Error(
      `skills-lock.json version ${String(version)} is not one setup knows (it reads 1)`,
    )
  }
  const skills = isRecord(lock['skills']) ? lock['skills'] : {}

  const pinned: { name: string; from: string }[] = []
  const unpinned: string[] = []
  for (const [name, entry] of Object.entries(skills)) {
    const source = isRecord(entry) ? entry['source'] : undefined
    const ref = isRecord(entry) ? entry['ref'] : undefined
    if (typeof source === 'string' && typeof ref === 'string' && FULL_COMMIT.test(ref)) {
      pinned.push({ name, from: `${source}#${ref}` })
    } else {
      unpinned.push(name)
    }
  }
  if (unpinned.length > 0) {
    throw new Error(
      `skills-lock.json: ${unpinned.join(', ')} not pinned to a full commit. Reinstall from ` +
        '`<source>#<40-hex sha>` (see scripts/skills-lock.ts).',
    )
  }

  const bySource = new Map<string, string[]>()
  for (const { name, from } of pinned) bySource.set(from, [...(bySource.get(from) ?? []), name])
  return [...bySource.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([from, names]) => ({ from, names: names.toSorted() }))
}

/** `-s` takes every argument up to the next flag, so the names go last. */
export function skillsAddCommand(install: SkillInstall): string[] {
  return [
    'bunx',
    '--bun',
    SKILLS_CLI,
    'add',
    install.from,
    '-a',
    ...AGENTS,
    '-y',
    '-s',
    ...install.names,
  ]
}
