#!/usr/bin/env bash
# Builds the Safari version of the extension. Run this on a Mac with Xcode installed.
#
#   ./build-safari.sh            -> creates an Xcode project in ./safari-build
#   ./build-safari.sh --build    -> also builds the macOS app with xcodebuild
#
# Then open the project in Xcode and press Run (or open the built app), and enable
# the extension in Safari → Settings → Extensions.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
STAGING="$ROOT/safari-build/extension"
PROJECT_DIR="$ROOT/safari-build"
APP_NAME="Letterboxd DL"
BUNDLE_ID="${BUNDLE_ID:-com.blazgrilj.letterboxddl}"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun not found. Install Xcode from the App Store and run: xcode-select --install" >&2
  exit 1
fi

rm -rf "$PROJECT_DIR"
mkdir -p "$STAGING"

# Copy the extension, using the Safari manifest as manifest.json.
for item in "$ROOT"/extension/*; do
  name="$(basename "$item")"
  [[ "$name" =~ ^manifest\..+\.json$ ]] && continue
  [[ "$name" == "manifest.json" ]] && continue
  cp -R "$item" "$STAGING/"
done
cp "$ROOT/extension/manifest.safari.json" "$STAGING/manifest.json"

xcrun safari-web-extension-converter "$STAGING" \
  --project-location "$PROJECT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

PROJECT="$(find "$PROJECT_DIR" -maxdepth 3 -name '*.xcodeproj' | head -n 1)"
echo "Xcode project: $PROJECT"

if [[ "${1:-}" == "--build" ]]; then
  SCHEME="$(xcodebuild -list -project "$PROJECT" 2>/dev/null \
    | awk '/Schemes:/ {found=1; next} found && NF {sub(/^[ \t]+/, ""); print; exit}')"
  xcodebuild -project "$PROJECT" -scheme "${SCHEME:-$APP_NAME}" -configuration Release \
    -derivedDataPath "$PROJECT_DIR/DerivedData" \
    CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO build
  APP="$(find "$PROJECT_DIR/DerivedData" -name "$APP_NAME.app" -type d | head -n 1)"
  echo "Built app: $APP"
  echo "Open it once, then enable the extension in Safari → Settings → Extensions."
  echo "Unsigned builds need Safari → Develop → Allow Unsigned Extensions."
fi
