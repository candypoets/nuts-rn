# Agent Notes

Only environment facts, regression guardrails, and code rules that are NOT discoverable from the repo live here. Per-flow setup is documented in each `maestro/flows/*.yaml` header; harness internals in `.qa/README.md`.

## On-device testing

Flows run only through the repo-pinned Agent Device runner and start with `- runFlow: launch.yaml`. Always set `ANDROID_SERIAL` so a run cannot take over another agent's emulator.

```sh
/opt/android-sdk/emulator/emulator -avd test -no-window -no-boot-anim -no-audio -no-snapshot -gpu swiftshader_indirect
npx expo start --dev-client --port 8084   # 8081 is taken on this host; NO CI=1 (breaks launcher auto-discovery, serves stale bundles)
adb reverse tcp:8084 tcp:8084
ANDROID_SERIAL=emulator-5554 npm run qa:device -- maestro/flows/smoke.yaml
```

Host ports: 7777 vite, 7798 coordinator, 7799/7820–7822 QA harnesses — use a free port (e.g. 7877) for ad-hoc relays.

Environment gotchas:

- The `test` AVD (aosp_atd) composites nothing: screenshots are black, so assert on text. For pixels use the `google` AVD (headless or Xvfb `DISPLAY=:99`).
- qemu crash → next launch hangs on an invisible crash-consent dialog: `pkill -9 -f '[q]emu-system'`, `rm -rf /tmp/android-root/emu-crash-*.db`, remove `~/.android/avd/<avd>.avd/multiinstance.lock`, relaunch. `-gpu host` cannot work headless. `pkill -f` self-matches the wrapping bash — always bracket the first letter, and never pkill in the same Bash call that launches the matching process.
- Pixel/google image is edge-to-edge (unlike atd): screens without `useSafeAreaInsets().top` render under the status bar, and uiautomator DROPS those covered nodes, so selectors fail mysteriously.
- Restart Metro after editing app code before running flows.

Flow-authoring rules (also embedded in the flows where used):

- `tapOn` can match COVERED nodes; there is no `below:` selector — open `/Login` directly and use `index:`.
- `hideKeyboard` sends a Back press when the IME never opened, dismissing the whole modal — tap inert text instead.
- Compatibility text selectors match the WHOLE element text — substring asserts need `.*….*`.

## e2e harnesses

- Invite-redeem: `ANDROID_SERIAL=<serial> npm run qa:invite` — provisions a real strfry-badge community, runs `redeem-fresh.yaml`, verifies on-relay state, tears down. Docs: `.qa/README.md`.
- Commerce/entitlement: `node .qa/qa-verify-event.mjs [store-beer|gym-pass|capacity|entitlement|all]`; provision first with `qa-scenario-commerce.mjs`; Metro needs `EXPO_PUBLIC_NUTS_API_URL=http://10.0.2.2:7821`.
- Guardrails: community domains use the `rnqa-` prefix (the shared nuts-cash janitor sweeps `qa-*` domains); fresh-claim reruns need re-provisioning (one-use invites); kinds 31923/31925 are addressable — re-seed by `#d`+author and retract stale RSVPs, never trust stored ids.
- Staff-side web coverage lives in `/root/code/nuts-cash/.qa/`.

## In-tree workarounds for upstream bugs — do not remove

- `patches/react-native-reanimated+4.5.0.patch` gates `NodesManager` `handleEvent` on `isAnyHandlerWaitingForEvent`; without it, RN 0.86's single-shot `VirtualViewModeChangeEvent.getEventData()` + reanimated's UI-thread payload read redbox `ObjectAlreadyConsumedException: Map already consumed` at feed mount. Unfixed upstream as of 2026-08-05 (RN main/0.86.2, reanimated main/4.5.3) — drop the patch when either lands. `explore-scope.yaml` asserts the crash text is absent.
- Kind1Sub's status row is mounted permanently (zero-height `none` variant, key `status`): RN's `VirtualViewContainerState.remove()` asserts membership and crashes on views attached+detached without an intervening rect report (debug builds only, but it blocks emulator measurement).
- Thread-focus anchoring via MVCP was tried and reverted (commits `bcef593`→`ce6b3ff`): worked on Android, never compensated on iOS. Upstream 0.87 #57294 does not fix under-compensation.

## Code rules

- nipworker subscriptions: finite snapshots go through `src/nostr/subscribeUntilEose.ts` — never put `closeOnEose: true` on a multi-request `useSubscription` (the shared sub ID makes overlapping REQs replace each other; the first EOSE closes a later filter). `closeOnEose` is subscription-level; cache policy is request-level (`RequestObject(..., cacheFirst: true)`). Keep raw `useSubscription` for feeds, pagination, chats, wallet, zaps, notifications, storefront, RSVPs.
- Home wallet subscription ids must include the relay set, or nipworker reuses a stale `active_wallet_<pubkey>_0` sub and the wallet event never arrives.
- Expected environment gaps (e.g. missing Firebase credentials) → `console.log`, never `console.error`: the LogBox banner never dismisses and its invisible container swallows bottom-bar taps.
- nipworker native logs use logcat tag `nipworker`.

