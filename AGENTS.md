# Agent Notes

## On-Device Testing with Maestro

Maestro flows live in `maestro/flows/`. `launch.yaml` is the shared setup subflow (launch dev-client, connect to Metro, dismiss dev menu); scenario flows start with `- runFlow: launch.yaml`.

Host setup (Linux, headless):

```sh
# emulator (see android-emulator-launch skill; test AVD, swiftshader)
/opt/android-sdk/emulator/emulator -avd test -no-window -no-boot-anim -no-audio -no-snapshot -gpu swiftshader_indirect
# Metro — port 8081 is taken by a docker container on this host, use 8084
CI=1 npx expo start --dev-client --port 8084
adb reverse tcp:8084 tcp:8084
# run flows
MAESTRO_CLI_NO_ANALYTICS=1 ~/.maestro/bin/maestro test maestro/flows/smoke.yaml
```

Notes:

- Screenshots come back black under SwiftShader; the uiautomator hierarchy Maestro uses for text assertions works fine, so assert on text, not pixels.
- The dev launcher cannot auto-discover Metro (adb reverse is host-local); flows type `exp://localhost:8084` into the launcher URL field and tap Connect, then dismiss the dev menu with Continue/Close.
- `clearState: true` in the setup subflow wipes the dev-client's remembered server; after the first manual connect it also appears under RECENTLY OPENED.

### nipworker native lib gotcha (fixed locally 2026-07-22)

`libnipworker_native_ffi.so` (com.candypoets:nipworker-native-ffi-android AAR, 0.97.2/0.97.3) ships **without a SONAME**, so CMake baked the absolute build-machine path into `DT_NEEDED` of `libnipworker_react_native.so` and the app crashed at startup with `UnsatisfiedLinkError` on every device. Fixed in the nipworker repo at `crates/native-ffi/react-native/android/CMakeLists.txt` by linking the prefab lib by name (`-lnipworker_native_ffi`) instead of by imported-target path. Do not "fix" this with patchelf — patchelf 0.14 corrupts the Rust .so's hash sections, and gradle rejects modified transform workspaces anyway. The durable upstream fix is adding `-Wl,-soname,libnipworker_native_ffi.so` to the ffi build.

## Running the RN App

Use the Expo dev-client flow. A plain Android activity launch can stop at the Expo dev launcher and never start the JS bundle, which makes relay debugging misleading.

Known-good Android flow:

```sh
npm run start
```

In another shell:

```sh
adb shell am start \
  -a android.intent.action.VIEW \
  -d 'nutsrn://expo-development-client/?url=http%3A%2F%2F192.168.128.186%3A8081' \
  com.nutsrn
```

If the LAN IP changes, update the encoded URL. Check the current IP with:

```sh
ipconfig getifaddr en0
```

A successful launch prints this in logcat:

```txt
Running "NutsRn"
```

If that line is missing, the JS app is not running and relay/subscription logs are not meaningful.

## Relay Debugging

Use filtered logcat while testing root subscriptions, Home, and wallet loading:

```sh
adb logcat | rg 'root-nostr|home-wallet|NativeBackend|Dropping|ArrayBufferReader'
```

Important current observations:

- `relay.nuts.cash` resolves the logged-in user's kind `17375` wallet event.
- Root kind `0` and kind `3` currently resolve from `nos.lol`, `purplepag.es`, `user.kindpag.es`, and `relay.nuts.cash`.
- `relay.thibautduchene.fr` is part of the web app default relay set and should be present where RN mirrors web `DEFAULT_RELAYS`.
- Home wallet subscriptions must include the relay set in the subscription id. Otherwise nipworker can reuse an older `active_wallet_<pubkey>_0` subscription that was created before `relay.nuts.cash` entered the relay list, and the wallet event will never be requested.

Useful success logs:

```txt
[root-nostr] kind0 parse { ok: true, ... }
[root-nostr] kind3 parse { ok: true, contacts: ... }
[home-wallet] event { ..., kind: 17375, ... }
[home-wallet] kind17375 parse { ok: true, mints: ... }
```

## React Native Render Performance

