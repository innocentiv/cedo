#!/usr/bin/env bash
# Builds what a release publishes for the iPhone app (#79, ADR-0032), into apps/app/build/release/:
# cedo-<version>.ipa, unsigned — AltStore signs every app with its user's own Apple ID — the
# AltStore source that lists it, and the icon both show.
#
# On macOS with Xcode, CocoaPods and Bun, from a checkout you can throw away: prebuild writes
# apps/app/ios/ from app.json afresh.
#
#   apps/app/scripts/build-ipa.sh            # whatever VERSION says
#   TAG=v0.2.0 apps/app/scripts/build-ipa.sh # refused unless VERSION is 0.2.0
#
# .github/workflows/ios.yml runs it on a tag, then attaches build/release/ to that tag's release.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(bun -e "import { VERSION } from '@cedo/contract'; console.log(VERSION)")
if [ -n "${TAG:-}" ] && [ "$TAG" != "v$VERSION" ]; then
  echo "The tag is $TAG, but VERSION is $VERSION: cut a release with bun run release." >&2
  exit 1
fi
IPA="cedo-$VERSION.ipa"
rm -rf build
mkdir -p build/Payload build/release

./node_modules/.bin/expo prebuild --platform ios --clean
# Unsigned, for any Apple ID to sign: there is no certificate here, and none is needed.
xcodebuild archive -quiet \
  -workspace ios/cedo.xcworkspace -scheme cedo -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/cedo.xcarchive \
  CODE_SIGNING_ALLOWED=NO
cp -R build/cedo.xcarchive/Products/Applications/cedo.app build/Payload/

# AltStore checks the permissions of every extension an app embeds, and the source reads the app's
# alone (scripts/altstore.ts): an extension would make AltStore refuse it. Teach the source first.
if [ -d build/Payload/cedo.app/PlugIns ] && [ -n "$(ls -A build/Payload/cedo.app/PlugIns)" ]; then
  echo "The app embeds an extension, which the AltStore source does not list yet." >&2
  exit 1
fi

(cd build && zip -qry "release/$IPA" Payload)
bun run scripts/altstore-source.ts build/Payload/cedo.app "build/release/$IPA" > build/release/source.json
cp assets/icon.png build/release/icon.png
echo "Built build/release/: $IPA, source.json and icon.png, for cedo $VERSION."
