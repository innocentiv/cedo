/**
 * `bun run setup` — from a fresh clone to a passing `bun run check`, in one command (#73).
 *
 * Each step says what it needs when it fails. It is safe to re-run: `.env` is never overwritten, no
 * database is wiped (the dev database is started, migrated and seeded, all idempotent), and the
 * agent skills are reinstalled at the commits `skills-lock.json` pins. It changes no configuration
 * outside the repo (no git identity, shell profile or global package) and needs no Node: the
 * skills CLI runs on Bun. Outside the repo it only fills Bun's package cache, a temporary clone of
 * the skills, and Docker's containers and volumes.
 *
 * Every failure ends on one `✗` line saying what failed and what to look at.
 *
 * The same script whoever runs it, a contributor or an agent, so no two setups drift. The
 * `.claude/skills/setup` skill only runs it and helps when a step fails.
 */
import { type SkillInstall, installsFromLock, skillsAddCommand } from './skills-lock.ts'

interface Step {
  readonly title: string
  readonly command: readonly string[]
  /** What to look at when it fails. */
  readonly hint: string
  readonly env?: Readonly<Record<string, string>>
}

const DOCKER_HINT =
  'Is Docker running, and are ports 55432 and 55433 free? See README.md, "If something goes wrong".'
const DATABASE_HINT = 'The output above names it; if it could not connect, is Docker running?'

function fail(what: string, hint: string, code = 1): never {
  console.error(`\n✗ ${what}. ${hint}`)
  process.exit(code)
}

/**
 * Bun loaded `.env` into this process, so a child handed all of it would inherit
 * NODE_ENV=development as if the shell had exported it, and a `bun test` would keep it. Each child
 * loads `.env` itself; it gets everything else.
 */
const { NODE_ENV: _loadedFromDotEnv, ...inherited } = process.env

async function run(step: Step): Promise<void> {
  console.log(`\n▸ ${step.title}`)
  const child = Bun.spawn([...step.command], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...inherited, ...step.env },
  })
  const code = await child.exited
  if (code !== 0) fail(`${step.title} failed (exit ${code})`, step.hint, code)
}

/** Whether a command runs at all, quietly: for prerequisites. */
async function works(command: readonly string[]): Promise<boolean> {
  try {
    return (await Bun.spawn([...command], { stdout: 'ignore', stderr: 'ignore' }).exited) === 0
  } catch {
    return false
  }
}

/** `package.json`'s `engines.bun`: the one place the Bun this repo needs is written. */
async function wantedBun(): Promise<string> {
  const pkg: unknown = await Bun.file('package.json').json()
  const engines = typeof pkg === 'object' && pkg !== null && 'engines' in pkg ? pkg.engines : null
  const bun =
    typeof engines === 'object' && engines !== null && 'bun' in engines ? engines.bun : null
  if (typeof bun !== 'string')
    return fail('package.json has no engines.bun', 'Restore it from git.')
  return bun
}

async function prerequisites(): Promise<void> {
  const wanted = await wantedBun()
  const missing: string[] = []
  if (!Bun.semver.satisfies(Bun.version, wanted)) {
    missing.push(`Bun ${wanted} (this is ${Bun.version}): https://bun.sh`)
  }
  if (!(await works(['git', '--version']))) missing.push('git')
  if (!(await works(['docker', 'compose', 'version']))) {
    missing.push('Docker with compose v2: https://docs.docker.com/get-docker/')
  } else if (!(await works(['docker', 'info']))) {
    missing.push('a running Docker daemon: start Docker, then re-run')
  }
  if (missing.length > 0) {
    fail('Prerequisites missing', `Install or start:\n${missing.map((m) => `  - ${m}`).join('\n')}`)
  }
}

/** Read before any step runs, so a lock edited by hand fails at once rather than mid-setup. */
async function skillInstalls(): Promise<SkillInstall[]> {
  try {
    return installsFromLock(await Bun.file('skills-lock.json').json())
  } catch (error) {
    return fail(
      'skills-lock.json cannot be used',
      String(error instanceof Error ? error.message : error),
    )
  }
}

await prerequisites()
const installs = await skillInstalls()

const steps: Step[] = [
  {
    title: 'Dependencies',
    command: ['bun', 'install'],
    hint: 'Check the network, then re-run.',
  },
  { title: '.env', command: ['bun', 'run', 'env:init'], hint: 'Is .env.example there?' },
  { title: 'Both databases', command: ['bun', 'run', 'db:up'], hint: DOCKER_HINT },
  { title: 'Migrations', command: ['bun', 'run', 'db:migrate'], hint: DATABASE_HINT },
  { title: 'The starter library', command: ['bun', 'run', 'db:seed'], hint: DATABASE_HINT },
  ...installs.map((install) => ({
    title: `Agent skills from ${install.from} (${install.names.length})`,
    command: skillsAddCommand(install),
    hint: 'It clones from GitHub: check the network, then re-run.',
    env: { DO_NOT_TRACK: '1' },
  })),
  {
    title: 'The gate: bun run check',
    command: ['bun', 'run', 'check'],
    hint: 'A fresh setup should pass it. The output above names what failed.',
  },
]

// oxlint-disable-next-line no-await-in-loop -- each step needs the one before it.
for (const step of steps) await run(step)

console.log('\n✓ Set up. `bun run dev` starts the API and the web app; see README.md.')
