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

# The extension's bundle ID must start with the app's, but the converter doesn't
# always generate them that way. Set both explicitly: <id> and <id>.Extension.
PBXPROJ="$PROJECT/project.pbxproj"
EXT_BUNDLE_ID="$BUNDLE_ID.Extension"
echo "Bundle IDs from the converter:"
grep -o 'PRODUCT_BUNDLE_IDENTIFIER = [^;]*;' "$PBXPROJ" | sort -u | while IFS= read -r line; do
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::notice::converter $line"; else echo "  $line"; fi
done
sed -i '' -E \
  -e "/PRODUCT_BUNDLE_IDENTIFIER = [^;]*[Ee]xtension[^;]*;/s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/PRODUCT_BUNDLE_IDENTIFIER = \"$EXT_BUNDLE_ID\";/" \
  -e "/PRODUCT_BUNDLE_IDENTIFIER = [^;]*[Ee]xtension[^;]*;/!s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/PRODUCT_BUNDLE_IDENTIFIER = \"$BUNDLE_ID\";/" \
  "$PBXPROJ"
# The app looks its extension up by ID to show whether it's enabled.
find "$PROJECT_DIR" -name '*.swift' -exec \
  sed -i '' -E "s/(extensionBundleIdentifier = )\"[^\"]*\"/\1\"$EXT_BUNDLE_ID\"/" {} +
echo "Bundle IDs now:"
grep -o 'PRODUCT_BUNDLE_IDENTIFIER = [^;]*;' "$PBXPROJ" | sort -u | sed 's/^/  /'

if [[ "${1:-}" == "--build" ]]; then
  SCHEME="$(xcodebuild -list -project "$PROJECT" 2>/dev/null \
    | awk '/Schemes:/ {found=1; next} found && NF {sub(/^[ \t]+/, ""); print; exit}')"
  echo "Building scheme: ${SCHEME:-$APP_NAME}"

  # Build without signing (no Apple developer team needed), then ad-hoc sign below.
  LOG="$PROJECT_DIR/xcodebuild.log"
  if ! xcodebuild -project "$PROJECT" -scheme "${SCHEME:-$APP_NAME}" -configuration Release \
      -derivedDataPath "$PROJECT_DIR/DerivedData" \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" DEVELOPMENT_TEAM="" \
      build >"$LOG" 2>&1; then
    echo "xcodebuild failed. Errors:" >&2
    grep -E "error:|BUILD FAILED" "$LOG" | head -20 | while IFS= read -r line; do
      if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::error::$line"; else echo "$line" >&2; fi
    done
    tail -n 40 "$LOG" >&2
    exit 1
  fi

  APP="$(find "$PROJECT_DIR/DerivedData" -name "$APP_NAME.app" -type d -path '*/Release/*' | head -n 1)"
  if [[ -z "$APP" ]]; then
    echo "Built app not found" >&2
    exit 1
  fi

  # Ad-hoc sign (Apple Silicon refuses to run unsigned code), keeping the sandbox
  # entitlements that Safari requires for web extensions.
  find_entitlements() {
    find "$PROJECT_DIR" -path "$PROJECT_DIR/DerivedData" -prune -o -name '*.entitlements' "$@" -print | head -n 1
  }
  sign() {
    if [[ -n "$2" ]]; then
      codesign --force --sign - --entitlements "$2" "$1"
    else
      codesign --force --sign - "$1"
    fi
  }
  APPEX="$(find "$APP/Contents/PlugIns" -maxdepth 1 -name '*.appex' | head -n 1)"
  [[ -n "$APPEX" ]] && sign "$APPEX" "$(find_entitlements -path '*Extension*')"
  sign "$APP" "$(find_entitlements ! -path '*Extension*')"
  codesign --verify --deep --strict "$APP"

  echo "Built app: $APP"
  echo "Open it once, then enable the extension in Safari → Settings → Extensions."
  echo "Unsigned builds need Safari → Develop → Allow Unsigned Extensions."
fi
