# A native app — November 2026

> **Decided, 2026-11-08.** Researched on 2026-11-07; the questions for #10 were settled in a design
> session and recorded where decisions live: ADR-0032 for the iPhone app, how it is distributed and
> numbered releases; `GLOSSARY.md` for *Instance*. The answers were mostly the recommendations here,
> with these differences:
> - **The App Store is left for later**, as its own issue. The paid program, the seller, a demo
>   instance, account deletion, a privacy policy and EAS are not part of #10.
> - **The server is recognised by `GET /instance`** (ADR-0029), which already names the product and
>   its version, not by `/health`.
> - **The repository has since gone public.** macOS runners cost nothing, and the `.ipa` is attached
>   to this repository's own releases. The costs and the "public home" below were written while it
>   was private.
> - **Self-hosters run release tags**, and an instance's `/altstore/source.json` redirects to the
>   source published with its own version's release: shape B, with a redirect for a file, since a
>   source's permissions and size are known only once the `.ipa` is built.
> - **Open questions 7, 8 and 14–16** — how loud, other devices, the countdown, the alarm's title,
>   the extension — belong to #39 and stay open there.
>
> What follows is the evidence and the reasoning, kept as history.

Read against `main` at 1875297: Expo SDK 58.0.11, React Native 0.88.0, React 19.3
(`apps/app/package.json`). Pages were read on 2026-11-07 unless a date is given. Where something is
inferred rather than read, it says **inference**.

## In ten lines

