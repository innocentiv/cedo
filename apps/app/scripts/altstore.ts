/**
 * The iPhone app as AltStore Classic installs it (#79, ADR-0032): the source a release carries, and
 * the redirect every instance serves to the source of its own version. Pure, and tested
 * (altstore.test.ts); `altstore-source.ts` and `altstore-caddy.ts` are what call it, in the iOS
 * build and in the web image's.
 *
 * It reads the app's Info.plist, and each extension's it embeds (#39), since AltStore checks the
 * permissions of both. Unsigned, neither carries an entitlement.
 */
import { UNRELEASED } from '@cedo/contract'
import { z } from 'zod'

/** Where a release's files are: this repository's releases, by tag. */
export const RELEASES = 'https://github.com/innocentiv/cedo/releases/download'

export const releaseFile = (version: string, name: string): string =>
  `${RELEASES}/v${version}/${name}`

/** What `sourceFor` reads of the built app's Info.plist, the rest kept for its permissions. */
export const AppInfo = z.looseObject({
  CFBundleIdentifier: z.string(),
  CFBundleShortVersionString: z.string(),
  CFBundleVersion: z.string(),
  MinimumOSVersion: z.string(),
})
export type AppInfo = z.output<typeof AppInfo>

/** An extension the app embeds — the rest's countdown — read for its permissions alone. */
export const ExtensionInfo = z.looseObject({ CFBundleIdentifier: z.string() })
export type ExtensionInfo = z.output<typeof ExtensionInfo>

export interface Ipa {
  readonly size: number
  readonly sha256: string
}

/**
 * An AltStore source listing one app: the one built for `version`. Its identifier, version, build
 * and permissions are read from the app's own Info.plist — the permissions from its extensions'
 * too — since AltStore refuses an app that differs from its source in any of them; it carries no
 * entitlement, being unsigned.
 */
export function sourceFor({
  info,
  extensions = [],
  ipa,
  version,
  date,
}: {
  readonly info: AppInfo
  readonly extensions?: readonly ExtensionInfo[]
  readonly ipa: Ipa
  readonly version: string
  /** The day it is released: `2026-11-09`. */
  readonly date: string
}) {
  if (info.CFBundleShortVersionString !== version) {
    throw new Error(
      `The app is ${info.CFBundleShortVersionString}, not ${version}: run bun run release, which sets both.`,
    )
  }
  const iconURL = releaseFile(version, 'icon.png')
  return {
    name: 'cedo',
    identifier: `${info.CFBundleIdentifier}.source`,
    subtitle: 'The iPhone app of your own cedo server',
    website: 'https://github.com/innocentiv/cedo',
    iconURL,
    apps: [
      {
        ...LISTING,
        bundleIdentifier: info.CFBundleIdentifier,
        iconURL,
        versions: [
          {
            version,
            buildVersion: info.CFBundleVersion,
            date,
            localizedDescription: `cedo ${version}`,
            downloadURL: releaseFile(version, `cedo-${version}.ipa`),
            size: ipa.size,
            sha256: ipa.sha256,
            minOSVersion: info.MinimumOSVersion,
          },
        ],
        appPermissions: { entitlements: [], privacy: privacyOf([info, ...extensions]) },
      },
    ],
    news: [],
  }
}

/** What the source says of the app, whatever its version. */
const LISTING = {
  name: 'cedo',
  developerName: 'cedo',
  subtitle: 'Your workouts, your plans, on your own server.',
  localizedDescription:
    'A self-hosted workout tracker. Log sets as you lift, follow your plans, and let an AI plan and review your training — on a server you run.',
  category: 'lifestyle',
} as const

/**
 * Every permission the app and its extensions ask, with what each says: each key of their
 * Info.plists with `UsageDescription` in its name, as AltStore matches them —
 * `NSLocationTemporaryUsageDescriptionDictionary` too, whose value is not a sentence and is listed
 * as it is written.
 */
function privacyOf(plists: readonly ExtensionInfo[]): Record<string, string> {
  return Object.fromEntries(
    plists
      .flatMap((plist) => Object.entries(plist))
      .filter(([key]) => key.includes('UsageDescription'))
      .map(([key, said]) => [key, typeof said === 'string' ? said : JSON.stringify(said)]),
  )
}

/**
 * The Caddy line an instance's image is built with: `/altstore/source.json` sent to the source of
 * its own version's release, so the app it offers is the one built beside it. None before the
 * first release, since nothing is released as 0.0.0.
 */
export function caddyRedirect(version: string): string {
  if (version === UNRELEASED) return ''
  return `redir /altstore/source.json ${releaseFile(version, 'source.json')} 302`
}
