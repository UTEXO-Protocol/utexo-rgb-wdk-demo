#!/usr/bin/env bash
# Pull RLN E2E logs (JSONL + report.json) off a running iOS Simulator
# or Android Emulator into ./e2e-logs/<platform>-<timestamp>/.
#
# Usage:
#   ./scripts/pull-e2e-logs.sh ios
#   ./scripts/pull-e2e-logs.sh android
#
# The app writes its logs to <documentDir>/rln-log-*.jsonl and
# <documentDir>/rln-e2e-report-*.json (see LogStore + TestRunner).

set -euo pipefail

PLATFORM="${1:-}"
if [[ -z "$PLATFORM" ]]; then
  echo "usage: $0 <ios|android>" >&2
  exit 2
fi

# App identifiers — must match app.json.
ANDROID_PACKAGE="com.anonymous.utexorgbwdkdemo"
IOS_BUNDLE_ID="com.anonymous.utexo-rgb-wdk-demo"

TS=$(date +%Y%m%dT%H%M%S)
OUT_DIR="e2e-logs/${PLATFORM}-${TS}"
mkdir -p "$OUT_DIR"

case "$PLATFORM" in
  android)
    echo "→ pulling RLN logs from Android emulator …"
    # run-as needs the app to be debuggable; expo dev/preview builds are.
    # We mirror everything under /files because logs and report both
    # land in the document directory.
    adb shell "run-as ${ANDROID_PACKAGE} ls files" 2>/dev/null || {
      echo "adb run-as failed — app may not be installed or not debuggable" >&2
      exit 3
    }
    for f in $(adb shell "run-as ${ANDROID_PACKAGE} ls files" | tr -d '\r' | grep -E '^(rln-log-|rln-e2e-report-)'); do
      echo "  ← $f"
      adb shell "run-as ${ANDROID_PACKAGE} cat files/$f" > "${OUT_DIR}/${f}"
    done
    ;;
  ios)
    echo "→ pulling RLN logs from iOS Simulator …"
    APP_PATH=$(xcrun simctl get_app_container booted "$IOS_BUNDLE_ID" data 2>/dev/null) || {
      echo "xcrun simctl get_app_container failed — is the app installed on the booted simulator?" >&2
      exit 3
    }
    DOC_DIR="${APP_PATH}/Documents"
    if [[ ! -d "$DOC_DIR" ]]; then
      echo "no Documents dir at ${DOC_DIR}" >&2
      exit 4
    fi
    for f in "${DOC_DIR}/rln-log-"*.jsonl "${DOC_DIR}/rln-e2e-report-"*.json; do
      [[ -f "$f" ]] || continue
      echo "  ← $(basename "$f")"
      cp "$f" "${OUT_DIR}/$(basename "$f")"
    done
    ;;
  *)
    echo "unknown platform: $PLATFORM (expected ios|android)" >&2
    exit 2
    ;;
esac

# Summarise the pulled report, if any.
REPORT=$(ls "${OUT_DIR}"/rln-e2e-report-*.json 2>/dev/null | head -1 || true)
if [[ -n "$REPORT" ]]; then
  echo ""
  echo "→ report summary ($REPORT):"
  if command -v jq >/dev/null 2>&1; then
    jq '{total, passed, failed, skipped, expectedFail, unexpectedPass, durationMs}' "$REPORT"
  else
    head -c 500 "$REPORT"
    echo ""
  fi
fi

echo ""
echo "→ pulled to: ${OUT_DIR}"
