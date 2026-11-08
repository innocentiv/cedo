import { describe, expect, test } from 'bun:test'
import { checkVersion, withAppVersion, withVersion } from './release-files.ts'

/** What `bun run release <version>` writes, without a repository: the files as text in and out. */

const INSTANCE = `export const PRODUCT = 'cedo'

/** The version. */
export const VERSION = '0.0.0'
`

const APP = `{
  "expo": {
    "name": "cedo",
    "slug": "cedo",
    "version": "0.0.0",
    "scheme": "cedo",
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "io.github.innocentiv.cedo",
      "infoPlist": {}
    }
  }
}
`

describe('a version to release', () => {
  test('is three numbers, after the one released before', () => {
    expect(checkVersion('0.0.0', '0.1.0')).toBeNull()
    expect(checkVersion('0.9.0', '0.10.0')).toBeNull()
    expect(checkVersion('0.1.0', '1.0.0')).toBeNull()
  })

  test('is refused when it is not three numbers', () => {
    expect(checkVersion('0.0.0', 'v0.1.0')).toMatch(/three numbers/u)
    expect(checkVersion('0.0.0', '0.1')).toMatch(/three numbers/u)
  })

  /** AltStore offers whatever differs; a release's number only ever goes up, so it is clear which is newer. */
  test('is refused when it is not after the one before', () => {
    expect(checkVersion('0.2.0', '0.2.0')).toMatch(/after 0\.2\.0/u)
    expect(checkVersion('0.10.0', '0.9.0')).toMatch(/after 0\.10\.0/u)
  })
})

describe('the files a release writes', () => {
  test('give the contract its version', () => {
    expect(withVersion(INSTANCE, '0.1.0')).toContain(`export const VERSION = '0.1.0'`)
    expect(withVersion(INSTANCE, '0.1.0')).toContain(`export const PRODUCT = 'cedo'`)
  })

  test('give the app its version, and its first build number', () => {
    const written = withAppVersion(APP, '0.1.0')
    expect(() => JSON.parse(written) as unknown).not.toThrow()
    expect(written).toContain('"version": "0.1.0",')
    expect(written).toContain(
      '"bundleIdentifier": "io.github.innocentiv.cedo",\n      "buildNumber": "1",',
    )
  })

  /** iOS wants every build of one app numbered after the last. */
  test('count the build number up from the one before', () => {
    const twice = withAppVersion(withAppVersion(APP, '0.1.0'), '0.1.1')
    expect(twice).toContain('"version": "0.1.1",')
    expect(twice).toContain('"buildNumber": "2",')
    expect(twice).not.toContain('"buildNumber": "1",')
  })

  test('leave the rest of the file as it was written', () => {
    const before = APP.split('\n')
    const after = withAppVersion(APP, '0.1.0').split('\n')
    expect(after.filter((line) => !before.includes(line))).toEqual([
      '    "version": "0.1.0",',
      '      "buildNumber": "1",',
    ])
  })

  test('refuse a file they cannot find their place in', () => {
    expect(() => withVersion('export const OTHER = 1\n', '0.1.0')).toThrow(/VERSION/u)
    expect(() => withAppVersion('{ "expo": {} }\n', '0.1.0')).toThrow(/version/u)
  })
})
