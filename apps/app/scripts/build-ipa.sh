#!/usr/bin/env bash
# Builds what a release publishes for the iPhone app (#79, ADR-0032), into apps/app/build/:
# cedo-<version>.ipa, unsigned — AltStore signs every app with its user's own Apple ID — the
# AltStore source that lists it, and the icon both show.
#
# On macOS with Xcode, CocoaPods and Bun, from a checkout you can throw away: prebuild writes
# apps/app/ios/ from app.json afresh.
#
#   apps/app/scripts/build-ipa.sh
#
# .github/workflows/ios.yml runs it on a tag, then attaches the three files to that tag's release.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(bun -e "import { VERSION } from '@cedo/contract'; console.log(VERSION)")
IPA="cedo-$VERSION.ipa"
rm -rf build
mkdir -p build/Payload

./node_modules/.bin/expo prebuild --platform ios --clean
# Unsigned, for any Apple ID to sign: there is no certificate here, and none is needed.
xcodebuild archive -quiet \
  -workspace ios/cedo.xcworkspace -scheme cedo -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/cedo.xcarchive \
  CODE_SIGNING_ALLOWED=NO
cp -R build/cedo.xcarchive/Products/Applications/cedo.app build/Payload/
(cd build && zip -qry "$IPA" Payload)

bun run scripts/altstore-source.ts build/Payload/cedo.app "build/$IPA" > build/source.json
cp assets/icon.png build/icon.png
echo "Built build/$IPA, build/source.json and build/icon.png for cedo $VERSION."
