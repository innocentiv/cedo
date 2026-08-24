/**
 * `bun run dev` — the API and the web app together, in one terminal.
 *
 * Two processes rather than one, because they are genuinely two programs: Bun watching the API, and
 * Metro serving the app. Written by hand instead of adding `concurrently` — it is forty lines, and
 * a dependency whose whole job is to spawn twice is not worth carrying in a project that counts
 * them. Run either half alone with `bun run dev:api` / `bun run dev:app`.
 */

interface Task {
  readonly name: string
  readonly colour: string
  readonly command: readonly string[]
  readonly cwd?: string
}

const ESC = ''
const RESET = `${ESC}[0m`
const CYAN = `${ESC}[36m`
const MAGENTA = `${ESC}[35m`

const TASKS: readonly Task[] = [
  { name: 'api', colour: CYAN, command: ['bun', '--watch', 'apps/api/src/index.ts'] },
  {
    name: 'app',
    colour: MAGENTA,
    command: ['./node_modules/.bin/expo', 'start', '--web'],
    cwd: 'apps/app',
  },
]

/** Prefixes every line, so two interleaved streams stay readable. */
async function prefixed(task: Task, stream: ReadableStream<Uint8Array>): Promise<void> {
  const label = `${task.colour}${task.name.padEnd(3)}${RESET} | `
  const decoder = new TextDecoder()
  let carry = ''
  for await (const chunk of stream) {
    carry += decoder.decode(chunk, { stream: true })
    const lines = carry.split('\n')
    carry = lines.pop() ?? ''
    for (const line of lines) console.log(`${label}${line}`)
  }
  if (carry !== '') console.log(`${label}${carry}`)
}

if (!(await Bun.file('.env').exists())) {
  console.error('No .env found. Run `bun run setup` first — see README.md.')
  process.exit(1)
}

const running = TASKS.map((task) => {
  const child = Bun.spawn([...task.command], {
    ...(task.cwd === undefined ? {} : { cwd: task.cwd }),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '1' },
  })
  void prefixed(task, child.stdout)
  void prefixed(task, child.stderr)
  return { task, child }
})

console.log(`\nAPI  http://localhost:${process.env['PORT'] ?? 3000}\nApp  http://localhost:8081\n`)

/**
 * One dying takes the other with it, so a half-running environment is never mistaken for a working
 * one — an API that quietly exited looks exactly like a frontend bug.
 */
const stopAll = (): void => {
  for (const { child } of running) child.kill()
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, stopAll)

const first = await Promise.race(
  running.map(async ({ task, child }) => ({ task, code: await child.exited })),
)
console.error(`\n${first.task.name} exited with ${first.code}. Stopping the rest.`)
stopAll()
process.exit(first.code)