## NIP-97 (entitlements, roles, memberships)

Spec: `~/nips/97.md` — read it before working here. Never reintroduce the pre-NIP model (`30078` community metadata, sellables on `30009`, text permissions, `/community/info` as an authorization source). Resolve anchor/definition/award/status events only from the community relay. Order/check-in statuses are kind 37237 (addressable) only; only signer-authorized statuses count (`src/lib/communityTrust.ts`), and only a latest status of `fulfilled` consumes a use. Entitlement QRs stay on a white card regardless of theme (scanner contrast).

## App entry / Expo Router

- Entry is `expo-router/entry`; routes live in `src/app/`; no `App.tsx`. A successful dev-client launch prints `Running "NutsRn"` in logcat — without it the JS app is not running and relay logs are meaningless: `adb shell am start -a android.intent.action.VIEW -d 'nutsrn://expo-development-client/?url=http%3A%2F%2F<LAN-IP>%3A8081' com.nutsrn`.
- Run Metro with `--clear` after adding/renaming route files.
- No root redirect after the native tab router initializes (`nutsrn:///` lands on Explore).
- Screen `presentation`/`animation` MUST be named `<Stack.Screen>` entries in `src/app/_layout.tsx` — in-route `<Stack.Screen options>` applies after the push and is silently ignored.
- Wizard modals deep-import `createNativeStackNavigator` from `expo-router/build/react-navigation/native-stack` (private path — re-check on every expo-router upgrade). Tabs use `expo-router/unstable-native-tabs`. Route file names intentionally match the old `RootStackParamList` names.
- Invite/deep links: `resolveInviteDeepLink` runs before `resolveNostrDeepLink`; `src/app/+native-intent.tsx` returns null for every manually-routed URL (else expo-router lowercases the path and double-encodes params) — keep the resolvers in sync with it. `adb shell am start -d` eats everything after an unescaped `&` (write `\&`).
- Signer detection: `<queries>` for `nostrsigner`/`nostrconnect` schemes → `Linking.canOpenURL('nostrconnect://')` = a NIP-46-capable signer is installed (iOS always false).

## Relay debugging

```sh
adb logcat | rg 'root-nostr|home-wallet|NativeBackend|Dropping|ArrayBufferReader|nipworker'
```

- `relay.nuts.cash` resolves the logged-in user's kind 17375 wallet event; `relay.thibautduchene.fr` stays where RN mirrors web `DEFAULT_RELAYS`.

## RN render performance (feed/list code)

- Preserve mounted views when switching top-level feeds; gate expensive subscriptions with `visible` instead of unmounting.
- Keep navigation/animation off the JS thread and outside the subtree that owns a large virtualized list.
- Move store subscriptions down to the smallest component that renders the value; each memoized row subscribes to its own boolean state rather than the parent computing from global arrays.
- Extract stable header/row components with minimal props; don't close over frequently changing state in inline list renderers.
- Update React state from subscription callbacks only when the rendered value changes; prefer scalar-returning selectors over `ref + tick`.
- Keep derived arrays used in request keys/list props stable and equality-guarded; avoid heavy synchronous work on selection actions.
- Use render diagnostics temporarily and remove them once understood.

## iOS native iteration

- Do NOT `xcodebuild clean` for `.swift`/`.mm` changes; reuse a stable build dir:
  ```sh
  xcodebuild -workspace ios/NutsRn.xcworkspace -scheme NutsRn -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build/NativeAvatarFooterCheck CODE_SIGNING_ALLOWED=NO build
  ```
- Expect slow rebuilds after Podfile/lockfile/pbxproj/scheme/codegen/signing/arch changes or exported `.h` edits; avoid `pod install` unless Pods changed. Clean rebuild (`rm -rf ios/build/NativeAvatarFooterCheck`) is a last resort.

## Local nipworker AAR (x86_64 emulator)

```sh
cd /root/code/nipworker/crates/native-ffi
ANDROID_NDK_HOME=/opt/android-sdk/ndk/27.1.12297006 cargo ndk -t x86_64 -o android/src/main/jniLibs build --release
# gradle assembleRelease + publishReleasePublicationToReleaseRepository -PVERSION_NAME=<npm-requested version>
cd /root/code/nuts-rn/android
rm -rf ~/.gradle/caches/modules-2/files-2.1/com.candypoets
NIPWORKER_MAVEN_URL=file:///root/code/nipworker/crates/native-ffi/android/build/repository ./gradlew installDebug
```

Gotchas: `-PVERSION_NAME` must match what the npm package requests; wipe `build/intermediates/cxx` + `.cxx` or the prefab copy goes stale; `mergeReleaseNativeLibs` needs a `pickFirsts` packagingOption; clear gradle's `com.candypoets` cache or the old remote AAR is reused.