1. **No SDK upgrade is needed.** SDK 58 is the latest Expo SDK, released 2026-10-15 for iOS 27
   ([changelog](https://expo.dev/changelog/sdk-58)). Its iOS template still uses CocoaPods, so this
   Mac needs a working `pod`.
2. **Use a development build, not Expo Go.** A local `expo run:ios` is "the only way to install a
   development build on an iPhone without a paid Apple Developer account"
   ([Expo](https://docs.expo.dev/develop/development-builds/introduction/)). Profiles from a free
   personal team expire after 7 days.
3. **Publishing means the $99/year Apple Developer Program, then TestFlight, then the App Store.**
   Review needs a live demo server and an account that does not expire (2.1(a)). It also needs
   **account deletion in the app**, because cedo lets you register there (5.1.1(v)), and the API has
   no route for it today.
4. **EU alternative distribution saves nothing a free app cares about.** Since 1 Oct 2026 the Core
   Technology Fee is gone and a free app owes Apple nothing more
   ([Apple](https://developer.apple.com/support/apps-in-the-eu)). But an app on AltStore PAL still
   needs the paid program, as an individual or an organization: "your paid Apple Developer account"
   ([AltStore](https://faq.altstore.io/developers/distribute-with-altstore-pal); Apple's pages, §1).
   It also needs notarization, which checks 2.1(a) and 5.1.1 too, and it reaches only EU, Japan and
   Brazil users. The free route is AltStore Classic. An instance can serve its own source, but each
   user's free Apple ID keeps it to people who already sideload (§1).
5. **One build for every instance.** The server address is typed at runtime, `/api` is appended,
   and the server is checked with one unauthenticated GET that says it is cedo. That is how Immich,
   Jellyfin, Home Assistant and ntfy do it. `/health` would need to name the product and its version.
6. **Version drift is new with a store app.** The PWA is always the same version as its server. A
   store app is not, and the client's `ContractDriftError` will fire whenever they disagree. A
   compatibility rule is needed (Immich compares major versions).
7. **Push is not needed for the rest timer.** The phone schedules the alert itself, from the
   seconds of rest it already counts: a local notification, or on iOS 26+ an AlarmKit alarm, one
   or the other per rest (§4). A self-hosted server cannot hold the publisher's APNs key. Apps that
   push anyway run a relay: Home Assistant through FCM, ntfy by a content-free poll.
8. **AlarmKit (iOS 26+) sounds through the Silent switch, with no `expo-widgets`.** An alarm at a
   fixed time needs no extension (**inference** from Apple's wording). Its countdown on the Lock
   Screen needs one, which reads the alarm's own attributes and no App Group, so AltStore's renaming
   does not touch it. No entitlement either. There is no first-party Expo module: a local Expo
   module of about 150 lines of Swift. `expo-notifications` (local only, with
   `enableRemoteNotifications: false` since 58.1.0) is the default, and the only channel below
   iOS 26. `expo-widgets` is not taken: its App Group breaks under AltStore.
9. **Keep the PWA by branching on `Platform.OS` in one file per capability.** Load native modules
   lazily, as `token-storage.ts` already does, and keep the scheduling rules in a plain, unit-tested
   module (`src/lib/rest-alert.ts`, a new entry in invariant 7's list). `expo-notifications` throws
   on web, so it must never be reached there.
10. **Reading the code turned up three gaps that only a device can confirm.** `crypto.getRandomValues`
    is not installed on native, so logging a set may throw. The offline queue never pauses, because
    TanStack's `onlineManager` cannot see the network on React Native. Videos play only on web.

---

## Getting started — the steps

What someone could do this week. Steps 1–9, and the optional AltStore build after them, need no
Apple payment. Steps marked **owner** need the owner's accounts or money.

**On the simulator, then on your own iPhone**

1. **Set up the Mac.** See the next section.
2. **Branch from `main`.** For example `feat/native-app`. Never push straight to `main`: a push there
   deploys to the live server.
3. **Identity, in `apps/app/app.json`.**
   - Add `ios.bundleIdentifier` and `android.package`, both reverse-DNS, e.g. `com.<owner>.cedo`.
     **Owner:** choose it once. App Store Connect says of the bundle ID: "You can't change this
     property after you upload a build"
     ([ASC](https://developer.apple.com/help/app-store-connect/reference/app-information/)).
   - Add `icon`: a 1024×1024 PNG rendered from `apps/app/public/icons/icon.svg`. The largest PNG
     today is 512.
   - Add to `ios.infoPlist`:
     - `NSLocalNetworkUsageDescription` (§3).
     - `ITSAppUsesNonExemptEncryption: false`. Without it, App Store Connect asks the export
       questionnaire "every time you upload a new version"
       ([Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption)).
   - Expo documents all of these keys
     ([app config](https://docs.expo.dev/versions/latest/config/app/)). Move to `app.config.ts` only
     once something must be conditional, such as an entitlement only a paid team can sign (§4).
4. **Continuous Native Generation.** Ignore `apps/app/ios/` and `apps/app/android/`, and never
   commit them. They are regenerated by `expo prebuild`, which `expo run:ios` runs when they are
   missing ([CNG](https://docs.expo.dev/workflow/continuous-native-generation/)). Native settings
   live in `app.json` and config plugins.
5. **The development client.** Run `bunx expo install expo-dev-client`. Then pin the version exactly
   (CLAUDE.md: `expo install` writes `~` ranges), and check `bun.lock` still names one React Native.
6. **The server address at runtime.** This replaces `EXPO_PUBLIC_API_URL`; see §3 for the rules.
   - **A new plain module beside the session.** It normalises and checks an address, and keeps the
     address together with the token. It imports neither React nor React Native and is unit-tested
     with a fake fetch, as `session.test.ts` is.
   - **`apps/app/src/api/http.ts`.** On native, `resolveBaseUrl()` reads the stored address instead
     of throwing. On web it stays `/api`. `transport` already takes `baseUrl` as a function, so the
     client does not change.
   - **Login and register screens.** A Server field, on native only.
   - **API.** `/health` names the product and the version (§3). Its schema goes in
     `packages/contract`.
   - **`apps/app/types/env.d.ts` and the docs.** Drop `EXPO_PUBLIC_API_URL` from the type, and from
     `docs/08-frontend.md` and `docs/09-deployment.md`.
7. **Close the native gaps found by reading** (§5, first table).
   - Give `newIdempotencyKey` a native source of random bytes; `expo-crypto` is the Expo route.
   - Wire `onlineManager` and `focusManager` to `expo-network` and `AppState`, as TanStack
     documents.
   - Decide what a video does on native.
8. **Run it on the simulator.**
   - Start the API with `bun run dev:api`, then run `bunx expo run:ios` in `apps/app`. It builds,
     installs, and starts Metro with the `/api` proxy from `metro.config.js`.
   - Enter `http://localhost:8081` as the server.
9. **Run it on your iPhone** (free personal team; §2).
   - Sign in to Xcode with an Apple ID, turn on Developer Mode, then run
     `bunx expo run:ios --device`.
   - Enter `http://<Mac's Wi-Fi IP>:8081` as the server, and allow local network access when iOS
     asks.
   - Smoke test:
     - sign in, and sign in again after killing the app;
     - start a session, log a set, watch the rest, undo;
     - log a set in flight mode, then reconnect;
     - an exercise's image and video;
     - Settings → Connect your AI (`apiRoot()`);
     - safe areas and the keyboard over the logger.
   - The install stops working after 7 days. Run the same command again.

**Optional, still free: through AltStore Classic** (§1, "AltStore Classic, with a source the
instance serves")

Only once step 9 works. It gives the owner a standalone Release build that AltServer refreshes in
the background, instead of a rebuild from Xcode every week.
- Build an ad hoc `.ipa` with `expo prebuild` and `xcodebuild archive`, without signing for
  distribution. §1 has the steps.
- Generate a source from the built app's `Info.plist`, and add it with
  `altstore-classic://source?url=…`.
- It takes one of the three active app slots, and AltStore holds another.
- Leave widgets and the Live Activity out of this build. The rest's end is told by a local
  notification, and on iOS 26+ by an AlarmKit alarm. Neither needs an App Group, and the countdown's
  extension reads only the alarm's own data (§4, "Rest's end on the device only").

**On TestFlight**

10. **Owner: join the Apple Developer Program.** It costs 99 USD a year, "in local currency where
    available" ([Apple](https://developer.apple.com/help/account/membership/program-enrollment/)).
    - **Individual:** "your personal legal name will be listed as the seller".
    - **Organization:** needs a legal entity and a D-U-N-S number.
11. **Owner: create the app record in App Store Connect** with name, bundle ID and SKU. The Account
    Holder must first sign the latest agreement
    ([ASC](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app)).
12. **Build profiles.** Add `apps/app/eas.json` with the default profiles:
    - `development`: `developmentClient: true`, internal distribution;
    - `preview`: internal;
    - `production`.

    `eas login` needs an Expo account (**owner**). EAS generates the distribution certificate and
    provisioning profiles, which "requires you to sign in with an Apple Developer Program
    membership" ([Expo](https://docs.expo.dev/app-signing/managed-credentials/)).
13. **Build.** Run `eas build -p ios --profile production`.
    - **In Expo's cloud:** 15 iOS builds a month on the free plan, in a low-priority queue
      ([pricing](https://expo.dev/pricing)).
    - **With `--local`:** builds on this Mac with fastlane and CocoaPods, still logged in to Expo
      ([Expo](https://docs.expo.dev/build-reference/local-builds/)).
14. **Upload with `eas submit -p ios`.** Internal testers (up to 100 App Store Connect users) can
    install at once. External testers (up to 10,000, or a public link) wait for Beta App Review of
    the first build. Each build lasts 90 days
    ([TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)).
15. **Before external testing or the App Store** (§1):
    - a demo server and an account that does not expire;
    - account deletion in the app;
    - a privacy policy URL (required for iOS apps,
      [ASC](https://developer.apple.com/help/app-store-connect/reference/app-information/));
    - the EU trader declaration.

---

## Setting up this Mac for native development

The machine as checked on 2026-11-07:
- macOS 27.2 on Apple silicon, Xcode 27.2.
- `xcode-select` points at the Command Line Tools.
- No simulator runtime.
- `pod` is a stale gem stub for Ruby 3.0, while the active Ruby is Homebrew's 4.0.9.
- No watchman, no EAS CLI, no Android SDK.
- Node 24.13.1, Bun 1.4.4, fnm, and Homebrew's `openjdk` 27.

SDK 58 asks for Xcode 26.4+, iOS 16.4+ and Node 24.3+ on the 24 line
([Expo](https://docs.expo.dev/versions/latest/)), so Xcode, Node and Bun are already new enough.

**What each step is needed for:**
- **(a)** the iOS simulator;
- **(b)** a physical iPhone on a free personal team;
- **(c)** Expo cloud builds only;
- **(d)** Android.

**Flags:** ⚠ sudo · 🍎 Apple ID sign-in · ⬇ large download. These steps are the owner's to run by
hand.

| # | Step | a | b | c | d | |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Finish installing Xcode.** Open it once, or run `sudo xcodebuild -license accept` and `sudo xcodebuild -runFirstLaunch`, which installs "any required system components" ([Apple](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components)). | ✓ | ✓ | – | – | ⚠ |
| 2 | **Point the command-line tools at Xcode.** `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. Expo's guide does the same thing through Xcode → Settings → Locations → Command Line Tools ([Expo](https://docs.expo.dev/workflow/ios-simulator/)). `man xcode-select`: `--switch` "must be run with superuser permissions… for the current shell session, use the DEVELOPER_DIR environment variable instead", which needs no sudo. Today `simctl` and `xcodebuild` fail without one of the two. | ✓ | ✓ | – | – | ⚠ |
| 3 | **An iOS simulator runtime.** Xcode → Settings → Components → iOS → Get, or `xcodebuild -downloadPlatform iOS` ([Apple](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components)). | ✓ | – | – | – | ⬇ |
| 4 | **CocoaPods, fixed.** SDK 58's iOS template still has a `Podfile`, with React Native and Expo modules precompiled ([template](https://github.com/expo/expo/blob/c3a8c9e0443b9cfe1e045294b1971ebd3b37ddbb/templates/expo-template-bare-minimum/ios/Podfile)). React Native 0.88 keeps Swift Package Manager "experimental and opt-in", and plans it as the default from 0.89 ([RN 0.88](https://reactnative.dev/blog/2026/10/19/react-native-0.88)). The fix: take `/opt/homebrew/lib/ruby/gems/3.0.0/bin` off `PATH` in the shell profile, run `brew install cocoapods` (Homebrew has 1.17.0, bottled, built on Homebrew's `ruby`), and check that `which pod` and `pod --version` agree. Left broken, Expo CLI tries `gem install cocoapods`, then `brew install cocoapods`, then aborts (`@expo/cli` `utils/cocoapods.ts`, sdk-58). CocoaPods' own guide installs with `gem` and advises against the system Ruby ([guide](https://guides.cocoapods.org/using/getting-started.html)). Whether CocoaPods 1.17 runs on Ruby 4.0 is **not verified**: run `pod --version`. | ✓ | ✓ | – | – | |
| 5 | **Watchman: skip it.** "Installing Watchman is only required for projects on SDK 55 and earlier" ([Expo](https://docs.expo.dev/get-started/set-up-your-environment/)). React Native's own guide still calls it "highly recommended". | – | – | – | – | |
| 6 | **Node on `PATH` for the build.** The template's `ios/.xcode.env` sets `NODE_BINARY=$(command -v node)` ([template](https://github.com/expo/expo/blob/c3a8c9e0443b9cfe1e045294b1971ebd3b37ddbb/templates/expo-template-bare-minimum/ios/.xcode.env)), and the Podfile shells out to `node`. With fnm, build from a terminal where fnm is active (`bunx expo run:ios`). A build started from Xcode's own window may not find Node (**inference**). | ✓ | ✓ | – | – | |
| 7 | **An Apple ID in Xcode.** Xcode → Settings → Accounts → + makes a Personal Team. Xcode signs with a "personal Apple Account" ([Apple](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)). | – | ✓ | – | – | 🍎 |
| 8 | **The iPhone.** Connect it by cable and trust the Mac. Turn on Settings → Privacy & Security → Developer Mode, restart and confirm; the switch "only appears in Settings if you initiate pairing" ([Apple](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)). After the first install, trust the developer under Settings → General → VPN & Device Management. That path comes from Expo's `expo.fyi/setup-xcode-signing`; Apple documents it only for enterprise apps ([Apple](https://support.apple.com/en-us/118254)). | – | ✓ | – | – | |
| 9 | **An Expo account and the EAS CLI.** `bunx eas-cli@latest login`. Local builds (`eas build --local`) need it too, with `brew install fastlane` for iOS ([Expo](https://docs.expo.dev/build-reference/local-builds/)). | – | – | ✓ | ✓ | 🍎 (Apple Developer Program for credentials) |
| 10 | **Android.** Android Studio, with SDK Platform 36 and an emulator image. JDK 17: `brew install --cask zulu@17` and `JAVA_HOME`, as Expo's guide says. Then `ANDROID_HOME=$HOME/Library/Android/sdk`, with `emulator/` and `platform-tools/` on `PATH` ([Expo](https://docs.expo.dev/get-started/set-up-your-environment/)). Homebrew's `openjdk` here is 27; React Native recommends 17 and warns of "problems using higher JDK versions" ([RN](https://reactnative.dev/docs/set-up-your-environment)). | – | – | – | ✓ | ⬇ |

### Reaching the API and Postgres from the simulator and from a phone

The app never talks to Postgres. `bun run db:reset` and `db:up` stay as they are, and Postgres stays
published on the host's loopback only (`docker-compose.yml`). What the app needs is the API. The
API listens on `0.0.0.0:3000` (`apps/api/src/index.ts`), and Metro proxies `/api/*` to it
(`apps/app/metro.config.js`, `CEDO_DEV_API_ORIGIN`). So a native development build keeps the
same-origin shape the web app has, if the server it is given is Metro.

| Running | Simulator | iPhone on the same Wi-Fi |
| --- | --- | --- |
| `bun run dev:api` + `bunx expo run:ios` (Metro on :8081) | `http://localhost:8081` (**inference**: the simulator shares the Mac's network; no Apple or Expo page found that says so) | `http://<Mac's IP>:8081`. Expo: "By default, the project is served over a LAN connection" ([Expo CLI](https://docs.expo.dev/more/expo-cli/)). |
| The production shape, `docker compose up` (Caddy on `WEB_BIND:WEB_PORT`, by default `0.0.0.0:8080`) | `http://localhost:8080` | `http://<Mac's IP>:8080`. This is exactly what a self-hoster types. |
| The owner's live instance | its `https://` address | same. It holds real data, so use a test account. |

- **Plain HTTP to an IP address works.** The SDK 58 template sets `NSAllowsLocalNetworking` to
  true ([template Info.plist](https://github.com/expo/expo/blob/c3a8c9e0443b9cfe1e045294b1971ebd3b37ddbb/templates/expo-template-bare-minimum/ios/HelloWorld/Info.plist)).
  Apple says this key enables "unqualified domains, .local domains, and IP addresses", which iOS 17
  otherwise refuses
  ([Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking)).
  That it also allows cleartext is **inference**.
- **The phone will ask for local network access.** If it is denied, the connection is blocked
  ([TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)).
- **If the phone cannot reach the Mac at all,** check the macOS firewall for incoming connections
  (**inference**; not researched).

---

## 1. Publishing: the App Store, the EU, and the steps before them

### The paths, side by side

| Path | Cost | Who can install | Limits | Review |
| --- | --- | --- | --- | --- |
| **Free personal team** (Xcode, `expo run:ios --device`) | 0 | Your own devices | "up to 10 App IDs, which expire after 7 days… up to 3 devices… up to 3 apps per device. Provisioning profiles… expire 7 days from issuance" ([Apple](https://developer.apple.com/help/account/basics/about-your-developer-account)). No Push Notifications or Time Sensitive Notifications; App Groups and Background Modes are allowed ([capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios)). | None |
| **AltStore Classic** | 0 | Anyone, worldwide, who installs AltStore through AltServer and signs with their own Apple ID | "Apps expire after 7 days", "3 app install limit" ([AltStore](https://faq.altstore.io/altstore-pal-v.-altstore-classic)), and AltStore itself is one of the three. 10 App IDs a week: one per app and one per extension. Refreshed through AltServer on a computer. The installed bundle ID gets the user's team ID appended (below). | None. For the owner and technical self-hosters, not for strangers (below). |
| **Ad hoc** (`eas device:create`, internal distribution) | Program, 99 USD/yr | Registered devices | "up to 100… devices, per product family, per membership year", reset only at renewal ([Apple](https://developer.apple.com/help/account/devices/devices-overview)) | None |
| **TestFlight** | Program | 100 internal (App Store Connect users), 10,000 external, public links | A build lasts 90 days ([Apple](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)) | External only: "A review is required only for the first build". Up to six builds a day for review. |
| **App Store** | Program | Everyone | — | App Review |
| **EU / Japan / Brazil marketplace** (AltStore PAL) | Program, as an individual or an organization: "your paid Apple Developer account" ([AltStore](https://faq.altstore.io/developers/distribute-with-altstore-pal)); Apple's own pages below. AltStore takes 0%; Apple's 5% Core Technology Commission applies only to digital sales ([AltStore fees](https://faq.altstore.io/developers/fees)) | Users whose Apple Account is in, *and* who are physically in, the EU (likewise Japan and Brazil) ([Apple](https://support.apple.com/en-us/118110)) | You host the Alternative Distribution Package and a source JSON yourself ([AltStore](https://faq.altstore.io/developers/distribute-with-altstore-pal)) | Notarization, a baseline review |

### App Review, read against cedo

The guidelines were last updated 2026-10-16
([guidelines](https://developer.apple.com/app-store/review/guidelines/)). Those tagged `[ASR & NR]`
also apply to notarization, so they bind the EU route too. 2.1(a), 2.5.4, 5.1.1 and 5.1.3 carry the
tag; 4.2 does not.

| Guideline | Says | For cedo |
| --- | --- | --- |
| 2.1(a) | "include demo account info (and turn on your back-end service!) if your app includes a login". App Store Connect: the demo account "must not expire" ([ASC](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)). | **Owner.** A reviewer needs a server address and an account. No guideline speaks of a server the user provides (the agent searched for "server", "self-host" and "own server"). So a demo instance it is, kept up for every review. Options: a separate demo instance, or a demo account on the live one. |
| 5.1.1(v) | "If your app supports account creation, you must also offer account deletion within the app." Temporary deactivation is not enough; a manual process is acceptable ([Apple](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)). | `app/(auth)/register.tsx` creates accounts, and the API has no route to delete one. Either build deletion, which needs a domain decision about what happens to a person's groups and shared plans, or leave registration out of the native app (**inference** that this exempts it). |
| 4.2 | "elevate it beyond a repackaged website"; not "web clippings". | cedo renders native views, not a WebView. Native notifications and a Live Activity make the case stronger (**inference**). |
| 2.5.4 | "may only use background services for their intended purposes: VoIP, audio playback, location, task completion, local notifications, etc." | No background audio to keep the app alive (§4). |
| 5.1.3 | Fitness data may not be used for advertising, and may not be stored in iCloud. | Neither is done. |
| App information | A privacy policy URL is "Required for iOS and macOS apps". | **Owner.** It has to be written. |

**EU trader status.** An App Store listing in the EU needs a declared trader status. A trader who
enrolled as an individual has their "Address or P.O. Box, Phone number, Email address" published.
Apple's guidance adds that a hobbyist "with no intention of commercializing" may not be a trader
([ASC](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements)).
**Owner** decision.

### The EU terms as they stand now

- **Unified terms since 1 Oct 2026.** "The Core Technology Fee… has been replaced by the Core
  Technology Commission, a simple 5% commission on digital transactions in apps distributed outside
  the App Store." The Alternative Terms Addendum "ha[s] been phased out. As of October 1, 2026,
  these terms have been superseded by Attachment 14 of the Apple Developer Program License
  Agreement" ([Apple](https://developer.apple.com/support/apps-in-the-eu)).
- **The date slipped.** In June 2025 Apple planned the move "By January 1, 2026"
  ([news](https://developer.apple.com/news/?id=awedznci)). It took effect on 1 Oct 2026
  ([news, 2026-08-18](https://developer.apple.com/news/?id=gmws0jgp)).
- **A free app with no digital sales pays nothing beyond the membership.** The CTC "applies to any
  sales of digital goods or services" (Attachment 14 §4), and no per-install fee remains. That is
  an inference from the terms, and AltStore says it outright: "Now, a free app owes Apple nothing"
  ([AltStore](https://blog.altstore.io/2026/10/19/big-changes-to-alternative-distribution.html)).
  The app must still declare `MKSellsDigitalGoods` = NO
  ([Apple](https://developer.apple.com/documentation/marketplacekit/distributing-your-app-on-an-alternative-marketplace)).
- **Listing on someone else's marketplace needs the paid program.** No Apple page says so in one
  sentence. It follows from four of them:
  - A marketplace may "securely receive notarized apps from other Apple Developer Program members"
    ([Apple](https://developer.apple.com/support/apps-in-the-eu)).
  - MarketplaceKit: "To distribute your app from an alternative app marketplace, review and sign the
    necessary agreements", and "App Store Connect provides your app in the form of an alternative
    distribution package"
    ([Apple](https://developer.apple.com/documentation/marketplacekit/distributing-your-app-on-an-alternative-marketplace)).
    Attachment 14 of the Program License Agreement defines a Licensed Application as one "selected
    and digitally signed by Apple for distribution, including via an Alternative App Marketplace
    (EU)".
  - App Store Connect comes with membership: "To build more advanced app capabilities and distribute
    apps, you'll need to be an Apple Developer Program member or Apple Developer Enterprise Program
    member". Once enrolled, "you'll be able to access additional resources, like Certificates,
    Identifiers & Profiles and App Store Connect"
    ([Apple](https://developer.apple.com/help/account/basics/about-your-developer-account)). A free
    Apple Account accepts only the Apple Developer Agreement, not the Program License Agreement.
  - That agreement's §8: "You agree to pay Apple the annual Program fee set forth on the Program
    website, unless You have received a valid fee waiver from Apple"
    ([DPLA](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)).
    A waiver applicant must "Not be an individual, sole proprietor, or single-person business"
    ([Apple](https://developer.apple.com/help/account/membership/fee-waivers)).

  AltStore says it outright: "You will still submit apps through App Store Connect using your paid
  Apple Developer account, so make sure you are set up with one before proceeding"
  ([AltStore](https://faq.altstore.io/developers/distribute-with-altstore-pal)).
- **An individual membership is enough.** "You must be enrolled in the Apple Developer Program as an
  organization" sits in Attachment 14 §2.1(A), which covers running a marketplace or Web
  Distribution. §2.2, on apps distributed through a marketplace, has no such line. Adding a
  marketplace in App Store Connect asks only for the "Account Holder or Admin" role, and no install
  count
  ([ASC](https://developer.apple.com/help/app-store-connect/managing-alternative-distribution/manage-distribution-on-an-alternative-app-marketplace/)).
- **Running a marketplace, or Web Distribution,** needs an organization plus one of seven financial
  criteria (Attachment 14 §2.1(A)).
- **Notarization** is "a baseline review… focused on platform policies for security and privacy"
  ([Apple](https://developer.apple.com/support/apps-in-the-eu)). The same app can be on the App
  Store and on a marketplace at once.
- **Reach.**
  - Users need an EU Apple Account *and* must be in the EU. Apple Support gives a 90-day grace
    period when travelling ([Apple](https://support.apple.com/en-us/118110)); the developer page
    says that arrives "with iOS and iPadOS 27.2", which was not confirmed as shipped.
  - Japan has a similar marketplace regime since iOS 26.2, and Brazil since iOS 26.5.
  - AltStore PAL serves all three regions and says it is "free-to-distribute".
  - **Not verified on altstore.io:** that PAL is free to users. Only the founder's own blog says
    Epic covers it.

**Recommendation.** Go free personal team → AltStore Classic, optionally (next section) → paid
program → TestFlight (internal testers first) → App Store.
- The EU route does not avoid the paid program, the demo account or account deletion: notarization
  checks 2.1(a) and 5.1.1. It also reaches fewer people.
- Revisit it only if App Review refuses the app for reasons notarization would not.
- Enrolling as an individual or an organization, and declaring trader status or not, are the
  owner's calls: they decide what is published about the owner.

### AltStore Classic, with a source the instance serves

The idea: each instance serves an AltStore source beside its web app, so its users can install a
cedo iPhone app with no Apple payment. Read against AltStore's docs; AltStore's `classic` branch at
[bbc10d6](https://github.com/altstoreio/AltStore/tree/bbc10d6964185b75a46c6ddd7476ac08df095308)
(2026-10-20) and the AltSign commit it pins,
[e639bdf](https://github.com/rileytestut/AltSign/tree/e639bdfbea185d5c229b11f62e25c5d78649d5c4);
SideStore's docs and `develop` at
[4f3d18d](https://github.com/SideStore/SideStore/tree/4f3d18d98c5fbee72c80f787ceb2e8e09ded60a6); and
`expo-widgets` on Expo's `sdk-58` branch at
[d26d33f](https://github.com/expo/expo/tree/d26d33f25da24a3bc033a297674b7d3d5e9b065c/packages/expo-widgets).
Source files named below without a link are in those trees.

#### Status, and what it asks of the user

- **Maintained.** AltStore Classic 2.3.1 shipped on 2026-10-21
  ([release notes](https://faq.altstore.io/release-notes/altstore)). It is "Available Worldwide",
  the EU included ([AltStore](https://faq.altstore.io/altstore-pal-v.-altstore-classic)). Version
  2.3 raised AltStore's own minimum to iOS 17.4.
- **SideStore**, the community fork, is maintained too: 0.6.4 on 2026-09-09
  ([releases](https://github.com/SideStore/SideStore/releases)). It "is fully compatible with
  AltStore Sources" ([SideStore](https://docs.sidestore.io/docs/advanced/app-sources)).

| It asks for | AltStore Classic | Source |
| --- | --- | --- |
| A computer | AltServer, on macOS 11+ or Windows, installs AltStore. It then installs and refreshes apps "as long as AltStore is on the same WiFi network as a computer running AltServer — or is plugged-in directly to the computer via USB". | [AltServer](https://faq.altstore.io/altstore-classic/altserver), [install](https://faq.altstore.io/altstore-classic/how-to-install-altstore-macos) |
| Or no computer, since 2.3 | "Remote AltServer": LocalDevVPN connected, and on Wi-Fi, "(not cellular)". Who runs those servers, and what passes through them, was not researched. | [Remote AltServers](https://faq.altstore.io/altstore-classic/remote-altservers) |
| A refresh every 7 days | "Apps installed with AltStore expire after 7 days". AltStore refreshes them in the background whenever it can reach AltServer. | [Getting Started](https://faq.altstore.io/altstore-classic/your-altstore) |
| Developer Mode | "To use AltStore on iOS 16 or later, you need to enable Developer Mode" | [install](https://faq.altstore.io/altstore-classic/how-to-install-altstore-macos) |
| The Apple ID password | Typed into AltServer, which says it is "sent **only** to Apple" | same |
| Three active apps | "only 3 sideloaded apps can be active at a time". **AltStore is one of them.** Classic counts every active app, and never offers itself for deactivation ([`AppManager.swift`](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStore/Managing%20Apps/AppManager.swift#L386-L427)); only notarized builds leave AltStore out. SideStore says it plainly: "3 apps (including itself)". | [Activating Apps](https://faq.altstore.io/altstore-classic/activating-apps), [SideStore FAQ](https://docs.sidestore.io/docs/faq) |
| Ten App IDs a week | "You can only register up to 10 App IDs at a time, but each App ID expires after one week". An app needs one App ID, plus one per app extension. Since iOS 13.5 extensions count against the 10 but not against the 3 active apps (`AltStoreCore/Extensions/UserDefaults+AltStore.swift`, L95). | [App IDs](https://faq.altstore.io/altstore-classic/app-ids) |

- **One free slot.** With AltStore and cedo active, one slot is left. The owner already sideloads
  other apps, so cedo takes a slot from one of them.
- **AltStore holds two App IDs of its own.** It embeds a widget extension, `AltWidgetExtension`
  (**inference** from its Xcode project).
- **AltStore can strip extensions.** On install, it offers to remove an app's extensions "so they
  don't count towards your limit" (`AltStore/My Apps/MyAppsViewController.swift`).
- **A risk from Apple's side.** AltStore 2.3.1 added an experimental "Randomize Bundle IDs" option.
  It is "a potential fix for 'Failed to verify code signature (the provisioning profile is banned)'
  errors", meant "to possibly prevent your Apple ID account from getting flagged". **Inference:**
  Apple is acting against free-team sideloading, and may do more.

#### The source

A source is "a self-hosted JSON file containing basic metadata about your apps"
([Make a Source](https://faq.altstore.io/developers/make-a-source)).

**What a cedo source fills in.**

| Level | Keys | Notes |
| --- | --- | --- |
| Source | `name`, `apps`; optional `subtitle`, `iconURL`, `website`, `tintColor`, `news` | `iconURL` defaults to the first app's |
| App | `name`, `bundleIdentifier`, `developerName`, `localizedDescription`, `iconURL`, `versions`, `appPermissions`; optional `subtitle`, `category`, `screenshots` | `marketplaceID` is "Not required for non-notarized apps distributed with AltStore Classic". SideStore refuses a source that has one, taking it for a notarized source ([SideStore](https://docs.sidestore.io/docs/advanced/app-sources)). |
| Version | `version`, `buildVersion`, `date`, `downloadURL`, `size`; optional `localizedDescription`, `minOSVersion`, `maxOSVersion` | `version` and `buildVersion` are `CFBundleShortVersionString` and `CFBundleVersion` |
| Permissions | `entitlements`, `privacy` | Every entitlement, and every `…UsageDescription` key with its text |

**What AltStore checks before it installs**
([`VerifyAppOperation.swift`](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStore/Operations/VerifyAppOperation.swift)):
- the source's `bundleIdentifier` equals the `.ipa`'s;
- `version` and `buildVersion` equal its `Info.plist`;
- every entitlement and every `…UsageDescription` key in the app and its extensions is listed in
  `appPermissions`. The docs: "AltStore will refuse to install any app whose permissions do not
  match";
- an optional `sha256` of the `.ipa`. It is in the code, not in the docs.

So the source must be generated from the built app, never written by hand. For cedo today the
`privacy` list holds at least `NSPhotoLibraryUsageDescription` (`expo-image-picker`) and
`NSFaceIDUsageDescription`. `expo-secure-store`'s plugin adds the latter by default
(`plugin/build/withSecureStore.js`, 58.0.2): `@expo/config-plugins` deletes such a key only when
its option is `false`.

**How updates are announced.**
- Put the new version first in `versions`. AltStore compares the first entry the device supports
  "with the user's installed version… If this version is different than what the user has
  installed, AltStore will notify them that an update is available". It "**does not** use dates"
  ([Updating Apps](https://faq.altstore.io/developers/updating-apps)).
- "Different", not "newer". A source that lists only an older build offers it as an update too.
  That is what a rolled-back server would want.
- "Once uploaded, the update is immediately made live."

**Where the `.ipa` may be.**
- **Absolute URLs only.** `downloadURL` is decoded as a URL with no base
  ([`AppVersion.swift`](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStoreCore/Model/AppVersion.swift#L108)),
  then downloaded as it is
  ([`DownloadAppOperation.swift`](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStore/Operations/DownloadAppOperation.swift#L280-L291)).
  So a path relative to the source cannot work (**inference** from the code).
- **Another host is fine.** Nothing in the code restricts the host. AltStore's docs show PAL's
  files hosted on GitHub Releases.
- **The type does not matter.** The download checks only for 403 and 404, not the content type.

**HTTPS.**
- AltStore Classic's `Info.plist` sets no App Transport Security exception
  ([Info.plist](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStore/Info.plist)).
  Under ATS "The only action your app must take is to use secure URLs, like those beginning with
  `https`. Otherwise, ATS denies the connection"
  ([Apple](https://developer.apple.com/documentation/security/preventing-insecure-network-connections)).
- So the source and the `.ipa` need HTTPS with a certificate the phone trusts (**inference**; not
  tried with plain HTTP).
- SideStore sets `NSAllowsArbitraryLoads`
  ([Info.plist](https://github.com/SideStore/SideStore/blob/4f3d18d98c5fbee72c80f787ceb2e8e09ded60a6/AltStore/Info.plist#L89-L93)),
  so plain HTTP would work there.
- AltStore fetches sources with its cache off, and sends an `ALT_CLASSIC_VER` header
  ([`FetchSourceOperation.swift`](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStore/Operations/FetchSourceOperation.swift#L51-L59)).

**Adding it in one tap.**
- **`altstore-classic://source?url=<source URL>`** adds a source.
  **`altstore-classic://install?url=<.ipa URL>`** installs without one
  ([`SceneDelegate.swift`](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStore/SceneDelegate.swift#L136-L150)).
  The scheme arrived in AltStore 2.2. Both PAL and Classic also register plain `altstore://`, so on
  a phone with both installed that one is ambiguous.
- **SideStore** uses `sidestore://source?url=…`
  ([URL Schema](https://docs.sidestore.io/docs/advanced/url-schema)).
- **AltStore's web links.** `https://altstore.io/source/<host/path>.json` also opens a source
  ([badge](https://faq.altstore.io/developers/download-on-altstore-badge)). It sends the instance's
  address through altstore.io. The custom scheme involves no third party.
- **From cedo's PWA.** The web build can show an "Add to AltStore" link on iOS, with the source URL
  encoded into the query. Whether an installed PWA hands a custom-scheme link to iOS is **not
  verified**: try it on the phone.

#### Building the `.ipa` without the program

**What AltStore accepts.**
- It re-signs every app with the user's own certificate and a fresh profile
  ([`ALTSigner.mm`](https://github.com/rileytestut/AltSign/blob/e639bdfbea185d5c229b11f62e25c5d78649d5c4/AltSign/Signing/ALTSigner.mm#L353-L393)).
- The entitlements it signs with are the profile's, kept only where the downloaded app already has
  them.
- It reads the app's entitlements from the app's existing code signature
  ([`ALTApplication.mm`](https://github.com/rileytestut/AltSign/blob/e639bdfbea185d5c229b11f62e25c5d78649d5c4/AltSign/Model/ALTApplication.mm#L182-L193),
  `ldid::Entitlements`).

| Signing state of the `.ipa` | Result |
| --- | --- |
| **Unsigned** | Should install: Classic "Installs any .ipa file" (not tried). But there are no entitlements to read, so the app gets no App Group (**inference** from the code). Enough for cedo as it is today, which needs no entitlement (below). |
| **Ad hoc, with entitlements** | What an app with a widget or a Live Activity needs. No certificate is involved. `man codesign`: "If identity is the single letter "-" (dash), ad-hoc signing is performed". `--entitlements` will "embed its contents in the signature as entitlement data". |
| **Signed by a free personal team** | Works too. It needs an Apple ID on the build machine, and adds nothing. |

**The route.** Not built yet; check each step on the first build.
1. **Generate the native project.** In `apps/app`, run `bunx expo prebuild --platform ios --clean`.
   Prebuild "creates the **android** and **ios** directories". It also "Modifies the dependencies
   field in the package.json" ([Expo](https://docs.expo.dev/workflow/prebuild/)), so in CI run it in
   a throwaway checkout.
2. **Archive, unsigned.**

   ```
   xcodebuild archive -workspace ios/cedo.xcworkspace -scheme cedo \
     -configuration Release -destination 'generic/platform=iOS' \
     -archivePath build/cedo.xcarchive CODE_SIGNING_ALLOWED=NO
   ```

   - `archive`, `-archivePath`, `generic/platform=iOS` and `buildsetting=value` are all in `man
     xcodebuild` (Xcode 27.2).
   - `CODE_SIGNING_ALLOWED` is **not** in Apple's
     [build settings reference](https://developer.apple.com/documentation/xcode/build-settings-reference).
     It is the setting commonly used for this.
   - The workspace and scheme names follow `app.json`'s `name` (**inference**).
3. **Sign ad hoc, extensions first.** Each target gets its own entitlements file:
   `codesign --force --sign - --entitlements <file>`, on each `.appex`, then on `cedo.app`.
4. **Zip `Payload/cedo.app` as `cedo.ipa`.** AltSign unzips and looks for `Payload`
   ([`NSFileManager+Zip.m`](https://github.com/rileytestut/AltSign/blob/e639bdfbea185d5c229b11f62e25c5d78649d5c4/AltSign/Categories/NSFileManager+Zip.m#L258)).
   Skip `xcodebuild -exportArchive`. It "Requires -archivePath and -exportOptionsPlist" and signs
   for distribution.

**Not `eas build --local`.**
- It needs an Expo login, and, for a device build, credentials.
- `withoutCredentials: true` skips them: "EAS CLI won't require you to configure credentials when
  building the app" ([eas.json](https://docs.expo.dev/eas/json/)). But what it then produces for a
  device is not documented.
- Plain `xcodebuild` needs no account at all. So the AltStore build also sidesteps open question 9.

**On a GitHub Actions macOS runner.**
- **The image.** `macos-26` (arm64), image 2026-10-26, has Xcode 26.6 by default, CocoaPods 1.17.0
  and Node 24.22.1
  ([runner image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)).
  SDK 58 asks for Xcode 26.4+.
- **The cost.** cedo's repository is private, so the runner is billed: 0.062 USD a minute for
  macOS. GitHub Free includes 12 USD of usage a month, which the Linux CI also draws on. Runners in
  public repositories are free
  ([GitHub](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
- **When.** Build on a release tag, not on every push to `main`.

#### What re-signing with a free Apple ID does to the app

- **A new bundle ID.** AltStore appends the user's team ID. `com.<owner>.cedo` installs as
  `com.<owner>.cedo.<TEAMID>`, and an extension as `com.<owner>.cedo.<TEAMID>.<suffix>`
  ([`FetchProvisioningProfilesOperation.swift`](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStore/Operations/FetchProvisioningProfilesOperation.swift#L193-L207)).
  - With "Randomize Bundle IDs" on, it is `com.<hash>.<TEAMID>`.
  - SideStore does the same (its own `FetchProvisioningProfilesOperation.swift`).
  - The original ID is kept in `Info.plist` as `ALTBundleIdentifier`
    ([`ResignAppOperation.swift`](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStore/Operations/ResignAppOperation.swift#L118-L128)).
- **App Groups are renamed too.** `group.X` becomes `group.X.<TEAMID>` (same file, L458). The real
  names are written into `Info.plist` as `ALTAppGroups`. App Groups are on Apple's free-team list
  ([capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios)).
- **Entitlements a free profile lacks are dropped, not refused.** AltSign signs with the profile's
  entitlements, so `aps-environment` and Time Sensitive simply disappear (`ALTSigner.mm`, above).
  Apple's free column has neither Push Notifications nor Time Sensitive Notifications. Unlike Xcode
  (§2), nothing fails to sign.
- **The keychain.** `keychain-access-groups` are re-prefixed with the new team ID. cedo passes no
  access group to `expo-secure-store` (`apps/app/src/auth/token-storage.ts`), and its plugin adds no
  entitlement. So the token sits in the app's default group, and survives every refresh while the
  re-signed ID stays the same (**inference**). Signing in to AltStore with another Apple ID makes a
  new bundle ID: a new app, signed out.

| Capability (§4) | Through AltStore Classic | Why |
| --- | --- | --- |
| Rest-over local notification | Works (**inference**, as for the free team in §4) | No entitlement |
| Time Sensitive; push; remote Live Activity updates | No | Paid capabilities, dropped when re-signed |
| Live Activity (`expo-widgets`, not taken) | Installs, and its extension costs an App ID. Its layout would not reach the extension (**inference**). | `expo-widgets` opens the App Group named by `ExpoWidgetsAppGroupIdentifier`, which its plugin writes into `Info.plist` at build time ([`WidgetsStorage.swift`](https://github.com/expo/expo/blob/d26d33f25da24a3bc033a297674b7d3d5e9b065c/packages/expo-widgets/ios/WidgetsStorage.swift#L2), [`withAppInfoPlist.ts`](https://github.com/expo/expo/blob/d26d33f25da24a3bc033a297674b7d3d5e9b065c/packages/expo-widgets/plugin/src/ios/withAppInfoPlist.ts#L16)). AltStore renames the group but not that key. A Live Activity reads its layout only from the group, with no fallback ([`Utils.swift`](https://github.com/expo/expo/blob/d26d33f25da24a3bc033a297674b7d3d5e9b065c/packages/expo-widgets/ios/Widgets/Utils.swift#L79-L80)). A small patch that prefers `ALTAppGroups` when present would fix it. |
| Home-screen widget | Installs, for an App ID. It shows the layout and initial props built into it, never fresh data (**inference**). | The same group. Widgets fall back to a layout embedded at build time ([`WidgetsLayoutRegistry.swift`](https://github.com/expo/expo/blob/d26d33f25da24a3bc033a297674b7d3d5e9b065c/packages/expo-widgets/ios/Widgets/WidgetsLayoutRegistry.swift#L9-L18)). |
| AlarmKit, alert only (§4) | Works (**inference**; not built). No extension, so no App ID beyond the app's. `NSAlarmKitUsageDescription` must be in the source's `privacy`. | Not a capability, and no entitlement to drop. AltStore checks every `NS…UsageDescription…` key ([`VerifyAppOperation.swift`](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStore/Operations/VerifyAppOperation.swift#L198-L215)). |
| AlarmKit's countdown (§4: a hand-written extension) | Works (**inference**; not built). The extension costs an App ID. If the user lets AltStore strip it, the app falls back to an alert only. | The extension reads the alarm's `AlarmAttributes`, which ActivityKit hands it, and no App Group. The rename never reaches it. It needs no entitlement, so an unsigned `.ipa` should carry it as it is (**inference**). |
| Local network, photos, Face ID | Work. Each `…UsageDescription` must be in the source. | AltStore's install check |

**Extensions install.** AltStore registers an App ID for each extension and signs each one:
`requiredAppIDs = 1 + application.appExtensions.count` (`FetchProvisioningProfilesOperation.swift`,
L270). So cedo with a Live Activity extension holds two of the user's 10 App IDs.

#### Serving it from a cedo instance

**How static files are served today.**
- The `web` image is Caddy, serving the web export from `/srv` (`apps/app/Dockerfile`).
- The export copies `apps/app/public/` into `dist/`: a local `dist/` has `icons/` and
  `manifest.webmanifest`.
- The Caddyfile serves a real file, else `index.html`. Only `/_expo/static/*` and `/assets/*` are a
  real file or a real 404. Every other path is marked `no-cache`.
- The image is ~63 MB (`docs/09-deployment.md`).

**The `.ipa` cannot be built in that image.** Self-hosters build `web` from source, in a Linux
container (`docker compose build`; no image is published). An iOS build needs macOS and Xcode. So the `.ipa`
is built once per release, on a Mac or a macOS runner, and every instance gets the same file. §3's
"one build for every instance" already holds: no address is compiled in.

**Three shapes.**

| | `source.json` | `.ipa` | Costs | App matches server |
| --- | --- | --- | --- | --- |
| **A. All on the instance** | `/altstore/source.json` | `/altstore/cedo-<version>.ipa`, inside the image | The image grows by the `.ipa`. It is not measured: nothing is built yet. Expo apps commonly run to tens of MB (**inference**). The Dockerfile must still download it from somewhere public. `downloadURL` must be absolute, and cedo does not know its own address. So the source must be filled in per request: by the API, or by Caddy's `templates` (`.Req.Host`, `.Req.Header.Get`). JSON is not among its default types, "text/plain, text/markdown, and text/html" ([Caddy](https://pkg.go.dev/github.com/caddyserver/caddy/v2/modules/caddyhttp/templates)). | Exactly |
| **B. The source on the instance, the `.ipa` hosted once** | `/altstore/source.json`, a static file written at image build from `VERSION` | One public file per release | A few KB per image. Nothing is filled in at runtime: the only absolute URL is the release's. The phone downloads the `.ipa` from that host, which sees its IP address. | Exactly |
| **C. One source for every instance** | Hosted once, e.g. GitHub Pages | One public file per release | The least work | No. It lists the newest app, which may be ahead of an instance. §3's version rule has to absorb that. |

**What a source served by the instance makes possible.**
- It lists one version: the app built from the commit the server runs. AltStore offers it whenever
  it differs from what is installed, newer or older.
- So the app follows its server, as the PWA does, one tap later. A store app follows Apple's
  schedule instead (§3).
- **The window is not zero.** Installing an update needs AltServer, or a Remote AltServer. A server
  upgraded at night meets an old app at the gym, until the phone next reaches the computer.
  `ContractDriftError` fires in that window. §3's compatibility rule is still needed. It becomes a
  short-lived edge rather than the normal case.

**What an instance must get right.**
- **HTTPS**, which installing the PWA already needs (`docs/09-deployment.md`).
- **`/altstore/*` served as files.** A real file or a real 404, as `/_expo/static/*` is. Today a
  missing `source.json` would be answered with `index.html` and a 200.
- **A versioned name,** if the instance serves the `.ipa` (A): `cedo-<version>.ipa`, marked
  immutable like build output.
- **Two prerequisites.**
  - A version and a release process. `VERSION` is `0.0.0`, and `app.json` has no build number.
  - Somewhere public for the `.ipa`. cedo's repository is private, and a private repository's
    release assets need a token to download (**inference**; not tried).

#### Verdict

- **Who it suits.** The owner, who already runs AltStore Classic and AltServer. And technical
  self-hosters who already sideload. For them it is the only free native path, and shape B gives
  each instance an app that matches it.
- **Who it does not.** Strangers. They would need a computer running AltServer, their Apple ID
  password in a third-party tool, Developer Mode, a refresh every 7 days, and one of three app
  slots. And Apple has started banning profiles (AltStore 2.3.1). The PWA stays their app.
- **With TestFlight or the App Store later.**
  - The App Store build is `com.<owner>.cedo`; the AltStore build is `com.<owner>.cedo.<TEAMID>`.
    They are two separate apps, side by side.
  - Nothing on the phone carries over: they have different containers and keychain identities
    (**inference**).
  - Training data is on the server, so moving is signing in again. Send any set still waiting
    offline (`apps/app/src/api/pending.ts`) first.
- **With §4.**
  - Local notifications: yes.
  - Time Sensitive and push: no.
  - AlarmKit: yes, as far as the sources go (**inference**; not built). An alert-only alarm needs no
    extension. Its countdown needs one, with no App Group, at the cost of an App ID.
  - `expo-widgets`' Live Activities and widgets: only once it reads `ALTAppGroups`. Each extension
    spends an App ID.

**Recommendation.**
- **Worth it for the owner,** after steps 1–9 work and before paying. It replaces the weekly
  rebuild from Xcode with AltServer's background refresh, on a standalone Release build.
- **Serve it as B.** A static `/altstore/source.json` per instance, written at image build, pointing
  at one public `.ipa` per release.
  - Not A: the image cannot build the `.ipa`, so embedding it only moves a download from the phone
    to the image build, and costs every image its size.
  - Not C: it gives up the version match, which is the point.
- **No `expo-widgets` widget or Live Activity in this build** until the App Group is solved.
  AlarmKit can go in, with or without its countdown extension: neither uses an App Group.
- **Document it as a technical option,** not as the way strangers install cedo.

## 2. Fast local iteration with Expo SDK 58

| Option | Custom native code (notifications plugin options, widgets) | Free Apple ID | Notes |
| --- | --- | --- | --- |
| **Expo Go** | No: "a pre-built native app… it can't be changed after you install it" ([Expo](https://docs.expo.dev/develop/development-builds/faq/)) | – | Whether the App Store's Expo Go runs SDK 58 is unclear. The SDK 58 post said "within a few weeks", and Expo's own pages disagree. Widgets are "not available in the Expo Go app". **Not for cedo.** |
| **Development build, local** (`expo-dev-client`, `npx expo run:ios`) | Yes | **Yes**: "the only way to install a development build on an iPhone without a paid Apple Developer account" ([Expo](https://docs.expo.dev/develop/development-builds/introduction/)) | Needs Xcode and CocoaPods. `--device` for an iPhone. `--configuration Release` "is not automatically code signed for submission". Rebuild with `npx expo prebuild --clean` after a native change. |
| **EAS ("Expo Build") cloud** | Yes | No: ad hoc "requires a paid Apple Developer account" ([Expo](https://docs.expo.dev/build/internal-distribution/)), and so does generating credentials (step 12) | Free plan: 15 iOS builds a month, low-priority queue, 45-minute timeout. Then 2 USD (medium) or 4 USD (large) per iOS build ([pricing](https://expo.dev/pricing)). EAS is now branded Expo Build, Expo Update and so on; the `eas` CLI and `eas.json` keep their names. |
| **`eas build --local`** | Yes | Builds, but signing for distribution needs the program | Needs an Expo login (or `EXPO_TOKEN`), fastlane and CocoaPods. No caching. `eas.json`'s `node`, `cocoapods` and `image` fields are ignored ([Expo](https://docs.expo.dev/build-reference/local-builds/)). |

- **CNG and config plugins.** `ios/` and `android/` belong in `.gitignore`. Prebuild runs config
  plugins, "functions… executed during the prebuild process"
  ([Expo](https://docs.expo.dev/config-plugins/introduction/)). Every native setting — Info.plist
  keys, entitlements, extension targets — is then authored in `app.json`/`app.config.ts`, never
  hand-edited in Xcode.
- **Bun and the monorepo work as they are.**
  - Expo configures Metro for workspaces itself since SDK 52
    ([Expo](https://docs.expo.dev/guides/monorepos/)).
  - Expo Build picks Bun from `bun.lock`, but "Bun does not automatically execute lifecycle scripts"
    without `trustedDependencies` ([Expo](https://docs.expo.dev/guides/using-bun/)).
- **Expo Update (OTA) is optional.** It is "a cloud service… for projects using the `expo-updates`
  library". `expo-updates` can also talk to "a custom server" implementing the Expo Updates
  protocol ([Expo](https://docs.expo.dev/versions/latest/sdk/updates/)).
  - **Recommendation:** leave it out at first. Ship JavaScript changes as store builds.
  - An OTA channel would be one more way for a store app to drift from the self-hosted servers it
    talks to (§3).
- **Opting in to a plugin can be a trap.** Some Expo plugins switch on native capabilities just by
  being installed:
  - `expo-notifications` is applied by prebuild even when it is not listed in `plugins`, and by
    default it adds `aps-environment`, which a personal team cannot sign.
  - `expo-audio` adds the `audio` background mode by default.

  See §4 for both. **Inference:** a free-team build that fails to sign right after adding a module
  is this.

### What of the repo's tooling carries over

| Tool | On native |
| --- | --- |
| `bun run check` | **Carries over.** The contract's T1 tests, and the app's plain modules — the new server-address and rest-alert modules too — run under `bun test` with fakes. |
| `bun run shot`, `gallery`, `e2e` | **Web only.** They serve `apps/app/dist` (the web export) to `Bun.WebView` (ADR-0017). They keep proving the shared screens render and run, which is most of the app. They say nothing about native layout, the keyboard, safe areas, notifications, the Live Activity or local network access. |
| Journeys' fixtures (`page.client()`) | The typed client in the test process carries over to any future native harness. |
| A native equivalent | Not decided. Two first-party candidates: `xcrun simctl io booted screenshot` (`simctl` has `io … screenshot`, `openurl` for `cedo://` links, `push` for a simulated push, and `privacy` to grant permissions), and Maestro flows, which Expo documents for development and simulator builds ([Expo](https://docs.expo.dev/eas/workflows/examples/e2e-tests/)). Either is a new UI tier: an amendment to ADR-0017. Notifications, Live Activities and the local-network prompt still need the phone itself, as #61 needed it for the PWA. |

**Recommendation.**
- Develop on a local development build: the simulator for screens, the iPhone on a free team for
  anything the lock screen shows.
- Use EAS only to produce TestFlight builds, once the program is paid.
- Keep `bun run e2e` as the UI gate for both platforms' shared screens.
- Add a small native screenshot loop only once there is native-only UI to look at.

## 3. Self-hosting and a native app together

### How other self-hosted apps do it

The agent read each app's source at a pinned commit. The links go to the files.

| App | Typed address | Check | Identity | Kept in | iOS ATS | Push |
| --- | --- | --- | --- | --- | --- | --- |
| **Immich** (Flutter) | No scheme → `https://`; trailing `/` stripped ([url_helper.dart](https://github.com/immich-app/immich/blob/0cb2ab23b8c1669cc0a39e2247c62bdaceb0150d/mobile/lib/utils/url_helper.dart)) | `GET /.well-known/immich` → `{api:{endpoint:'/api'}}`, then `/api/server/ping`, 5 s timeouts ([api.service.dart](https://github.com/immich-app/immich/blob/0cb2ab23b8c1669cc0a39e2247c62bdaceb0150d/mobile/lib/services/api.service.dart)) | The app's major version may not be behind the server's, nor more than one ahead (`version_compatibility.dart`) | App SQLite, plus an app-group cookie | `NSAllowsArbitraryLoads` | None; local notifications for backup |
| **jellyfin-expo** (Expo, a WebView shell) | No scheme → `http://` (normalize-url) ([ServerValidator.js](https://github.com/jellyfin/jellyfin-expo/blob/205217aa27c17054686867936ad295cf89d96117/utils/ServerValidator.js)) | `GET system/info/public`, 5 s | `ProductName === 'Jellyfin Server'`; "Could not connect to server" is a different message from "Not a Jellyfin server" | AsyncStorage; the session is the WebView's | `NSAllowsArbitraryLoads` | None |
| **Swiftfin** | No scheme → `http://` | `/System/Info/Public` | The server `id`; redirects adopted ([ConnectToServerViewModel.swift](https://github.com/jellyfin/Swiftfin/blob/e6eaaa62ac94a826747383c293326c865eb39e94/Shared/ViewModels/ConnectToServerViewModel.swift)) | Keychain | `NSAllowsArbitraryLoads`; a local-network string | None |
| **Home Assistant iOS** | Asks "Did you mean http:// or https://?"; the path is dropped | Reaches `/auth/authorize` | Instance ID after login; a same-host redirect may change port or scheme, never downgrade https | Keychain | `NSAllowsArbitraryLoads`; Bonjour | FCM relay with full content, 500 a day per device; "Local Push" over the home Wi-Fi only ([docs](https://companion.home-assistant.io/docs/notifications/notification-details)) |
| **ntfy iOS** | Must start `https?://` | `GET /{topic}/auth` | "Unexpected response from server. Is this a ntfy server?" | Core Data (the password in plain text) | `NSAllowsArbitraryLoads` | A content-free relay through ntfy.sh (below) |

Where they agree:
- one unauthenticated GET at a known path, checked for the product's name;
- "can't reach" kept apart from "not a … server";
- a changed address means signing in again.

Every one of them sets `NSAllowsArbitraryLoads`.

### What that suggests for cedo

**Address.**
- **What the user types:** the address they open in a browser, e.g. `cedo.example.com` or
  `192.168.1.20:8080`.
- **How it is normalised:** trim it, and add `https://` if there is no scheme (Immich's rule; HA's
  two-button question is the friendlier variant). Strip trailing `/`, then append `/api` unless the
  address already ends with it (Immich again). Issue #10's "it must end in `/api`" becomes the
  app's job, not the user's.

**Check.**
- `GET <base>/health`, with a timeout of a few seconds.
- Today `/health` answers `{ ok: true, db: true }` (`apps/api/src/app.ts`), which any server could
  say. Add the product name and `VERSION` (`apps/api/src/version.ts`), with a schema in
  `packages/contract`, so the app can say "not a cedo server" as Jellyfin says "Not a Jellyfin
  server".
- Follow no redirect to another host.

**Versions** (new with a native app).
- The PWA is always served by its own server, so the two never differ. A store app updates on
  Apple's schedule; a self-hosted server whenever its owner pulls.
- The client already throws `ContractDriftError` on any mismatch (`docs/08-frontend.md`). A version
  rule is therefore needed before the first external tester: the app refuses servers older or newer
  than a range, as Immich does, with a message that says which side to update.
- `VERSION` is `0.0.0` today.

**Storage.**
- The address and the token are stored *together*, in the Keychain through `expo-secure-store`
  (already a dependency), so a token is only ever sent to the server that issued it.
- Changing the server signs out (Immich).
- One server, one address. Internal/external addresses chosen by Wi-Fi name cost the Wi-Fi-info
  entitlement and location permission in Immich, Swiftfin and HA. One HTTPS name everywhere is
  simpler, and is what `docs/09-deployment.md` already asks for (Tailscale Serve, a tunnel, the
  NAS's proxy).
- This is app-owned state — who is signed in, *on which server* — so it belongs beside
  `src/auth/session.ts`, under invariant 7.

**Transport security.**
- **Plain HTTP to an IP address, a `.local` name or an unqualified name** works under
  `NSAllowsLocalNetworking`, which the Expo template already sets (Mac setup above).
- **Plain HTTP to any other hostname** needs `NSAllowsArbitraryLoads`, and "You must supply a
  justification during App Store review if you set the key's value to YES"
  ([Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowsarbitraryloads)).
  - **Recommendation:** do not set it. Require HTTPS except for IPs and `.local` names. The PWA
    already needs HTTPS to install.
  - **Open question:** the self-hoster at `http://nas.lan:8080`. `.lan` is neither `.local` nor
    unqualified.
- **Self-signed certificates.** The user installs the CA as a profile and turns on full trust:
  Settings → General → About → Certificate Trust Settings
  ([Apple](https://support.apple.com/en-us/102390)).
  - The certificate must meet Apple's rules: the name in the SAN, `serverAuth`, 825 days or fewer
    ([Apple](https://support.apple.com/en-us/103769)).
  - **Inference:** the system's normal trust then accepts it, with no code in cedo.
  - HA iOS stores a per-server trust exception instead. That is more code, and not needed first.

**Local network permission** (iOS 14+).
- An outgoing connection to an address on the Wi-Fi's own subnet asks permission, through every API
  including `URLSession`. Denied, "the system blocks it"
  ([TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)).
- VPN and cellular interfaces are not "local", so a Tailscale address does not ask (**inference**
  from TN3179's definition).
- Add `NSLocalNetworkUsageDescription`. Make "Can't reach your server" mention the permission when
  the address is a LAN one.

**CORS.**
- Not a concern on native. CORS is enforced by browsers, not by a native `fetch` (**inference**;
  no Expo or React Native page states it).
- The API needs no change, and "no CORS anywhere" stays true.
- Media blobs are unauthenticated by design (`apps/api/src/modules/media/index.ts`), and
  `apiUrl()` already makes their paths absolute, so native images load as they are.

### Push notifications: who holds the key

- **The APNs key cannot be handed out.** Apple's token-based key is team-scoped: "for sending
  notifications to any topic in a team", and it "must remain private to prevent anyone else from
  generating those tokens"
  ([Apple](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)).
  Giving it to every self-hoster would let any of them push to every app of the publisher's team
  (**inference**).
- **The ways others solve it:**

| Approach | Who | What passes through a third party |
| --- | --- | --- |
| No push; local notifications and background tasks only | Immich, Jellyfin | Nothing |
| The publisher's relay | Home Assistant: the server POSTs to `mobile-apps.home-assistant.io`, which sends through Firebase, capped at 500 a day per device | Title and body: "not encrypted on the Firebase cloud messaging service" |
| A content-free relay | ntfy: the self-hosted server sends `ntfy.sh` only the message ID and a SHA-256 of the topic URL. The phone's Notification Service Extension fetches the message from the self-hosted server, or shows "New message" ([ntfy](https://docs.ntfy.sh/config/#ios-instant-notifications)) | An ID and a hash |
| Expo Push Service | Any server can POST an `ExpoPushToken` to `https://exp.host/--/api/v2/push/send`. Expo holds the publisher's APNs credentials. By default no access token is needed; "enhanced push security" can require one ([Expo](https://docs.expo.dev/push-notifications/sending-notifications/)) | The payload, through Expo |
| Local push over a network extension | HA iOS (`NEAppPushProvider`), "only… when connected via Internal URL", on configured Wi-Fi networks | Nothing; it needs a special entitlement |

**What it means for cedo.**
- The rest timer needs no push. Its end is known when the set is logged, and the phone that logged
  it schedules the alert itself.
- ADR-0025's amendment already chose this; this research confirms it is the only option that needs
  no third party and works without a signal.
- Push becomes necessary only if *another* device must be told (#39's open question), or for
  something no phone can predict (a coach's comment, say).
- Then the ntfy shape is the one that fits "asks nothing of a third party" best: a relay run by the
  publisher, carrying an ID only. But it is still a service the publisher must run for every
  instance.
- **Recommendation:** no push in the first native release.

## 4. Native capabilities the PWA cannot have

### Rest over: a local notification

- **The Apple API.** `UNTimeIntervalNotificationTrigger`: "You use this type of trigger to
  implements timers"
  ([Apple](https://developer.apple.com/documentation/usernotifications/untimeintervalnotificationtrigger)).
  It is cancelled with `removePendingNotificationRequests(withIdentifiers:)`.
- **Delivery "isn't guaranteed"**
  ([Apple](https://developer.apple.com/documentation/usernotifications)).
- **The Expo route: `expo-notifications`** (~58.1.8 on SDK 58).
  - `TIME_INTERVAL` and `DATE` triggers, and `cancelScheduledNotificationAsync(id)`
    ([Expo](https://docs.expo.dev/versions/latest/sdk/notifications/)).
  - **Since 58.1.0 the plugin takes `enableRemoteNotifications: false`.** "If set to `false`, the
    plugin does not add the APNs entitlement, which is useful for apps that use only local
    notifications" (plugin source, sdk-58).
  - **Trap:** prebuild applies the plugin even when it is not listed, with defaults that add
    `aps-environment`. A personal team cannot sign that, since Push Notifications is not available
    without the program. List it with the option.
  - **Assumption, not tested:** that the listed options win over the auto-applied defaults. The
    agent read it from `getPrebuildConfig.ts`; check on the first build.
- **Silent switch and Focus.**
  - A notification sound does not play in Silent mode: "iPhone doesn't ring or play alerts… (but
    iPhone may still vibrate)" ([Apple](https://support.apple.com/guide/iphone/silence-iphone-iph81c7fd7d1/ios)).
  - **Time Sensitive** breaks through Focus, but not the Silent switch (HIG table,
    [Apple](https://developer.apple.com/design/human-interface-guidelines/managing-notifications)).
    The capability is paid-program only, and the Expo plugin never adds its entitlement; add it with
    `ios.entitlements`.
  - **Critical** alerts override the switch, but need an entitlement Apple grants on request.
    Inappropriate here.
- **Sound.** A custom sound must be shorter than 30 s, in `aiff`, `wav` or `caf`
  ([Apple](https://developer.apple.com/documentation/usernotifications/unnotificationsound)). The
  plugin's `sounds` option bundles it.
- **Android.** `expo-notifications` uses `setExactAndAllowWhileIdle` only when exact alarms are
  allowed, and falls back to inexact otherwise.
  - `SCHEDULE_EXACT_ALARM` is "denied by default" for new installs targeting Android 13+ on Android
    14 ([Android](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms)).
  - Play allows `USE_EXACT_ALARM` only where "core… functionality requires precisely-timed actions,
    such as… an alarm or timer app". Even that is inconsistent: the same policy page lists only
    "alarm or calendar" elsewhere
    ([Play](https://support.google.com/googleplay/android-developer/answer/16558241)).
  - Inexact alarms on API 31+ can fire "within one hour". So on Android the app must ask for the
    exact-alarm permission, or the alert may come late.

### Through the Silent switch: AlarmKit (iOS 26+)

- **What it does.** "An alarm… overrides both a device's focus and silent mode, if necessary". It
  supports timers that "alert after a countdown"
  ([Apple](https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit)).
- **What it needs.**
  - `NSAlarmKitUsageDescription` and a user authorisation.
  - A widget extension for the countdown: "Otherwise, the system may unexpectedly dismiss alarms and
    fail to alert". An alarm with an alert only needs none (**inference**; "Rest's end on the device
    only", below).
  - It is not on Apple's capabilities list, so a free team should be able to use it (**inference**;
    not built).
- **Apple's own framing.** WWDC25: "Alarms are a great fit for countdowns with a specific
  interval, like a cooking timer… They are not a replacement for… critical alerts or time-sensitive
  notifications" ([WWDC25 230](https://developer.apple.com/videos/play/wwdc2025/230/)).
- **The Expo route.** No first-party module. npm has several small community bridges, and none makes
  the widget extension (compared below). A local Expo module in Swift is the maintainable route.
- **For cedo.** The deployment target is iOS 16.4, so it would sit behind an availability check. It
  is the only sanctioned way for a rest to be heard with the phone on silent in a pocket. It is
  also an *alarm* — full-screen, with Stop — which may be too much for a two-minute rest. **Owner**
  decision.

### Lock Screen and Dynamic Island: a Live Activity

**Apple's rules** ([Apple](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)):
- **Lifetime.** "active for up to eight hours", then on the Lock Screen "for a maximum of 12 hours".
  A session fits.
- **Starting it.** It is started "while the app is in the foreground". Logging a set happens there.
- **Updating it.** The app updates it while running. Push updates use APNs with
  `apns-push-type: liveactivity`, which is the publisher's key again. Its data, static and dynamic,
  "can't exceed a combined size of 4 KB".
- **A countdown that ticks with the app suspended.** `Text(timerInterval:pauseTime:countsDown:)`:
  "Show up-to-date, time-based information in your widget even when it isn't running"
  ([WidgetKit](https://developer.apple.com/documentation/widgetkit/displaying-dynamic-dates)).
  - Apple says nothing of what it shows once the interval ends. It does offer `pauseTime` "to stop
    the timer at a specific date, such as when a countdown reaches zero". **Inference:** pass the
    rest's end.
- **What it says once the rest is over.**
  - Give a `staleDate` at the rest's end, and render "Rest over" when stale.
  - Expo's doc says `isStale` "becomes `true` without the app running"
    ([Expo](https://docs.expo.dev/versions/latest/sdk/widgets/)). Apple's own two pages are less
    explicit; **verify on a device**.
- **Dismissing it.** `dismissalPolicy: .after(date)` within four hours of ending. HIG: "In most
  cases, 15 to 30 minutes is adequate".
- **Apple Watch, Mac and CarPlay.** Live Activities appear in the Watch's Smart Stack, and since
  iOS 26 on the Mac menu bar and in CarPlay, with no code
  ([Apple](https://developer.apple.com/documentation/updates/activitykit)).

**The Expo route: `expo-widgets`.** It is first-party: alpha in SDK 55, stable from SDK 56, Android
widgets added in 58. **Not taken** for the rest: on iOS 26+ AlarmKit's own countdown replaces it,
and its App Group breaks under AltStore ("Rest's end on the device only", below).
- `createLiveActivity` defines the layouts: Lock Screen banner, compact, minimal, expanded.
- It is driven from JavaScript: `start(props, url, staleDate)`, `update`, `end(dismissalPolicy)`
  and `getInstances` after a relaunch.
- Expo UI's SwiftUI `Text` takes `timerInterval`.
- Push is off unless `enablePushNotifications: true`.
- It always adds an App Group (`group.<bundleId>`). App Groups are available to a free team.
- Limits: widget code "cannot use React hooks… cannot perform asynchronous work". Not in Expo Go.

`@bacons/apple-targets` is the fallback: hand-written Swift targets declared in `/targets`, CNG-safe,
and needing CocoaPods ≥ 1.16.2 ([README](https://github.com/EvanBacon/expo-apple-targets)).
`expo-live-activity` (Software Mansion) is deprecated in favour of `expo-widgets`.

**Android.** An ongoing notification with `setUsesChronometer(true)` and `setChronometerCountDown`
(API 24) and `when` = the end. It is "an automatically updating display"
([Android](https://developer.android.com/reference/android/app/Notification.Builder)).
- On Android 16 (QPR2, API 36.1) it can be promoted to a **Live Update**: a status-bar chip that
  shows the chronometer "as long as it is positive".
- Requirements: ongoing, a content title, `POST_PROMOTED_NOTIFICATIONS`, `setRequestPromotedOngoing`.
- The guide's own example is "starting a workout"
  ([Android](https://developer.android.com/develop/ui/views/notifications/live-update)).
- `expo-widgets` does not do Live Activities on Android, so this would need a custom module.

### Home-screen widgets

- **WidgetKit.** A timeline, with 40–70 reloads a day for a widget often seen. A reload the app asks
  for while it runs is not budgeted
  ([Apple](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date)).
- **Sharing data.** It goes through an App Group.
- **Getting data.** `expo-widgets` widgets cannot fetch. The app hands them a snapshot or a timeline
  when it runs. A "next session" or "this week" widget is possible, with data as fresh as the last
  opening.
- **Android.** Glance (Compose), with `updatePeriodMillis` "up to once every 30 minutes"
  ([Android](https://developer.android.com/develop/ui/compose/glance/glance-app-widget)).
  `expo-widgets` supports it with `enableAndroid`.
- **Lower value than the rest timer.**

### Background audio

**Apple's rules.**
- `UIBackgroundModes` `audio`: "The app plays audible content in the background".
- "If an alternative to executing in the background exists, use the alternative instead"
  ([Apple](https://developer.apple.com/documentation/xcode/configuring-background-execution-modes)).
- **Categories.**
  - `.ambient` and `.soloAmbient` are silenced by the switch and by locking the screen.
  - `.playback` "continues with the Silent switch set to silent or when the screen locks". To keep
    playing in the background it needs the `audio` mode.
- **Ducking.** `.duckOthers` should not duck other audio "for more than a few seconds". Apple names
  "an exercise app" as a case for `interruptSpokenAudioAndMixWithOthers`
  ([Apple](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/duckothers)).
- **Review.** 2.5.4 allows background audio for "audio playback".
  - Keeping an audio session alive just to beep later is not playback (**inference**). It is the
    likeliest way to be rejected.

**The Expo route: `expo-audio`.**
- `setAudioModeAsync({ playsInSilentMode, interruptionMode: 'duckOthers', shouldPlayInBackground })`.
  It is a no-op on web.
- Its plugin's `enableBackgroundPlayback` **defaults to true** and adds `audio`. Set it false.
- **For cedo.** The open-app chime (`src/lib/chime.ts`, web only today) gets a native counterpart.
  It plays only while the app is in front, with `duckOthers` so the athlete's music dips. In the
  background, the notification sound (or AlarmKit) is the alert.

**Android.** Neither MediaSession nor a media foreground service is needed for a short sound. A
notification channel at default importance or above "Makes a sound"
([Android](https://developer.android.com/develop/ui/views/notifications/channels)).

### Rest's end on the device only: local notification and AlarmKit, without `expo-widgets`

The owner's direction, after #39: the rest's end is told by the phone alone, by a local
notification and by AlarmKit. No push, no server, and no `expo-widgets`. The build may reach the
phone through AltStore Classic, which renames App Groups (§1). #39's decisions still hold: "Rest
over" · "Barbell Back Squat — Set 3 of 5: 5 × 102.5 kg", opening the session when tapped; opt-in
from the rest band and from Settings; cancelled by the next set, Undo, skip, finishing or deleting;
moved by +30 s; scheduled from the session's `rest {since, endsAt}` (ADR-0025).

Read against Apple's AlarmKit pages, WWDC25 session 230's transcript, and the AlarmKit interface in
this Mac's Xcode 27.2 (iOS 27.2 SDK, `AlarmKit.swiftmodule/arm64e-apple-ios.swiftinterface`). Expo
at `sdk-58`
[b76ddd7](https://github.com/expo/expo/tree/b76ddd7b732eef9957d75b85100e68a1a968118c).

#### AlarmKit, read closely

**What an alarm is.** "An alarm is an alert that presents at a pre-determined time based on a
schedule or after a countdown. It overrides both a device's focus and silent mode, if necessary"
([Apple](https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit)).
Every alarm is an `AlarmManager.AlarmConfiguration`
([Apple](https://developer.apple.com/documentation/alarmkit/alarmmanager/alarmconfiguration)):

| Configuration | Apple says | For a rest |
| --- | --- | --- |
| `.alarm(schedule: .fixed(date))` | "At the scheduled time… the alarm alerts". `fixed` is "A one-shot alarm that fires at a specific time" ([Apple](https://developer.apple.com/documentation/alarmkit/alarm/schedule-swift.enum/fixed%28_:%29)) | An alert at the end. Nothing shows before it (**inference**). |
| `.timer(duration:)` | "The timer starts immediately, runs for `duration` seconds, and then alerts" ([Apple](https://developer.apple.com/documentation/alarmkit/alarmmanager/alarmconfiguration/timer%28duration:attributes:stopintent:secondaryintent:sound:%29)) | A countdown, then the alert |
| `init(countdownDuration:schedule:…)` | `preAlert` before it fires, `postAlert` after a repeat or snooze ([Apple](https://developer.apple.com/documentation/alarmkit/alarm/countdownduration-swift.struct)) | The general form of both |

Its states are `scheduled`, `countdown`, `paused` and `alerting`.

**What the system shows, with the app not running.** The system holds the alarm: `alarms` "Fetches
all alarms from the daemon that belong to the current client"
([Apple](https://developer.apple.com/documentation/alarmkit/alarmmanager)).
- **The alert.** "When it fires, the alert breaks through the silent mode and the current focus. In
  the alert, people are presented with the custom alarm title, as well as the name of your app".
  Stop is the system's; a second button is optional
  ([WWDC25 230](https://developer.apple.com/videos/play/wwdc2025/230/)). Apple's sample: "The
  system forwards the alert presentation to a paired watch".
- **The countdown before it.** "Alarms support a custom countdown interface using Live Activities
  that your app provides. This can be viewed on the Lock Screen as well as in the dynamic island and
  in StandBy" (WWDC25 230).
- **The countdown's state is the system's.** The app provides `AlarmAttributes`; AlarmKit provides
  the dynamic content, "such as the alarm `fireDate` and current presentation mode", and "updates
  the `AlarmPresentationState` as the alarm transitions"
  ([Apple](https://developer.apple.com/documentation/alarmkit/alarmpresentationstate)).

**Does it need a widget extension? For a countdown, yes.**
- Apple's sample: "AlarmKit expects a widget extension if an app supports a countdown
  presentation. Otherwise, the system may unexpectedly dismiss alarms and fail to alert"
  ([Apple](https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit)).
- WWDC25 230: "If your alarm supports countdown functionality, your app is required to implement
  it using a Live Activity." "You will need to add your countdown Live Activity to your app's widget
  extension." "You will then set up an ActivityConfiguration, and specify AlarmAttributes with your
  metadata type."
- The extension is for "non-alerting presentations in the Dynamic Island, Lock Screen, and
  StandBy" (sample). The alert is drawn by the system from the title and buttons. With no
  countdown, the sample builds the alert alone: "Because `Countdown` and `Paused` are optional
  presentations, this sample doesn't use them if the alarm only has an `Alert` state."
- **So an alarm at a fixed time, with an alert only, needs no extension** (**inference** from
  Apple's conditional; no page says it outright). A timer does.

**Authorization.**
- `NSAlarmKitUsageDescription`: "If the `NSAlarmKitUsageDescription` key is missing or its value is
  an empty string, your app can't schedule alarms with AlarmKit"
  ([Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/nsalarmkitusagedescription)).
- The prompt shows that string. It comes from `requestAuthorization()`, or by itself before the
  first alarm. "If a person using your app denies authorization, all attempts to schedule alarms
  fail" ([Apple](https://developer.apple.com/documentation/alarmkit/alarmmanager/requestauthorization%28%29)).
  "At any time, people can change their authorization status in the Settings app" (WWDC25 230).
- **No entitlement, no capability.** AlarmKit, Live Activities and WidgetKit are not rows of
  Apple's capabilities table
  ([Apple](https://developer.apple.com/help/account/reference/supported-capabilities-ios)), and
  nothing in the SDK interface asks for one.

**Limits and the lifecycle.**
- `AlarmManager.AlarmError` has one case, `maximumLimitReached`: "A maximum number of alarms is
  already scheduled"
  ([Apple](https://developer.apple.com/documentation/alarmkit/alarmmanager/alarmerror/maximumlimitreached)).
  The number is not documented. cedo holds one alarm at most.
- `cancel(id:)` "Deletes the alarm from the system"
  ([Apple](https://developer.apple.com/documentation/alarmkit/alarmmanager/cancel%28id:%29)).
  `pause(id:)` works "if it's in the countdown state"; `resume`, `stop` and `countdown` (repeat or
  snooze) complete the set.
- **There is no update.** `AlarmManager` has `schedule`, `countdown`, `cancel`, `stop`, `pause` and
  `resume`, and nothing else (the SDK interface). So +30 s is a cancel and a new schedule.
- Pause and resume have no use here: a rest does not pause.

**Sound.** "If you don't specify a sound parameter, your alarm will use a default system sound." A
custom one is ActivityKit's `AlertSound.named(_:)`, a file "either in your app's main bundle or
Library/Sounds folder of your app's data container" (WWDC25 230). No length or format limit is
documented for alarms.

**What the alert can say.**
- **One title.** `AlarmPresentation.Alert` takes `title: LocalizedStringResource` and buttons, and
  no body ([Apple](https://developer.apple.com/documentation/alarmkit/alarmpresentation/alert-swift.struct)).
  The system adds the app's name and Stop. "Rest over" fits.
- **The set's text has no field.** It goes in the title, or it shows only in the countdown's Live
  Activity, carried in `metadata`. How a long title is cut is not documented.
- **A documentation error.** Apple's `AlarmConfiguration` overview shows an `alertConfiguration:
  AlertConfiguration(title:body:sound:)` argument. No declared initializer has it, on Apple's pages
  or in the SDK interface. It is not an API.
- **Opening the session.** Either button can run an App Intent: the configuration takes a
  `stopIntent` and a `secondaryIntent`. "You can provide a custom app intent for the stop button or
  for the secondary button" (WWDC25 230). The sample's second button, with `.custom` behaviour, is
  "an `Open` action to launch the app", and its intent sets "the openAppWhenRun flag". Whether Stop
  should also open the app is the owner's call (**inference** that it can).

**On a free team and under AltStore.**
- Nothing to sign: no entitlement, and the usage string is an `Info.plist` key, which re-signing
  keeps (**inference**; not built).
- Push and Time Sensitive, which re-signing drops (§1), are not involved.
- An AltStore build is a different app from a store build (`…cedo.<TEAMID>`), so it asks for
  authorization on its own (**inference**).
- AltStore checks every key matching `NS…UsageDescription…`, in the app and in its extensions,
  against the source's `privacy` list
  ([`VerifyAppOperation.swift`](https://github.com/altstoreio/AltStore/blob/bbc10d6964185b75a46c6ddd7476ac08df095308/AltStore/Operations/VerifyAppOperation.swift#L198-L215),
  `AltStoreCore/Extensions/Regex+Permissions.swift`). So `NSAlarmKitUsageDescription` must be in
  the source.

#### Two shapes for cedo: alert only, or countdown

| | **Alert only:** an alert at the rest's end | **Countdown:** a countdown, then the alert |
| --- | --- | --- |
| Configuration | `.alarm(schedule: .fixed(now + left))`, alert presentation only | `.timer(duration: left)`, alert and countdown presentations |
| Before it rings | Nothing (**inference**) | The countdown on the Lock Screen, in the Dynamic Island and in StandBy |
| Widget extension | None (**inference**, above) | Required: an `ActivityConfiguration` for `AlarmAttributes<RestMetadata>` |
| The set's text | Only in the title | In the Live Activity, from `metadata` |
| App IDs on a free team or AltStore | One | Two |
| Effort | S | M |

- **Both end the same way:** an alarm with Stop, through Silent and Focus.
- **Apple sees this use.** "Alarms are a great fit for countdowns with a specific interval, like a
  cooking timer". WWDC25 230 also asks: "If your alarm supports a countdown, consider including the
  key elements of the countdown in your Live Activity".
- **It may still be more than a two-minute rest wants** (open question 7).

#### The local notification beside it

- **Scheduling.** `expo-notifications` with a `TIME_INTERVAL` trigger of `left` seconds. Title "Rest
  over", body the set's text, and `data: { url }`.
- **Opening the session.** Expo: "opening the URL is your responsibility". Its Expo Router example
  reads `data.url` and calls `router.push`, and `getLastNotificationResponseAsync()` covers a cold
  start ([Expo](https://docs.expo.dev/versions/latest/sdk/notifications/)). The session is at
  `/today/session/<id>` (`apps/app/src/lib/session-return.tsx`).
- **Moving it.** Schedule again under the same identifier. "If the identifier matches a pending
  request, the new request replaces the pending request"
  ([Apple](https://developer.apple.com/documentation/usernotifications/unnotificationrequest/init%28identifier:content:trigger:%29)).
  One fixed identifier, `rest`, makes every schedule replace the last.
- **Cancelling it.** `cancelScheduledNotificationAsync('rest')`, which resolves even when nothing is
  scheduled. `dismissNotificationAsync` removes one already shown, once the next set is logged
  (Expo).
- **With the app in front.** A `setNotificationHandler` that returns `shouldShowBanner`,
  `shouldShowList` and `shouldPlaySound` as false keeps it quiet (Expo). The open-app chime speaks
  instead.
- **Time Sensitive.**
  - It breaks through "system controls such as Notification Summary and Focus", not the Silent
    switch
    ([Apple](https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive)).
  - Apple deprecated the authorization option for it: "Use time-sensitive entitlement"
    ([Apple](https://developer.apple.com/documentation/usernotifications/unauthorizationoptions/timesensitive)).
  - That entitlement is paid-only: a free team cannot sign it, and AltStore drops it (§1). What iOS
    does with `timeSensitive` when the entitlement is missing is not documented.
  - **Recommendation:** leave it out. On iOS 26+ AlarmKit covers Focus and Silent, on any team.
    Below 26, it would cost an `app.config.ts` branch for one paid-only key.

#### How the two split the job

**One channel per rest, never both.** Two alerts for one rest is the double alert to avoid.

| On this phone | The rest's end is told by |
| --- | --- |
| Opted out ("Tell me when rest is over" off) | Nothing. With the app in front, the open-app chime still plays (its native counterpart: "Background audio", above). |
| iOS below 26 | The notification |
| iOS 26+, the alarm not chosen, or AlarmKit denied | The notification |
| iOS 26+, the alarm chosen and authorized | The alarm |
| The alarm fails to schedule (`maximumLimitReached`, or denied since) | The notification, at once |

- **Choosing.** The Settings switch decides whether to tell. A second choice, on iOS 26+ only,
  decides how loud (**owner**, open question 7). AlarmKit's prompt comes when the alarm is chosen,
  not on the first rest.
- **With the app in front.** The notification is silenced by its handler, and the chime plays. An
  alarm has no such handler in the API. If it shows over the open app, the chime should stay quiet
  while an alarm is set (**inference**; check on the phone).
- **What each event does.** Each event becomes one of two commands, cancel or schedule:

| Event | Notification | Alarm |
| --- | --- | --- |
| A set logged, with a rest after it | Schedule `rest` at `left` | Cancel the one held; schedule |
| +30 s, tapped here or read from the server | Schedule `rest` at the new `left` | Cancel; schedule |
| Skip | Cancel | Cancel |
| Undo | Cancel. The earlier rest is not told again, as it does not chime (`chimesAtEnd`). | Cancel |
| A set logged with no rest after it | Cancel | Cancel |
| Finishing or deleting the session | Cancel | Cancel |
| Signing out, or the opt-in turned off | Cancel | Cancel |
| The app opened | Cancel all, then schedule what the running rest says | Same, read from `AlarmManager.alarms` |

The last row also covers a phone killed mid-rest. With one identifier and one alarm at most,
"cancel all, then schedule" is always correct (**inference**).

#### Writing the bridge ourselves

**A local Expo module.**
- `npx create-expo-module@latest --local` "is the recommended way to create a local Expo module".
  It makes `modules/<name>/` with `android/`, `ios/`, `src/`, `expo-module.config.json` and
  `index.ts`, and "You have to repeat the build step anytime you make a change to the native code"
  ([Expo](https://docs.expo.dev/modules/get-started/)).
- Autolinking searches `nativeModulesDir`, which "defaults to `"./modules"`", relative to the app's
  root ([Expo](https://docs.expo.dev/modules/autolinking/)): `apps/app/modules/` here. Nothing goes
  in `package.json` (**inference**; the page does not say).
- **Not named `AlarmKit`.** `create-expo-module` keeps a list of Apple's framework names because
  "Using one of these names for a module podspec will cause build conflicts on iOS", and `AlarmKit`
  is on it
  ([`appleFrameworks.ts`](https://github.com/expo/expo/blob/776cd2a3dbd52a75b01004955a6c709e56bf3d2d/packages/create-expo-module/src/appleFrameworks.ts)).
  Call it `rest-alarm`.
- **Its surface:** `isSupported()`, `authorize()`, `schedule(seconds, title, url)` and
  `cancelAll()`. It takes seconds, never a date, and builds the `Date` itself (below).
- **Below iOS 26.** The app targets 16.4, so every AlarmKit call sits behind
  `if #available(iOS 26, *)`, and the framework must be linked weakly.
  - `react-native-ios-alarmkit` says an app using it "can target iOS 15.1+", so it can be done
    ([README](https://github.com/sauravhiremath/react-native-ios-alarmkit)).
  - `expo-alarm-kit` instead requires a deployment target of 26.0.
  - **Check on the first build** that the app opens on iOS 25 or below.
- **The `Open` button's App Intent.** Apple's sample keeps it in the app. Whether the system finds
  an intent compiled into a module's pod is **not verified**. `react-native-ios-alarmkit` copies its
  intents file into the app target when CocoaPods links dynamically, and needs no copy when it links
  statically.

**The `Info.plist` key needs no plugin.** It is `ios.infoPlist.NSAlarmKitUsageDescription` in
`app.json`, beside the keys step 3 adds. A config plugin is needed only for the countdown's
extension.

**The widget extension, for the countdown only.** Expo: "You can add an app extension to your project by
writing a config plugin (or using a library that creates an extension with its own config
plugin)". Paid EAS builds also need it declared in `extra.eas.build.experimental.ios.appExtensions`
([Expo](https://docs.expo.dev/build-reference/app-extensions/)).

| Route | What it is | Cost |
| --- | --- | --- |
| **`@bacons/apple-targets`** | A config plugin only. Swift files go in `targets/<name>/` with an `expo-target.config.js`, and are linked into the generated project. An App Group only if one is configured ([README](https://github.com/EvanBacon/expo-apple-targets)). 5.0.0 on 2026-07-17; last push 2026-11-06. | One dev dependency. CocoaPods ≥ 1.16.2, which step 4 installs (1.17.0). |
| **A hand-written plugin** | `withXcodeProject`, adding a native target, its build configurations, a product file, an "Embed Foundation Extensions" phase, a target dependency and a group | `expo-widgets`' own helpers for this are 519 lines of TypeScript, the eight files of [`plugin/src/ios/xcode/`](https://github.com/expo/expo/tree/d26d33f25da24a3bc033a297674b7d3d5e9b065c/packages/expo-widgets/plugin/src/ios/xcode). One fixed target: 250–400 (**inference**). |

**The smallest honest estimate** (**inference**; nothing is written yet):

| Piece | Alert only | The countdown adds |
| --- | --- | --- |
| Swift module: authorize, schedule, cancel, list | 100–150 lines | The countdown presentation and `RestMetadata` |
| The `Open` App Intent | ~20 lines | — |
| TypeScript wrapper and the `Platform.OS` adapter | ~60 lines | — |
| `app.json` | One key | The extension's config |
| Widget extension: SwiftUI for the Lock Screen and the Dynamic Island's compact, minimal and expanded forms | — | 80–120 lines, plus its `Info.plist` |
| The target in the Xcode project | — | ~15 lines of `@bacons/apple-targets` config, or 250–400 of plugin |
| The plain module and its tests (below) | Shared with the notification | — |

**Community modules.** Checked on npm and GitHub on 2026-11-07. None makes the widget extension.

| Package | Latest | Notes |
| --- | --- | --- |
| [`react-native-ios-alarmkit`](https://github.com/sauravhiremath/react-native-ios-alarmkit) | 1.0.0, 2026-10-23 | A Nitro module, so it adds `react-native-nitro-modules`. One maintainer, 3 stars, ~400 downloads a week. Its plugin "does not select linkage, add permissions, or create a widget extension". A no-op below iOS 26. |
| [`expo-alarm-kit`](https://github.com/nickdeupree/expo-alarm-kit) | 0.1.11, 2026-04-15 | An Expo module, ~560 downloads a week. Deployment target 26.0, set by hand in Xcode. An App Group passed to `configure()`, which AltStore renames. No licence on GitHub. |
| [`react-native-nitro-ios-alarm-kit`](https://github.com/Gautham495/react-native-nitro-ios-alarm-kit) | 1.0.41, 2026-05-14 | A Nitro module, ~460 downloads a week. Not read further. |
| Others (`rn-native-alarmkit`, `@asleep-ai/react-native-alarm`, `@klyftig/alarm-kit`, …) | | Under 30 downloads a week, or built for wake-up alarms |

None is a reason to skip the local module. AlarmKit's surface is small, and the extension is ours
to write either way.

#### Lock Screen and Dynamic Island without `expo-widgets`

- **On iOS 26+, AlarmKit's countdown is the Live Activity.** The system starts it with the alarm,
  updates its state and ends it with the alert. The app never calls ActivityKit itself
  (**inference** from `AlarmPresentationState` being "system managed").
- **The minimum extension.** One `Widget` with an `ActivityConfiguration(for:
  AlarmAttributes<RestMetadata>.self)`: a Lock Screen view and the Dynamic Island's three forms.
  - The countdown is `Text(timerInterval:countsDown:)` to the `fireDate` the system hands it.
  - `RestMetadata` conforms to `AlarmMetadata` ("Decodable, Encodable, Hashable, Sendable") and
    carries the set's text.
  - The same Swift file is compiled into both targets (**inference**: the usual way, not read in
    Apple's sample).
- **No App Group.** The extension reads only what ActivityKit hands it: WWDC25 230's example reads
  `context.attributes.metadata`. No shared container is involved, so AltStore's renaming of groups
  never reaches it (**inference**; not built).
- **The size limit.** "Static and dynamic data for a Live Activity… can't exceed a combined size of
  4 KB" ([Apple](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)).
  A set's text is far below it.
- **What it still costs.**
  - A second App ID, on a free team and under AltStore (§1).
  - AltStore offers to strip extensions at install. Without the extension, a countdown alarm "may
    unexpectedly dismiss alarms and fail to alert". So the module looks for its `.appex` in the app
    bundle, and falls back to an alert only when it is missing (**inference**: a file check, not an
    API).
- **After a restart.** "If your alarm supports countdown functionality, the system will guarantee
  that a countdown interface will be shown." Before the first unlock "your Live Activity cannot be
  shown", and "you can still customize the system's presentation of your countdown" (WWDC25 230),
  with `AlarmPresentation.Countdown`'s title (**inference**).
- **`NSSupportsLiveActivities`.** Whether AlarmKit's Live Activity needs it is not documented. Set
  it; it costs nothing.
- **Below iOS 26** there is no AlarmKit, so no countdown on the Lock Screen. A Live Activity of
  cedo's own would fit in the same extension, still without an App Group. But the app would then
  start and end it itself. **Recommendation:** not first.

**`expo-widgets`: the option not taken.**
- Its Live Activity reads its layout only from the App Group, which AltStore renames (§1). A patch
  would fix it, but that is a patch to carry.
- It cannot draw an alarm's countdown. Nothing in Expo's repository mentions `AlarmAttributes`, and
  AlarmKit appears only in `create-expo-module`'s list of framework names (**inference** from a
  GitHub code search on 2026-11-07).
- What it would still give: layouts written in JavaScript, and home-screen widgets. If widgets are
  wanted later, it comes back, with its App Group question.

#### Android, briefly

| Need | Android | `expo-notifications` 58.1.x | Else |
| --- | --- | --- | --- |
| The alert on time | `setAlarmClock`: "the system never adjusts their delivery time… leaves low-power modes if necessary to deliver the alarms" ([Android](https://developer.android.com/develop/background-work/services/alarms/schedule)) | `delivery: 'alarmClock'` (58.0.0), on a `DATE` trigger, not on `TIME_INTERVAL`. "The status bar shows an alarm icon until the notification is delivered." Without the permission it is scheduled "as `'bestEffort'`" ([`Notifications.types.ts`](https://github.com/expo/expo/blob/b76ddd7b732eef9957d75b85100e68a1a968118c/packages/expo-notifications/src/Notifications.types.ts#L140-L153)). | — |
| The permission | `SCHEDULE_EXACT_ALARM`: "Granted by the user", revocable, "not pre-granted to fresh installs" targeting 13+. `USE_EXACT_ALARM`: "Granted automatically", "Cannot be revoked by the user", limited by Play policy (same page; §4 above). | `getExactAlarmPermissionsAsync` and `requestExactAlarmPermissionsAsync` since 58.1.1 ([CHANGELOG](https://github.com/expo/expo/blob/b76ddd7b732eef9957d75b85100e68a1a968118c/packages/expo-notifications/CHANGELOG.md)). Its manifest declares neither permission; the app adds one. | — |
| Sound through silent mode | `setAlarmClock` only fires an intent: "the application will further wake up the device to tell the user about the alarm -- turning on the screen, playing a sound" ([Android](https://developer.android.com/reference/android/app/AlarmManager)) | A notification on its channel (**inference**: it follows the ringer) | A local module on the alarm stream; not researched |
| A countdown in the shade | `setUsesChronometer` and `setChronometerCountDown` (API 24) | No. Its Android content fields are `sticky`, `autoDismiss`, `priority`, `vibrate` and `color`. | A local module (Kotlin) |
| A status-bar chip (Android 16) | A Live Update: ongoing, a title, `POST_PROMOTED_NOTIFICATIONS`, `setRequestPromotedOngoing`. "The Chronometer timer is shown in the chip as long as it is positive." For activities "explicitly triggered by the user, such as starting a workout"; "alerts" are listed as inappropriate ([Android](https://developer.android.com/develop/ui/views/notifications/live-update)) | No | The same local module |

A `DATE` trigger at the phone's own now + `left` keeps §5's rule: no server time enters it.

#### Keeping the PWA working, and invariant 7

**The layout** (a sketch):

```
apps/app/
  modules/rest-alarm/            local Expo module, autolinked
    ios/RestAlarmModule.swift    AlarmKit, behind #available(iOS 26, *)
    index.ts                     requireNativeModule('RestAlarm')
  targets/rest-countdown/        the countdown only: the widget extension (@bacons/apple-targets)
  src/lib/rest-alert.ts          plain: what to schedule or cancel, given the rest and the event
  src/lib/rest-alert.test.ts     bun test, with a fake scheduler
  src/lib/rest-alert-device.ts   Platform.OS: a no-op on web; on native, lazy imports of
                                 expo-notifications and modules/rest-alarm
```

- **The adapter has `token-storage.ts`'s shape.** One file, `Platform.OS`, and `await import(…)`
  inside the native branch, so the web bundle never evaluates a native module. On web it does
  nothing, and the PWA keeps its chime (`src/lib/chime.ts`).
- **The plain module, `apps/app/src/lib/rest-alert.ts`.** No React, no React Native.
  - In: the rest as `restPhase` gives it (running with `left`, over, or none); the session's ID and
    the set's text; the opt-in; what the phone can do (alarm supported, authorized, extension
    present); what it has scheduled.
  - Out: commands, `cancel` or `schedule { channel, seconds, title, body, url }`.
  - It holds both tables above. It is tested with a fake scheduler, as `session.test.ts` uses a fake
    keychain.
- **Invariant 7's list gains it.** CLAUDE.md's list of state only the app owns ends "and when a plan
  edited in place is saved". It would gain "and what this phone has set to tell when a rest is
  over", with `apps/app/src/lib/rest-alert.ts` among its files. `docs/10-testing.md`'s paragraph on
  the same exception gains it too.
- **The text is the contract's.** "Barbell Back Squat — Set 3 of 5: 5 × 102.5 kg" formats a
  measurement, so it is a contract function (T1), as §5 says.
- **Seconds, not `endsAt`.** Every channel is scheduled from `restPhase(...).left`, which the
  contract already clamps (§5, item 4).
  - The notification takes it as a `TIME_INTERVAL`.
  - The alarm module turns it into `Date.now + left` in Swift for `.fixed`, or passes it as the
    timer's `duration`.
  - Android takes a `DATE` of the phone's now + `left`.
  - The server's `endsAt` is never read as a date on the phone.

**What only a device can test.**
- The notification with the app in the background, locked and killed; its tap opening the session,
  from a cold and a warm start.
- +30 s moving it, and each cancelling event, seen on the Lock Screen.
- AlarmKit's prompt and its text; the alarm through Silent and Focus, and on a paired Watch.
- What an alarm shows over the open app.
- How a long title is cut, if the set's text goes in it.
- The `Open` button: whether it opens the app, and where.
- The countdown on the Lock Screen, in the Dynamic Island and in StandBy; after a restart
  before the first unlock; with the extension stripped.
- A free-team build signing with no entitlement. An AltStore-re-signed build that still alarms, and
  still shows the countdown.
- The app opening on iOS below 26 with AlarmKit linked weakly.
- Not on the simulator: `react-native-ios-alarmkit` says AlarmKit "Requires physical device -
  Simulator has limited support" (README, above).

#### Recommendation

1. **First, the notification.** `expo-notifications` with `enableRemoteNotifications: false`, a
   `TIME_INTERVAL` trigger and one identifier. It works on every iOS the app supports, on a free
   team and under AltStore. **S.**
2. **Then AlarmKit, alert only,** as the opt-in "through Silent" choice on iOS 26+. A local Expo
   module, `rest-alarm`, of about 150 lines of Swift. No extension, no App Group, no plugin. One
   channel per rest, never both. **S–M.**
3. **The countdown only if the owner wants it on the Lock Screen.** One hand-written SwiftUI
   extension reading `AlarmAttributes`, added with `@bacons/apple-targets` rather than 250–400
   lines of our own plugin. No App Group, so AltStore's renaming does not touch it. **M.**
4. **Not `expo-widgets`.** Its App Group breaks under AltStore, and it cannot draw an alarm's
   countdown.
5. **Android later.** `expo-notifications`' `alarmClock` delivery and the exact-alarm permission
   cover the alert. The countdown and the Live Update need a Kotlin module.

## 5. Keeping the PWA working

### What is in the repo today

| Where | On native today |
| --- | --- |
| `apps/app/src/api/http.ts` `resolveBaseUrl()` | Web: `/api`. Native: `process.env.EXPO_PUBLIC_API_URL`, or it **throws**, so one build per instance (#10). `transport` takes `baseUrl: () => string`, so a runtime value fits without changing the client. |
| `apps/app/src/auth/token-storage.ts` | Already native-ready. It branches on `Platform.OS`: `expo-secure-store`, imported lazily, on native; `localStorage` on web. |
| `apps/app/src/lib/chime.ts` | Web Audio and `navigator.vibrate`, both guarded to web. On native a rest ends **silently** today. |
| `apps/app/src/lib/rest-clock.ts` | Counts the rest with the contract's `restPhase`, and calls `chime()` at its end only while the screen is mounted. |
| `apps/app/src/api/retry.ts` `newIdempotencyKey` | Fills with `crypto.getRandomValues` by default. Neither React Native 0.88's `Libraries/` nor Expo 58's native globals (`expo/src/winter/runtime.native.ts`: `URL`, `URLSearchParams`, `TextDecoderStream`, `DOMException`, `structuredClone`, `fetch`) install `crypto`. Read in `node_modules`, not run, so **logging a set may throw on native**. Whether Hermes provides it is not verified. `expo-crypto` is the Expo route. |
| TanStack `onlineManager` (the offline queue, #9) | Not wired; the default listens to `window`'s `online`/`offline`. Its source: "addEventListener does not exist in React Native, but window does", so on native it is always online ([query-core 5.104.3](https://github.com/TanStack/query/blob/v5.104.3/packages/query-core/src/onlineManager.ts)). **Inference:** a set logged without a signal is not paused but fails, is retried up to `MAX_SENDS`, then dropped. TanStack's React Native page wires `onlineManager` to NetInfo or `expo-network`, and `focusManager` to `AppState` ([TanStack](https://tanstack.com/query/v5/docs/framework/react/react-native)). |
| `apps/app/src/ui/video-player.tsx` | Plays an embed only on web. |
| `apps/app/app/_layout.tsx`, `src/pwa/*` | The service worker is registered only on web, only in a build. The rest of `src/pwa/` is never imported on native. |

### How native-only code should sit beside the web build

1. **One file per capability, branching on `Platform.OS`, with the native module imported lazily**
   inside the native branch. `token-storage.ts` is the model.
   - **Why not `.ios.ts` / `.web.ts`:** the repo imports with explicit `.ts` extensions, which
     resolve the literal file and skip platform variants. CLAUDE.md and `docs/08-frontend.md`
     record the sign-in that died on that.
   - **It costs the web bundle nothing.** Expo's production bundles remove code "used conditionally
     based on the `Platform` module… applies to instances where `Platform.select` and `Platform.OS`
     are directly imported from react-native in each file", and not through a re-export
     ([Expo](https://docs.expo.dev/guides/tree-shaking/)).
2. **On web a native module must never be reached.**
   - `expo-notifications`' `scheduleNotificationAsync` throws `UnavailabilityError` on web.
   - `expo-secure-store` has no web module.
   - `expo-audio`'s `setAudioModeAsync` is a no-op there.

   The branch makes each capability a no-op on web. The PWA's behaviour — the open-app chime — is
   the web branch.
3. **Rules in the contract, app-owned state in a plain module, the native call in an adapter.**
   This fits invariant 7 and ADR-0017's amendment.
   - **Contract (T1).** Which rest runs and when it ends is already there: `restOf`, `restPhase`,
     `restCounted`. What the alert says — "Barbell Back Squat — Set 3 of 5: 5 × 102.5 kg", agreed
     in #39 — formats measurements, so it belongs in the contract too.
   - **A plain app module (T1 app module).** It knows what this phone has scheduled, and when to
     schedule, move or cancel, for:
     - a set logged;
     - +30 s;
     - skip;
     - undo;
     - the next set;
     - finishing;
     - deleting.

     One rest is told at a time, by the notification or by the alarm, under one identifier, so a
     second schedule replaces the first. Tested with a fake scheduler, as `session.ts` is tested
     with a fake keychain. Like the session, it is state only the app owns, so **invariant 7's
     list in CLAUDE.md and `docs/10-testing.md` would gain an entry**: what this phone has set to
     tell (`src/lib/rest-alert.ts`; §4, "Rest's end on the device only").
   - **An adapter: one file, `Platform.OS`, lazy imports** of `expo-notifications` and the local
     `rest-alarm` module. Its call sits beside `useRestClock`, which already sees each phase,
     `extend` and `skip`, and beside the session's undo, finish and delete mutations. No component
     decides anything.
4. **Schedule from what the phone counts, not from the server's `rest_ends_at` read as a date.**
   - ADR-0025: the phone counts its own rest — offline too — and takes the server's end when it is
     the same rest and later (`restCounted`).
   - CLAUDE.md records that a server timestamp read by the device's clock is skewed. `restLeft` and
     `restRemaining` clamp it, so a rest never counts more than its length.
   - So: schedule the notification with a **time interval of `restPhase(...).left` seconds**, and
     the alarm at the phone's own now + left (`.fixed`, or a timer of `left` seconds, whose
     countdown the system draws). Do not use a `DATE` trigger at `endsAt`, which would carry the
     skew the contract was written to absorb (**inference** from the two).
   - Re-schedule whenever `restCounted` moves: a +30 s tapped on another device reaches this phone
     at its next read of the session.
   - **Inference:** while the app is suspended no read happens, so the alert may fire at the old
     time. That is acceptable, or the reason for push (#39).
5. **Native setup lives in config, not in code paths web can see.** Config plugins, `app.json`
   `ios.infoPlist` and entitlements, the local module under `modules/`, and, for AlarmKit's
   countdown, a SwiftUI widget extension in `targets/`. The module's `index.ts` is reached only
   from the adapter's native branch, and its Swift and the extension never reach the web bundle.

---

## Native capabilities at a glance

Effort is a rough estimate for this codebase: **S** a few days, **M** about a week, **L** more.

| Capability | iOS API | Android equivalent | Expo route | Works with the app not running? | Needs push / APNs? | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| Rest-over alert with sound | UserNotifications, `UNTimeIntervalNotificationTrigger` | Notification + exact alarm (`SCHEDULE_EXACT_ALARM`, denied by default on 14+) | `expo-notifications` ≥ 58.1.0, `enableRemoteNotifications: false`. Exclusive with the AlarmKit alarm, one per rest. | Yes; the sound obeys the Silent switch | No | S |
| Through Focus | `interruptionLevel: timeSensitive` + its entitlement (paid only) | Channel importance high | `expo-notifications` + `ios.entitlements` | Yes; not through Silent | No (paid capability) | S |
| Through Silent and Focus | AlarmKit (iOS 26+): an alarm at a fixed time, alert only. No entitlement; `NSAlarmKitUsageDescription` and the user's consent. | `setAlarmClock`: `expo-notifications`' `delivery: 'alarmClock'` on a `DATE` trigger; a sound through silent mode needs a local module | None first-party. A local Expo module (Swift, ~150 lines). No extension, no App Group (**inference**). | Yes | No | S–M |
| Lock Screen / Dynamic Island countdown | iOS 26+: AlarmKit's countdown, a Live Activity the system runs, drawn by a hand-written widget extension reading `AlarmAttributes`. Below 26: none (an ActivityKit Live Activity of cedo's own, not first). | Ongoing notification with a countdown chronometer; Live Update chip (Android 16 QPR2) | The widget extension via `@bacons/apple-targets` or a hand-written plugin; a Kotlin module on Android. `expo-widgets` not taken: App Group, AltStore. | The system ticks it and ends it in the alarm | No | M |
| Home-screen widget | WidgetKit timeline, App Group | Glance / RemoteViews (≥ 30 min) | `expo-widgets` (Android: `enableAndroid`), with its App Group, which AltStore renames (§1) | Shows the last snapshot; cannot fetch | No (`WidgetPushHandler`, iOS 26, would) | M |
| Chime with the app open | `AVAudioSession` ambient/playback, `duckOthers` | SoundPool / MediaPlayer | `expo-audio`, `enableBackgroundPlayback: false` | n/a | No | S |
| Background audio | `UIBackgroundModes audio` + `.playback` | `mediaPlayback` service + MediaSession | `expo-audio` (adds `audio` by default) | Only while audio plays; review risk (2.5.4) | No | — not recommended |
| Keep a workout alive in the background | None on iPhone (`workout-processing` is watchOS only) | Foreground service of type `health` (`FOREGROUND_SERVICE_HEALTH` + a prerequisite permission; a Play declaration) | Custom module or config plugin | Yes | No | M |
| Tell other devices | APNs with the team key | FCM | `expo-notifications` remote + a relay (Expo Push Service or the publisher's own) | Yes | **Yes** | L, plus a third party |

---

## Open questions for the owner

1. **Who is the seller?** An individual (the owner's legal name is the seller; as an EU trader,
   their address, phone and email are published) or an organization (a legal entity and a D-U-N-S
   number)? And is cedo "trader" activity at all?
2. **The bundle ID.** It is permanent once a build is uploaded.
3. **A demo for App Review.** A dedicated demo instance, or a non-expiring account on
   the owner's live instance, which holds real data? It must be up for every review.
4. **Account deletion (5.1.1(v)).** Build it, with what it does to groups and shared plans, or leave
   registration out of the native app?
5. **Plain HTTP hostnames.** Refuse them (HTTPS except IPs and `.local`), or set
   `NSAllowsArbitraryLoads`, justify it at review, and match every app surveyed?
6. **Versions.** Which server versions a given app version accepts, and how a mismatch is said.
   `VERSION` is `0.0.0`.
7. **How loud is "rest over"?** A notification that the Silent switch mutes, or, on iOS 26+, an
   AlarmKit alarm that rings through Silent and Focus until Stop? If both, the alarm as a second
   choice in Settings under "Tell me when rest is over", never both for one rest (§4, "Rest's end on
   the device only"). Time Sensitive is not recommended: paid-only, and AltStore drops it.
8. **Other devices (#39).** Drop the need, now that the phone schedules its own alert, or accept a
   relay and its third party?
9. **Expo's cloud.** An Expo account and Expo's build servers for the publisher are fine by "no
   cloud account" (that promise is to self-hosters)? Or local builds only (`eas build --local`
   still needs the Expo login)?
10. **Android, and when.**
    - Play: 25 USD once, and a closed test with 12 testers for 14 days before production
      ([Play](https://support.google.com/googleplay/android-developer/answer/14151465)).
    - Or an APK: from 2027 even sideloaded apps need a verified developer
      ([Android](https://developer.android.com/developer-verification)).
11. **A native UI tier.** Simulator screenshots, Maestro, or neither until there is native-only UI?
    Either way, an amendment to ADR-0017.
12. **An AltStore Classic build** (§1). Make one after step 9, for the owner's own phone? It needs:
    - a release process (`VERSION` is `0.0.0`);
    - a public home for the `.ipa`, since the repository is private: a public releases repository,
      say;
    - a macOS CI job, billed by the minute while the repository is private;
    - and, for `expo-widgets`' widgets in that build, a patch to it. AlarmKit and its countdown need
      none.
13. **Every instance an AltStore source?** Should every instance serve `/altstore/source.json` by
    default (shape B in §1), or only when the self-hoster turns it on? It works only over HTTPS, and
    only for people who already sideload.
14. **The countdown on the Lock Screen.** On iOS 26+, an alarm at the rest's end only (no extension,
    one App ID), or AlarmKit's countdown first (a SwiftUI extension, a second App ID)? Below iOS 26
    there is no countdown either way, unless cedo runs a Live Activity of its own.
15. **What the alarm's title says.** The alert has one title and no body. "Rest over" alone, or
    with the set's text in it, cut where iOS cuts it?
16. **Who adds the extension**, if there is one: `@bacons/apple-targets`, one maintained dev
    dependency, or a plugin of our own of 250–400 lines?

## What could not be verified

- **Expo Go and SDK 58.** Whether the App Store's Expo Go runs SDK 58 today; Expo's own pages
  disagree. Irrelevant if development builds are used.
- **The simulator and `localhost`.** That the simulator reaches the Mac's `localhost`; no Apple or
  Expo page found.
- **`expo-notifications` with the plugin listed.** That `enableRemoteNotifications: false` wins
  over prebuild's auto-applied defaults; read from source, not built.
- **`crypto.getRandomValues` on Hermes.** Its absence on native is read from source, not run.
- **Local network keys.** That `NSAllowsLocalNetworking` permits cleartext as well as IP
  addresses.
- **Local notifications and `aps-environment`.** That they need no `aps-environment`. Strongly
  implied; never stated by Apple.
- **AlarmKit and Live Activities on a free personal team, and after AltStore re-signs.** Inferred
  from their not being on Apple's capabilities list, and from AlarmKit having no entitlement. Not
  built.
- **An alert-only alarm without a widget extension.** Apple ties the extension to "a countdown
  presentation"; no page says an alarm with no countdown is safe without one.
- **AlarmKit's countdown under AltStore.** That its extension reads `AlarmAttributes` from ActivityKit
  and nothing the rename touches. Read in Apple's docs and AltSign, not run.
- **What an alarm shows over the open app**, and how a long alarm title is cut.
- **The number of alarms allowed.** `maximumLimitReached` exists; its limit is not documented.
- **An alarm's custom sound.** No length or format limit is documented for alarms.
- **`alertConfiguration`.** Shown in Apple's `AlarmConfiguration` overview, absent from every
  declared initializer and from Xcode 27.2's SDK. Taken as a documentation error.
- **`NSSupportsLiveActivities` for AlarmKit.** Whether its Live Activity needs the key.
- **AlarmKit below iOS 26.** That a module calling it behind `#available` lets the app open on
  iOS 16.4–25. A community module says so; not built here.
- **The `Open` button's App Intent in a pod.** Whether the system finds an App Intent compiled into
  a local module rather than the app target.
- **The metadata type in two targets.** That the same Swift file compiled into the app and the
  extension decodes as one `AlarmAttributes<RestMetadata>`; Apple's sample was not opened.
- **An extension stripped by AltStore.** That a check for the `.appex` in the bundle is enough to
  fall back to an alert only.
- **A `timeSensitive` notification without its entitlement.** What iOS does with it is not
  documented.
- **Local modules and `package.json`.** That a module in `modules/` needs no entry there; Expo's
  page says only that the directory is searched.
- **What Apple says the stale date does.** Whether a Live Activity re-renders by itself at its
  `staleDate`: Expo says yes, and Apple's pages are ambiguous.
- **The EU travel grace.** Whether the 90-day window is live, which depends on iOS 27.2.
- **AltStore PAL's price to users.** That it is free, stated only on the founder's own blog.
- **The paid program for a marketplace app, in one Apple sentence.** No Apple page says it outright.
  It follows from four Apple pages (§1, "The EU terms"), and AltStore states it.
- **AltStore Classic and plain HTTP.** That a source or an `.ipa` over HTTP is refused. Inferred
  from AltStore's `Info.plist`, which has no ATS exception, and from Apple's ATS page; not tried.
- **An unsigned `.ipa` and App Groups.** That it installs without any. Read in AltSign, not run.
- **`expo-widgets` under AltStore.** That the renamed App Group leaves a Live Activity with no
  layout, and a widget with no fresh data. Read in both sources, not run.
- **`CODE_SIGNING_ALLOWED=NO`.** Not in Apple's build settings reference.
- **The `.ipa`'s size.** Nothing is built yet.
- **A custom-scheme link from the installed PWA.** That `altstore-classic://` opens AltStore from a
  web app on the home screen.
- **`eas build --local` with `withoutCredentials`.** What it produces for a device is not
  documented.
- **Remote AltServer.** Who runs the servers, and what passes through them.
- **AltStore's own App IDs.** That it holds two of the ten, inferred from its Xcode project.
- **Private release assets.** That an `.ipa` attached to a release in a private repository cannot
  be downloaded without a token.
- **The free-team trust path.** The Settings → General → VPN & Device Management path; Expo's
  `expo.fyi`, not Apple.
- **CocoaPods on Ruby 4.0.** CocoaPods 1.17 on Homebrew's Ruby 4.0.
- **Android's limited-distribution cap.** 20 devices on most of Google's pages, 50 on one.
- **Exact alarms on Play.** Play's `USE_EXACT_ALARM` policy names "timer app" in one line and only
  "alarm or calendar" in another.
