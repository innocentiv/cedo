import { describe, expect, test } from 'bun:test'
import { RELEASES, caddyRedirect, releaseFile, sourceFor } from './altstore.ts'

/**
 * The AltStore source a release carries, and the redirect every instance serves to it (#79,
 * ADR-0032) — from what the built app's own Info.plist says, as AltStore checks it.
 */

/** A built app's Info.plist, as `plutil -convert json` gives it. */
const INFO = {
  CFBundleIdentifier: 'io.github.innocentiv.cedo',
  CFBundleShortVersionString: '0.1.0',
  CFBundleVersion: '1',
  MinimumOSVersion: '16.4',
  NSLocalNetworkUsageDescription: 'cedo connects to your server when it is on your local network.',
  NSPhotoLibraryUsageDescription: 'cedo uses your photos to attach an image to an exercise.',
  UIRequiredDeviceCapabilities: ['arm64'],
}

const IPA = { size: 31_457_280, sha256: 'ab'.repeat(32) }

describe('a release', () => {
  test('is a release of this repository, by its tag', () => {
    expect(releaseFile('0.1.0', 'source.json')).toBe(`${RELEASES}/v0.1.0/source.json`)
  })
})

describe('the source a release carries', () => {
  const source = sourceFor({ info: INFO, ipa: IPA, version: '0.1.0', date: '2026-11-09' })
  const [app] = source.apps

  /** AltStore refuses an app whose identifier, version or build differ from its source. */
  test('names the app, its version and its build as the app itself does', () => {
    expect(app?.bundleIdentifier).toBe('io.github.innocentiv.cedo')
    expect(app?.versions).toEqual([
      {
        version: '0.1.0',
        buildVersion: '1',
        date: '2026-11-09',
        localizedDescription: 'cedo 0.1.0',
        downloadURL: `${RELEASES}/v0.1.0/cedo-0.1.0.ipa`,
        size: IPA.size,
        sha256: IPA.sha256,
        minOSVersion: '16.4',
      },
    ])
  })

  /** "AltStore will refuse to install any app whose permissions do not match." */
  test('lists every permission the app asks, with what it says, and no entitlement', () => {
    expect(app?.appPermissions).toEqual({
      entitlements: [],
      privacy: {
        NSLocalNetworkUsageDescription: INFO.NSLocalNetworkUsageDescription,
        NSPhotoLibraryUsageDescription: INFO.NSPhotoLibraryUsageDescription,
      },
    })
  })

  test('shows the icon the release carries', () => {
    expect(app?.iconURL).toBe(`${RELEASES}/v0.1.0/icon.png`)
  })

  /** Built from a tag, the app and the tag are one version: else the instance would offer another. */
  test('is refused when the app is not the version being released', () => {
    expect(() => sourceFor({ info: INFO, ipa: IPA, version: '0.2.0', date: '2026-11-09' })).toThrow(
      /0\.1\.0/u,
    )
  })
})

describe('the redirect every instance serves', () => {
  test('sends /altstore/source.json to the source of its own version', () => {
    expect(caddyRedirect('0.1.0')).toBe(
      `redir /altstore/source.json ${RELEASES}/v0.1.0/source.json 302`,
    )
  })

  /** Nothing is released as 0.0.0: an instance built from it offers no app. */
  test('is none before the first release', () => {
    expect(caddyRedirect('0.0.0')).toBe('')
  })
})
