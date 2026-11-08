# 0032 — The iPhone app goes out through AltStore Classic, one build for every instance, with numbered releases

**Status:** Accepted (2026-11-08), #10. The evidence, with its sources, is
`docs/research/2026-11-native-app.md`.

## Context

cedo is a web app installed to a home screen. A native build was one per instance:
`EXPO_PUBLIC_API_URL` is compiled in, which cannot serve an app distributed free to many people,
each running their own instance. And nothing said which version anything was: `VERSION` was
`0.0.0`, and every instance ran whatever `main` was when it last pulled.

The routes onto an iPhone differ in what they ask of the publisher. The App Store asks for the paid
program; a demo instance kept up for every review, with an account on it that never expires
(2.1(a)); account deletion inside the app, since the app can register (5.1.1(v)); a privacy policy;
and a seller whose details Apple publishes. AltStore PAL asks the same through notarization, and
reaches only the EU, Japan and Brazil. AltStore Classic asks nothing of the publisher: each person
signs the app with their own Apple ID and refreshes it through AltServer every seven days — fine for
people who already sideload, not for strangers.

The PWA never differs from its server, which serves it. A native app can.

## Decision

- **iOS only, through AltStore Classic**, for the maintainer and for self-hosters who already
  sideload. The PWA stays everyone else's app. The App Store is a later, separate decision, and
  nothing it alone needs is built for this one. Android is not built; its package name is reserved.
- **The bundle ID is `io.github.innocentiv.cedo`**, and so is Android's package, with `cedo` as the
  URL scheme and the name. It names the public repository, not anyone's domain. Changed, it would
  give every phone a new app, signed out.
- **One build for every instance: the app asks for its server.** A first screen asks for the
  address a person opens in a browser. The app adds `https://` when no scheme is given, and `/api`,
  and asks `GET /instance` (ADR-0029): "can't reach your server" is kept apart from "not a cedo
  server", no redirect to another host is followed, and Register is offered only where `signUp` is
  open. The address is kept with the token, in the keychain, so a token is sent only to the instance
  that issued it. One instance at a time; changing it signs out. The web app is unchanged:
  same-origin `/api`.
- **HTTPS, except to an IP address or a `.local` name** (`NSAllowsLocalNetworking`). No
  `NSAllowsArbitraryLoads`. `http://nas.lan` is refused, pointing at one HTTPS name, which installing
  the PWA already needs.
- **Numbered releases.** Semver tags, cut by `bun run release`, which sets `VERSION`, the app's
  version and its build number in one commit and tags it. `0.x` while AltStore is the only route: a
  minor when the contract changes, a patch otherwise. Self-hosters run the latest tag, no longer
  `main`. The maintainer's instance still deploys every push to `main`, and between tags reports the
  last tag's version.
- **An `.ipa` per tag, built on a macOS runner with no account anywhere.** `expo prebuild` in a
  throwaway checkout, `xcodebuild archive` unsigned, `Payload/cedo.app` zipped: AltStore re-signs
  every app with its user's own certificate. The job writes `source.json` from the built
  `Info.plist`, since AltStore refuses an app whose permissions its source does not list, and
  attaches both to the tag's GitHub release. No Expo account, no `eas.json`.
- **Every instance offers the app that matches it.** `/altstore/source.json` redirects to the
  source on its own version's release, written in when the image is built, from `VERSION`. It is on
  by default, with no switch. Caddy answers `/altstore/*` with a file, a redirect or a 404, never
  `index.html`. The docs explain adding it; the app does not advertise it.
- **A version mismatch is said, never refused.** When `/instance`'s version is not the app's, the
  app names both, and which to update. A `ContractDriftError` says the same.

## Consequences

- An instance offers exactly its own app, and AltStore offers an update whenever the two differ —
  older too, which a rolled-back server wants. Not at once: installing needs AltServer, so a server
  upgraded overnight meets yesterday's app at the gym. The mismatch notice is for that window.
  Refusing would stop people logging through it and protect nothing: the server checks every
  request against the contract, so an old app cannot write what it does not accept. The worst case
  is a response the app cannot parse.
- Between tags the maintainer's instance offers the last tag's app. A change on `main` that an
  installed app cannot read — a field renamed or removed, an enum value added, a field added to one
  of the few strict objects (most drop keys they do not know) — is cut as a tag.
- The image does not know its commit: `.git` is outside its build context. So the source is keyed
  by version, and `.ipa` builds are per tag.
- The redirect keeps the image build off the network: a release still building is a 404 for a few
  minutes, not a failed image. The phone downloads the `.ipa` from GitHub, which sees its address.
- What re-signing takes away: push and Time Sensitive notifications, dropped with the paid
  entitlements, and App Groups, renamed, which rules out `expo-widgets`. A rest's end told with the
  app closed (#39) has to come from the phone itself.
- Each free Apple ID allows three active apps, AltStore one of them, and a refresh every seven
  days. AltStore 2.3.1 added a workaround for banned free-team profiles; if Apple's refusals spread,
  the App Store decision comes back.

## Rejected

- **The App Store first.** A yearly fee, a demo instance kept up for every review, account deletion
  and what it means for a person's groups and shared plans, a privacy policy and a published seller
  — for an app whose first users already sideload.
- **AltStore PAL.** Since 2026-10-01 a free app owes Apple nothing more there, but it still needs
  the paid program and a notarization that checks the same guidelines, for fewer people.
- **A build per instance.** Nobody but the maintainer could make one.
- **One source for every instance**, listing the newest app. It would be ahead of most instances,
  and the match is the point.
- **The `.ipa` inside the image.** The image is built on Linux, by each self-hoster, and cannot
  build it: embedding it only moves the download from the phone to the image build, and costs every
  image its size.
- **An `.ipa` for every push to `main`.** The image would need its commit passed in, prereleases
  pruned, and twenty minutes of macOS per push — to spare the maintainer a tag.
- **Refusing a server of another major version** (Immich's rule), or of any other version. See
  Consequences.
- **`NSAllowsArbitraryLoads`**, which every self-hosted app surveyed sets. It costs nothing without
  App Review, and sends a token across the network in clear text.
- **A Server field on the sign-in form.** Whether to offer Register depends on `/instance`, so the
  server is known before the form is drawn.
