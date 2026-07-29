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
- The dev launcher cannot auto-discover Metro (adb reverse is host-local); flows type `exp://localhost:8084` into the launcher URL field (matched with the regex `(exp|http)://` because the placeholder flips between builds) and tap Connect, then dismiss the dev menu with Continue/Close (both optional — the menu only appears on cold loads).
- `clearState: true` in the setup subflow wipes the dev-client's remembered server; after the first manual connect it also appears under RECENTLY OPENED.

### NIP-46 login flows (login-nip46.yaml, login-nip46-qr.yaml)

Both flows test new-user NIP-46 login against a fake remote signer: the nipworker repo's `tests/e2e-browser/mock-signer-relay.mjs`, a combined mock relay + signer (fixed test keypair, pubkey `6a04ab98…83eb3`) that answers `connect`/`get_public_key`/`sign_event` with real signatures. Run it on the host:

```sh
node /root/code/nipworker/tests/e2e-browser/mock-signer-relay.mjs --port 7746
```

- `login-nip46.yaml` (bunker://): pastes `bunker://6a04ab98…?relay=ws%3A%2F%2F10.0.2.2%3A7746` into the login field. Use `10.0.2.2` (emulator host loopback), **not** `localhost` — the Rust transport resolves `localhost` itself and `adb reverse` only forwards IPv4. To exercise the public-relay path instead, swap the relay param to `wss%3A%2F%2Fnos.lol` — the signer's outbound mode answers there too (green since the `unix_time` fix below).
- `login-nip46-qr.yaml` (nostrconnect:// QR): the QR can't be scanned, so in dev builds `ProfileModal.startQrConnect` logs the `nostrconnect://` URL as `[nip46-test]`. The signer's outbound mode joins the public relays listed in the URL (no app-side relay injection needed; host + emulator need internet). Feed the URL to the signer's watch file before running the flow:

```sh
rm -f /tmp/nostrconnect-url.txt && adb logcat -c
adb logcat | grep -m1 -o --line-buffered "nostrconnect://[^' ]*" > /tmp/nostrconnect-url.txt &
MAESTRO_CLI_NO_ANALYTICS=1 ~/.maestro/bin/maestro test maestro/flows/login-nip46-qr.yaml
```

- `login-nip46-authurl.yaml` (auth challenge): signer challenges `connect` with `{result:"auth_url", error:URL}` and answers after approval. Start the signer with `MOCK_AUTH_URL=https://fake-signer.test/approve`, and arm a delayed approver so the modal's approve UI can be asserted before login completes:

```sh
tail -F -n0 <signer-log> | grep -m1 'auth challenge sent' && sleep 20 && touch /tmp/nip46-approve
```

Gotcha: the emulator's stub browser opens the approval URL in its own task — `pressKey: Back` lands on the launcher, not the app. Return with `launchApp: {appId: com.nutsrn, stopApp: false}`.

- `login-nip46-timeout.yaml` (negative path): bunker connect to a valid-but-unanswered pubkey → 20 s nip46 timeout → the error text must appear in the modal. Uses a freshly generated valid pubkey; do **not** use an invalid x-only key (e.g. `bb`*32) — the Rust encryption path dies silently on it (no error, no timeout, crypto worker unresponsive). Signer errors surface via `auth` dispatch `error` → `authStore.authError` → the modal's error text (the authStore null-pubkey branch also handles failure events — it must not unconditionally wipe `authError`). Maestro text selectors match the **whole** element text — substring asserts need `.*….*`.

### nipworker 0.97.8 NIP-46 support (2026-07-28)

The app depends on `@candypoets/nipworker` 0.97.8. That release includes the NIP-46 `unix_time()` fix, `AuthUrl` FlatBuffers message and `authUrl` manager event, and the extended mock signer support, so no `patch-package` patch is needed for NIP-46.

App-side auth_url flow: nipworker dispatches `authUrl` → `app/_layout.tsx` stores `authStore.nip46AuthUrl` → the login modal shows "Open approval page" (`Linking.openURL`); the modal closes when the deferred response completes login. Approval window: 300 s (was a flat 20 s timeout before challenge support).

- `login-amber.yaml` (real Amber, intent handoff): install Amber (`amber-x86_64-v6.3.0.apk` from greenart7c3/Amber releases), onboard once with "Use your private key" → `nsec1424242424242424242424242424242424242424242424242424q3dgem8` (= `'aa'*32`, same identity as the mock signer) → "Manually approve each app". The flow taps **Open in signing app** in the QR panel, Amber shows its connection approval, tap `Connect`, back in the app the login completes. Needs internet (nostrconnect relays are the public feed relays).

### Signer detection (NIP-55-style, 2026-07-28)

`AndroidManifest.xml` declares `<queries>` intents for the `nostrsigner` and `nostrconnect` schemes, so `Linking.canOpenURL('nostrconnect://')` answers "is a signer installed that can complete the NIP-46 handoff" — scheme-based, so it finds any NIP-55/46 signer (Amber, Aegis, Primal, …), and multiple installed signers degrade to the Android app chooser. iOS always returns false — NIP-46 is the aligned path there. The login QR panel shows **Open in signing app** when true, handing the `nostrconnect://` URL to the signer via intent. Amber caveats on this AVD: approval dialog only for new connections; crashes at launch on `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` once its service is enabled (`pm clear` + re-onboard resets).

Maestro gotchas hit while writing these:

- `tapOn: "Sign in"` inside the login modal can match the *covered* Home-stub button behind the modal (the hierarchy includes covered nodes). Anchor with `below:` to the modal's input field.
- `hideKeyboard` sends a Back press when the IME never opened, which dismisses the whole login modal. Dismiss the keyboard by tapping inert text inside the modal's ScrollView instead.
- Metro started with `CI=1` does not reliably pick up file changes — a freshly launched app can get a stale bundle. Restart Metro after editing app code before running flows.
- NIP-46 failures used to be invisible in logcat: nipworker core logs via `tracing` but older Android native-ffi builds installed no tracing subscriber, and the JS side swallowed `SetSignerResponse.error`. Current diagnostic builds use logcat tag `nipworker`.

### Local nipworker AAR workflow (x86_64 emulator)

Build a patched native lib and swap it into the app:

```sh
cd /root/code/nipworker/crates/native-ffi
ANDROID_NDK_HOME=/opt/android-sdk/ndk/27.1.12297006 cargo ndk -t x86_64 -o android/src/main/jniLibs build --release
# gradle assembleRelease + publishReleasePublicationToReleaseRepository -PVERSION_NAME=0.97.8
#   → publishes to crates/native-ffi/android/build/repository
cd /root/code/nuts-rn/android
rm -rf ~/.gradle/caches/modules-2/files-2.1/com.candypoets
NIPWORKER_MAVEN_URL=file:///root/code/nipworker/crates/native-ffi/android/build/repository ./gradlew installDebug
```

Gotchas: publish with the same version the npm package requests (0.97.8, via `-PVERSION_NAME`); wipe `build/intermediates/cxx` + `.cxx` or the prefab copy goes stale; `mergeReleaseNativeLibs` needs a `pickFirsts` packagingOption for the duplicate .so (init script); clear gradle's `com.candypoets` cache or the old remote AAR is reused.

### nip46 unix_time bug (fixed in nipworker 0.97.8)

`crates/core/src/crypto/signers/nip46/mod.rs` `unix_time()` was `now_millis() as u32 / 1000` — the `as u32` truncated epoch millis to 32 bits before dividing, so every kind-24133 event got `created_at` in Feb 1970. Strict relays (strfry, e.g. nos.lol) reject them: `OK … false "invalid: ephemeral event expired"`, and NIP-46 login silently fails against real relays on all platforms. Local relays/mocks that don't check timestamps mask it. Version 0.97.8 uses `(now_millis() / 1000) as u32`.

### nipworker native lib gotcha (fixed locally 2026-07-22)

`libnipworker_native_ffi.so` (com.candypoets:nipworker-native-ffi-android AAR, 0.97.2/0.97.3) ships **without a SONAME**, so CMake baked the absolute build-machine path into `DT_NEEDED` of `libnipworker_react_native.so` and the app crashed at startup with `UnsatisfiedLinkError` on every device. Fixed in the nipworker repo at `crates/native-ffi/react-native/android/CMakeLists.txt` by linking the prefab lib by name (`-lnipworker_native_ffi`) instead of by imported-target path. Do not "fix" this with patchelf — patchelf 0.14 corrupts the Rust .so's hash sections, and gradle rejects modified transform workspaces anyway. The durable upstream fix is adding `-Wl,-soname,libnipworker_native_ffi.so` to the ffi build.

## Running the RN App

The app entry is `expo-router/entry` (package.json `"main"`). Routes live in `app/`; `app/_layout.tsx` hosts the providers and root Stack, and `app/index.tsx` redirects to `/ExploreTab`. There is no `App.tsx`/`index.js` entry anymore — the root component is registered as `main`.

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

## Expo Router notes

- Run Metro with `--clear` after adding or renaming route files in `app/`; the route context module is cached and a stale bundle won't pick up new routes.
- The dev-client launcher's URL placeholder flips between `exp://` and `http://` depending on build/state; maestro `launch.yaml` matches `(exp|http)://` to cover both.
- Deep-opening the app bare (`nutsrn:///`) lands on `app/index.tsx`, which redirects to `/ExploreTab`.
- The wizard flows (SignupModal, MintingModal) embed their own inner stack via `createNativeStackNavigator` deep-imported from `expo-router/build/react-navigation/native-stack`. That is a private path with no semver guarantee — re-check it on every expo-router upgrade.
- Tabs are JS-rendered (`expo-router` Tabs with a custom tab bar) on both platforms; the native bottom tab bar (NativeTabBarController) was removed.
- Route file names in `app/` intentionally match the old `RootStackParamList` names, so deep links and existing `router.push('/X')` calls kept working unchanged.
- Screen `presentation` (modal/formSheet/fullScreenModal) and push `animation` MUST be declared as named `<Stack.Screen>` entries in `app/_layout.tsx`. They are read at push time; in-route `<Stack.Screen options={...}/>` applies via `navigation.setOptions` in a layout effect after the push, so it is silently ignored and the screen opens as a default card push. Do not reintroduce in-route screen options.
- Typed routes are enabled (`experiments.typedRoutes` in app.json). Expo generates route types into `.expo/types/` when Metro runs; the dir is gitignored and included in tsconfig.

## Invite links (redeem flow)

`https://nuts.cash/redeem?relay=<service-base-url>&token=<token>` (Android intent filter in app.json + AndroidManifest) and the `nutsrn://redeem?…` custom-scheme variant open the `/Redeem` formSheet. Parsing lives in `resolveInviteDeepLink` (`src/navigation/linking.ts`), tried before `resolveNostrDeepLink` in `_layout.tsx`'s `NostrDeepLinkHandler`; the token is opaque and passed through untouched.

`app/+native-intent.tsx` (`redirectSystemPath`) returns null for every URL the manual handler routes (invite links, nostr identifiers, njump), so expo-router's own linking leaves them alone. Without it expo-router rewrites the link to a lowercase path (no route → Unmatched Route screen) and double-encodes query params. Keep the two resolvers in sync with it.

On-device deep-link testing gotchas:

- `adb shell am start -d` eats everything after an unescaped `&` — write the URL as `...?relay=...\&token=...` or the app receives it with params silently dropped.
- A cold start from a deep link lands on the Expo dev launcher first; load the bundle (RECENTLY OPENED entry) and the pending intent is delivered to JS.
- Verify rendered text via `adb shell uiautomator dump` (screenshots are black under SwiftShader).

`src/nostr/invites.ts` ports the web flow (nuts-cash `src/routes/redeem/+page.svelte`): NIP-11 fetch for community name/image → NIP-98-signed (kind 27235) `POST {relay}/redeem` → publish membership indexes (kind 10012 `a`-tags, member kind 30002 `nuts-relays-member`, kind 10002 with the community relay read-only) to `INDEXER_RELAYS` + the community relay → replicate kind 0 to the community relay and await its OK (12 s timeout). It also updates `useNostrStore` (relayMarkers / relayDirectoryAddresses / relayRoleSets) so membership shows immediately. Kind-8 `#p` badge award on the community relay = already a member. NIP-98 signing reuses the `signEvent`/`canonicalAuthEvent`/`base64UrlEncode` helpers exported from `src/nostr/upload.ts`.

Not done yet: iOS universal links (needs entitlements + `apple-app-site-association` on nuts.cash; the `nutsrn://redeem` scheme works there), Android `autoVerify` (assetlinks.json), and in-app invite generation (the stub `Invite` button in `CommunitySub.tsx`).

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
