#!/usr/bin/env bash
# Trigger the autonomous RLN E2E suite via deep link, then wait for
# the report to land on the device and pull it off.
#
# Pre-conditions:
#   • The demo app is already installed AND running on the booted sim/
#     emulator. (This script does NOT install or boot it — use
#     `expo run:ios` / `expo run:android` first.)
#   • A regtest stack is up (rgb-lightning-node/regtest.sh start).
#   • The peer RLN daemon is reachable from the device on the addresses
#     configured in the E2E tab (defaults: 10.0.2.2:3001 on Android,
#     127.0.0.1:3001 on iOS).
#
# Usage:
#   ./scripts/run-e2e.sh ios     [timeout_seconds]
#   ./scripts/run-e2e.sh android [timeout_seconds]
#
# After the report appears, logs are pulled into ./e2e-logs/.

set -euo pipefail

PLATFORM="${1:-}"
TIMEOUT="${2:-1800}"  # default 30 min

if [[ -z "$PLATFORM" ]]; then
  echo "usage: $0 <ios|android> [timeout_seconds]" >&2
  exit 2
fi

ANDROID_PACKAGE="com.anonymous.utexorgbwdkdemo"
IOS_BUNDLE_ID="com.anonymous.utexo-rgb-wdk-demo"
DEEP_LINK="utexo://rln-e2e/run"

trigger_deep_link () {
  case "$PLATFORM" in
    android)
      echo "→ firing deep link via adb: $DEEP_LINK"
      adb shell am start -a android.intent.action.VIEW -d "$DEEP_LINK" "$ANDROID_PACKAGE"
      ;;
    ios)
      echo "→ firing deep link via simctl: $DEEP_LINK"
      xcrun simctl openurl booted "$DEEP_LINK"
      ;;
    *)
      echo "unknown platform: $PLATFORM" >&2
      exit 2
      ;;
  esac
}

# Polls the device for the latest report file. Returns 0 once found.
wait_for_report () {
  local deadline=$(( $(date +%s) + TIMEOUT ))
  while [[ $(date +%s) -lt $deadline ]]; do
    case "$PLATFORM" in
      android)
        if adb shell "run-as ${ANDROID_PACKAGE} ls files" 2>/dev/null | tr -d '\r' | grep -q '^rln-e2e-report-'; then
          return 0
        fi
        ;;
      ios)
        local app_path
        app_path=$(xcrun simctl get_app_container booted "$IOS_BUNDLE_ID" data 2>/dev/null || true)
        if [[ -n "$app_path" ]] && ls "$app_path/Documents/rln-e2e-report-"*.json >/dev/null 2>&1; then
          return 0
        fi
        ;;
    esac
    sleep 5
  done
  return 1
}

trigger_deep_link
echo "→ waiting up to ${TIMEOUT}s for report to land …"
if wait_for_report; then
  echo "→ report detected on device"
else
  echo "✗ timeout — no report appeared. Check the LogDrawer in the app for errors." >&2
  exit 5
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
"${SCRIPT_DIR}/pull-e2e-logs.sh" "$PLATFORM"
