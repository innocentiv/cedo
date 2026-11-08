/**
 * What a release writes (#79, ADR-0032), as text in and text out, so it is tested without a
 * repository (release.test.ts). `release.ts` reads the files, calls these, and writes them back.
 *
 * Text, not parsed and printed again: `app.json` is laid out by hand, and a release changes two of
 * its lines, not its layout.
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/u

const parts = (version: string): number[] => version.split('.').map(Number)

const DECLARED = /^export const VERSION = '([^']*)'$/mu

/** The version `packages/contract/src/instance.ts` declares, or null when it declares none. */
export const versionIn = (source: string): string | null => DECLARED.exec(source)?.[1] ?? null

/** Why `wanted` cannot follow `current`, or null when it can: three numbers, and after it. */
export function whyNotNext(current: string, wanted: string): string | null {
  if (!SEMVER.test(wanted)) return `${wanted} is not three numbers, as 0.1.0 is.`
  const [a, b] = [parts(current), parts(wanted)]
  for (let i = 0; i < 3; i += 1) {
    const difference = (b[i] ?? 0) - (a[i] ?? 0)
    if (difference > 0) return null
    if (difference < 0) break
  }
  return `${wanted} is not after ${current}, the version released before.`
}

/** `packages/contract/src/instance.ts`, with `VERSION` set. */
export function withVersion(source: string, version: string): string {
  if (versionIn(source) === null) throw new Error('No `export const VERSION = ...` line to set.')
  return source.replace(DECLARED, `export const VERSION = '${version}'`)
}

/**
 * `apps/app/app.json`, with the app's `version` set and its `ios.buildNumber` one more than before —
 * or 1, the first time. iOS wants every build of one app numbered after the last.
 */
export function withAppVersion(json: string, version: string): string {
  const versionLine = /^( {4}"version": )"[^"]*",$/mu
  if (!versionLine.test(json)) throw new Error('No `"version"` line under `expo` to set.')
  const withVersionSet = json.replace(versionLine, `$1"${version}",`)
  const buildLine = /^( {6}"buildNumber": )"(\d+)",$/mu
  const build = buildLine.exec(withVersionSet)
  if (build !== null) {
    return withVersionSet.replace(buildLine, `$1"${Number(build[2]) + 1}",`)
  }
  const bundleLine = /^( {6}"bundleIdentifier": "[^"]*",)$/mu
  if (!bundleLine.test(withVersionSet)) {
    throw new Error('No `"bundleIdentifier"` line under `ios` to put the build number after.')
  }
  return withVersionSet.replace(bundleLine, `$1\n      "buildNumber": "1",`)
}