Lessons from debugging carousel, native-stack subs, `Kind0Sub`, `Avatar`, `User`, and `FeedBuilder`:

- Preserve mounted views when switching top-level feeds. Keep the three feed pages rendered side by side and gate expensive subscriptions with `visible` rather than unmounting/remounting the feed tree.
- Keep navigation/page animation off the JS thread where possible. Use native stack for pushed subs/modals; JS-driven pager animation is fragile under heavy list/render churn.
- Do not animate or frequently remount the same native view that owns a large virtualized list. Keep list surfaces stable and put animation/navigation ownership outside the list subtree.
- Avoid parent components subscribing to broad store slices when only a child needs them. Move subscriptions down to the smallest component that actually renders the value.
- For large lists, do not compute per-row selected state in the parent from global arrays. Put each row in a memoized component and let that row subscribe to its own boolean selection state.
- Avoid inline list headers and row renderers that close over frequently changing state. Extract stable header/row components and pass only the props they actually need.
- Subscription callbacks should update React state only when the selected/rendered value actually changes. For profile display, prefer hooks/selectors that return one scalar value over `ref + tick` patterns.
- Derived arrays used in request keys or list props should be stable and guarded with equality checks. Avoid resetting list refs because relay arrays move from fallback relays to resolved relays unless that reset is intentional.
- Be careful with synchronous work on selection actions. Dedupe is fine, but sorting thousands of pubkeys on every followpack toggle is unnecessary when request semantics do not depend on order.
- Relay status updates can legitimately rerender relay UI once per relay. Treat that as expected if the UI displays live per-relay state; optimize only if it affects unrelated parent trees.
- Use render diagnostics temporarily and remove them after the issue is understood. Good signals are mounts/unmounts, value changes per instance, and whether list item arrival remounts headers/images.

## iOS Native Iteration Workflow

Goal: minimize rebuild time when editing `.swift`, `.mm`, `.m`, `.h` and shared-native interfaces.

### Fast path (incremental)

- Do **not** run `xcodebuild clean` for normal `.swift/.mm/.h` changes.
- Reuse a stable build directory:
  ```sh
  # one-time build command that preserves DerivedData
  xcodebuild -workspace ios/NutsRn.xcworkspace \
    -scheme NutsRn \
    -configuration Debug \
    -sdk iphonesimulator \
    -derivedDataPath ios/build/NativeAvatarFooterCheck \
    CODE_SIGNING_ALLOWED=NO \
    build
  ```
- Keep target/scheme/SDK constant (same simulator type). Switching targets or SDKs invalidates more.
- If using Expo flow, keep the Metro bundle already running (`npm run start`) and reinstall native app only when bundle/install desync occurs.

### When to expect rebuild speed to be slower

- First-time native run after checkout or after Pod/SDK/toolchain changes.
- Changing `Podfile`, `Podfile.lock`, `project.pbxproj`, `.xcscheme`, codegen outputs, signing/build settings, or architecture/device.
- Dependency updates in `package.json` that affect iOS modules.
- Swift type/interface changes in exported headers (`.h`) can cause wider recompilation than implementation-only `.swift/.mm` edits.

### Suggested loop for native-only iteration

1. Edit only implementation files (`.swift`, `.mm`) when possible; keep `.h` changes minimal.
2. Run:
   ```sh
   xcodebuild -workspace ios/NutsRn.xcworkspace -scheme NutsRn -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build/NativeAvatarFooterCheck CODE_SIGNING_ALLOWED=NO build
   ```
3. Re-run same command after each change to let Xcode do incremental recompiles.
4. Avoid `pod install` unless Pods changed.

### Expo launch notes

- For Expo dev-client, avoid doing full device uninstall/reinstall unless the app refuses to attach.
- If build times are still high, prefer a fresh incremental restart of `npm run start` instead of repeatedly restarting the native run command.
- Full clean rebuild is a last resort only:
  ```sh
  rm -rf ios/build/NativeAvatarFooterCheck
  xcodebuild -workspace ios/NutsRn.xcworkspace -scheme NutsRn -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build
  ```
