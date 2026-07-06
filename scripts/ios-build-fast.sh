#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="ios/NutsRn.xcworkspace"
SCHEME="NutsRn"
CONFIGURATION="Debug"
SDK="iphonesimulator"
DERIVED_DATA="ios/build/NativeAvatarFooterCheck"
SKIP_BUNDLING="1"
SHOW_SETTINGS=1

resolve_destination() {
  local device="$1"

  if [[ -n "${device}" ]]; then
    if [[ "${device}" == "--" ]]; then
      device=""
    fi
  fi

  if [[ -z "${device}" ]]; then
    local booted_id
    booted_id="$(xcrun simctl list devices booted | rg -o "[0-9A-Fa-f-]{32,}" | head -n 1 || true)"
    if [[ -n "${booted_id}" ]]; then
      echo "platform=iOS Simulator,id=${booted_id}"
      return
    fi
    echo "platform=iOS Simulator,name=iPhone 16 Pro"
    return
  fi

  if [[ "${device}" == *-* ]]; then
    echo "platform=iOS,id=${device}"
    return
  fi

  local matched_id
  matched_id="$(xcrun xctrace list devices | awk -v dev="${device}" '$0 ~ dev { if (match($0, /\([0-9A-Fa-f-]{20,}\)/)) { id=substr($0, RSTART+1, RLENGTH-2); print id; exit } }')"
  if [[ -n "${matched_id}" ]]; then
    echo "platform=iOS,id=${matched_id}"
    return
  fi

  echo "platform=iOS Simulator,name=${device}"
}

show_usage() {
  cat <<'USAGE'
Usage: ios-build-fast.sh [options] [device-or-udid]

Examples:
  ios-build-fast.sh
  ios-build-fast.sh "iPhone 16 Pro"
  ios-build-fast.sh 0D5A...-ABCD...
  ios-build-fast.sh --no-show-settings

Options:
  --no-show-settings   Skip -showBuildSettings output.
USAGE
  exit 0
}

DEVICE_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_usage
      ;;
    --)
      shift || true
      break
      ;;
    --no-show-settings)
      SHOW_SETTINGS=0
      ;;
    *)
      if [[ -z "${DEVICE_NAME}" ]]; then
        DEVICE_NAME="$1"
      fi
      ;;
  esac
  shift || true
done

DESTINATION="$(resolve_destination "${DEVICE_NAME}")"

echo "Destination: ${DESTINATION}"

BASE_ARGS=(
  -workspace "${WORKSPACE}"
  -scheme "${SCHEME}"
  -configuration "${CONFIGURATION}"
  -sdk "${SDK}"
  -destination "${DESTINATION}"
  -derivedDataPath "${DERIVED_DATA}"
  CODE_SIGNING_ALLOWED=NO
  SKIP_BUNDLING="${SKIP_BUNDLING}"
  ONLY_ACTIVE_ARCH=YES
)

if [[ "${SHOW_SETTINGS}" -eq 1 ]]; then
  echo "---- xcodebuild -showBuildSettings ----"
  xcodebuild "${BASE_ARGS[@]}" -showBuildSettings >/tmp/ios_build_fast.show 2>&1
  status=$?
  if [[ ${status} -ne 0 ]]; then
    cat /tmp/ios_build_fast.show
    echo "showBuildSettings failed with status ${status}"
    exit "${status}"
  fi
  cat /tmp/ios_build_fast.show
  echo "---- end showBuildSettings ----"
fi

echo "---- xcodebuild build ----"
xcodebuild "${BASE_ARGS[@]}" build
status=$?

if [[ ${status} -ne 0 ]]; then
  echo "xcodebuild build failed with status ${status}"
else
  echo "xcodebuild build exited ${status} (success)"
fi

exit "${status}"
