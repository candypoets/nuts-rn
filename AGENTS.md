# Agent Notes

## On-Device Testing with Maestro

Maestro flows live in `maestro/flows/`. `launch.yaml` is the shared setup subflow (launch dev-client, connect to Metro, dismiss dev menu); scenario flows start with `- runFlow: launch.yaml`.

Host setup (Linux, headless):

```sh
# emulator (see android-emulator-launch skill; test AVD, swiftshader)
/opt/android-sdk/emulator/emulator -avd test -no-window -no-boot-anim -no-audio -no-snapshot -gpu swiftshader_indirect
# Metro — port 8081 is taken by a docker container on this host, use 8084.
# Omit CI=1: the launcher's Metro auto-discovery needs it off, and CI=1 Metro
# serves stale bundles. Commerce flows also need EXPO_PUBLIC_NUTS_API_URL (see
# the commerce section below).
npx expo start --dev-client --port 8084
adb reverse tcp:8084 tcp:8084
# run flows
MAESTRO_CLI_NO_ANALYTICS=1 ~/.maestro/bin/maestro test maestro/flows/smoke.yaml
```

Notes:

- Screenshots come back black on the `test` AVD — but that is an `aosp_atd` image trait (it composites nothing for its virtual display), NOT a SwiftShader limitation. For pixel-true screenshots use the `google` AVD (`system-images/android-34/google_apis/x86_64`, works headless and windowed under Xvfb `DISPLAY=:99`); `adb exec-out screencap -p` and Maestro `takeScreenshot` both return real pixels there. The uiautomator hierarchy Maestro uses for text assertions works fine on either, so assert on text, not pixels.
- Emulator crash recovery (2026-07-29): after a qemu crash, the next launch can hang at "detected a hanging thread 'QEMU2 main loop'" with no adb device — the emulator is stuck on an invisible crash-consent dialog. Fix: `pkill -9 -f '[q]emu-system'`, `rm -rf /tmp/android-root/emu-crash-*.db` (it is a directory), remove `~/.android/avd/<avd>.avd/multiinstance.lock`, relaunch. Also: `-gpu host` cannot work headless (RenderLib needs a display), and `pkill -f <pattern>` self-matches the wrapping bash's own cmdline — always write the pattern as `[q]emu-system` / `[m]aestro test`.
- Android edge-to-edge hides full-screen content under the status bar on the Pixel/google image (unlike the atd image). RN screens that skip `useSafeAreaInsets().top` render their header under the status bar — visibly broken, and uiautomator DROPS those covered nodes, so Maestro selectors for them fail mysteriously (first caught on SignupModal, fixed with a top inset at the wizard root).
- The dev launcher auto-discovers Metro only when Metro runs WITHOUT `CI=1` — and that discovery layout (a "New development server" row under Development Build) enters the a11y tree LATE (>20 s after pixels show it). `launch.yaml` handles both layouts: it taps the server row when it appears, then still falls back to typing `exp://localhost:8084` into the URL field (matched with the regex `(exp|http)://` because the placeholder flips between builds) and tapping Connect, then dismisses the dev menu with Continue/Close (both optional — the menu only appears on cold loads).
- `clearState: true` in the setup subflow wipes the dev-client's remembered server; after the first manual connect it also appears under RECENTLY OPENED.

### Explore new-post hold flow (explore-new-posts.yaml, 2026-08-05)

Tests the "N more posts" hold-then-merge behavior: `.qa/qa-feed-relay.mjs` is a throwaway in-memory NIP-01 relay that seeds 8 kind-1 notes, injects one live note ~8 s after the Explore `feedall` subscription arrives, and publishes the QA user's kind 10002 (read+write = itself) to the app's BOOTSTRAP_RELAYS so a fresh nsec login collapses the account relay set to just it. Run it, then pass the printed NSEC:

```sh
node .qa/qa-feed-relay.mjs --port 7877   # 7777/7799 are taken on this host
MAESTRO_CLI_NO_ANALYTICS=1 ~/.maestro/bin/maestro test --device emulator-5556 \
  -e NSEC=nsec1... -e RELAY_PORT=7877 maestro/flows/explore-new-posts.yaml
```

Why it works without touching the relay picker UI: the guest feed never subscribes in contacts mode (blocked on kind3), so `relaySubs['feedExplore']` is NOT frozen at launch; after login the flow waits for the header relay chip to become `10.0.2.2:${RELAY_PORT}` (proof the 10002 resolved; the relay serves NIP-11 with NO `name`, so UIs fall back to the URL label), and only then taps "Switch to all" — the first Explore subscription goes straight to the QA relay.

Gotchas learned:

- The flow used to REDBOX at feed mount with `ObjectAlreadyConsumedException: Map already consumed` (RN 0.86.0, `unstable_VirtualColumn` rows emitting `VirtualViewModeChangeEvent`). Root cause is TWO upstream bugs colliding: RN's `VirtualViewModeChangeEvent.getEventData()` caches its rect `ReadableMap`s as fields and JNI `putMap` CONSUMES them (single-shot `getEventData()`; every other RN event builds fresh maps), and reanimated's `NodesManager.onEventDispatch` UI-thread path calls `event.dispatchModern(mCustomEventHandler)` — i.e. reads the payload of EVERY dispatched event — even though its C++ side discards events with no waiting worklet handler (`ReanimatedModuleProxy.cpp` gates on `isAnyHandlerWaitingForEvent`; the off-UI-thread path in the same function checks it too, the UI path doesn't). Fix: `patches/react-native-reanimated+4.5.0.patch` gates `handleEvent` on `isAnyHandlerWaitingForEvent` (semantics-preserving — C++ discards those events anyway). Both upstreams are unfixed as of 2026-08-05 (RN main + 0.86.2 AAR bytecode identical; reanimated main/4.5.3 identical): re-check on upgrades and drop the patch when either lands. Android-only; the emulator reproduces it, a phone build predating `unstable_VirtualColumn` (or iOS) never sees it. `explore-scope.yaml` now asserts the "All" chip and `assertNotVisible .*Map already consumed.*` so the crash can't pass silently again.
- `pkill -f` self-match bites twice over when the same command line also starts the process being killed (the literal name appears later in the cmdline): run the `pkill -f '[q]a-feed-relay'` in its OWN Bash call, separate from the launch command.
- Ports on this host: 7777 = nuts-cash vite, 7798 = coordinator, 7799/7820-7822 = QA harness — qa-feed-relay defaults to 7777, pass `--port 7877`.

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

App-side auth_url flow: nipworker dispatches `authUrl` → `src/app/_layout.tsx` stores `authStore.nip46AuthUrl` → the login modal shows "Open approval page" (`Linking.openURL`); the modal closes when the deferred response completes login. Approval window: 300 s (was a flat 20 s timeout before challenge support).

- `login-amber.yaml` (real Amber, intent handoff): install Amber (`amber-x86_64-v6.3.0.apk` from greenart7c3/Amber releases), onboard once with "Use your private key" → `nsec1424242424242424242424242424242424242424242424242424q3dgem8` (= `'aa'*32`, same identity as the mock signer) → "Manually approve each app". The flow taps **Open in signing app** in the QR panel, Amber shows its connection approval, tap `Connect`, back in the app the login completes. Needs internet (nostrconnect relays are the public feed relays).

## Entitlements, Roles and Memberships (NIP-97)

The governing spec is **NIP-97 (draft)** at `~/nips/97.md`. Read it before
working in this area. Do not reintroduce the pre-NIP model (community metadata
on `30078`, all sellables on `30009`, text permissions such as `store`, or
authorization derived from `/community/info`).

| kind | role |
| --- | --- |
| `31727` | root-signed community anchor: admins, `badge_issuer`, metadata |
| `30009` | role and membership definitions |
| `30402` | NIP-99 products, passes and tickets |
| `31922`/`31923` | calendar events |
| `31925` | RSVPs |
| `8` | award — the uniform entitlement token |
| `37237` | fulfillment status of one award use |

Trust chain:

1. The community relay's NIP-11 `pubkey` is the root key and the only
   out-of-band authority.
2. Its current `31727`, `d=community` anchor lists admins as `p` tags and the
   optional delegated `badge_issuer`. Anchor replacement/rotation resolves by
   `created_at`, then lowest event ID.
3. Awards of definitions carrying a `price` tag may be signed by an anchor
   admin or `badge_issuer`; unpriced definitions may be awarded only by an
   anchor admin. Never require the award signer to equal the definition author.
4. A kind-5 deletion referencing an award revokes it when signed by the award
   issuer or an anchor admin.

Resolve the anchor, definition, award, deletion and status events only from the
community relay. `/community/info` is an optional issuance convenience and is
never an authorization source.

Roles and memberships use `30009` with `t=role` / `t=membership`. A `price`
tag makes a membership sellable. Capabilities are kind-scoped:

```json
["permission", "<kind-number>", "<read|write>", "<optional-t-filter>"]
```

An absent marker grants read and write. Conventional grants are kind `1` write
for posting, `31923` write for events, `30402` write for store management,
`37237` write for fulfillment, and `30009` write with topic `membership` for
membership management. Publishing `t=role` definitions remains an anchor-admin
privilege boundary.

Products, passes and tickets use NIP-99 kind `30402`: `title`, `summary`,
`image`, `price`, `status`, and `t`. `t=product` and `t=pass` identify ordinary
listings; `t=ticket` plus an `a` tag links a ticket to a NIP-52 event.
`max_uses` is the NIP-97 extension; a `30402` without it defaults to one use.
Memberships without `max_uses` are unlimited.

Kind `37237` is addressable. Its `d` tag is exactly
`order:<order-id>` or `event:<event-coordinate>`, with a matching `order` or
`event` tag. Current state per award/context is latest `created_at`, then lowest
event ID. Valid signers are anchor admins, `badge_issuer`, or holders of a valid
role award granting `["permission","37237","write"]`. Only a latest status of
`fulfilled` consumes a use.

### Invite-redeem e2e (redeem.yaml + .qa/, 2026-07-29)

`maestro/flows/redeem.yaml` + the `.qa/` Node scripts are a full invite-redeem harness (see `.qa/README.md`): `node .qa/qa-bootstrap.mjs` provisions a real strfry-badge community via the coordinator and mints an invite, the flow logs in as keys.users[0] (nsec), `openLink:`s `nutsrn://redeem?…&token=${TOKEN}` (pass `-e TOKEN=…`), claims, and lands on the community screen; `node .qa/qa-verify-redeem.mjs` proves the kind-8 award + kind-0 replica on the relay; `node .qa/qa-teardown.mjs` cleans up.

Gotchas learned the hard way:

- In dev the invite service and strfry run on DIFFERENT loopback ports, but the app derives both from the invite link's single `relay=` param — `.qa/qa-redeem-proxy.mjs` (127.0.0.1:7820, reached from the emulator as 10.0.2.2) routes `POST /redeem` to the invite service and everything else (ws, NIP-11) to strfry. The invite-token `/redeem` endpoint does NOT verify NIP-98, so the proxy origin in the signed `u` tag is harmless; `POST /invites` DOES verify strictly, so bootstrap mints against `base_url` directly.
- The ws leg of the proxy must be message-level (`ws` library on both sides), NOT a raw TCP pipe: nipworker routinely opens duplicate transports per relay and aborts one mid-handshake, and with raw piping the race surfaced as "Unexpected close, relay marked unreliable" → 30-60 s publish cooldown → the redeem publishes were silently dropped ("relay unreliable during cooldown; dropping queued frame") and the kind-0 OK timed out ("The community relay did not confirm your profile."). Also sanitize close codes when forwarding closes — relay shutdown arrives as 1006, which `ws.close()` rejects with a TypeError that kills an unguarded proxy.
- Community domain labels use the `rnqa-` prefix: the nuts-cash `.qa/qa-teardown.mjs --sweep` janitor deletes every relay whose domain starts with `qa-` on this shared coordinator, and it ate a `qa-rn-*` community mid-run.
- The coordinator reports `running` before the container's write gate serves; bootstrap retries the admin kind-0 publish until it round-trips.
- The invite has `max_redemptions: 1` and `checkExistingMembership` short-circuits the modal to "already a member" once the award exists — a flow rerun against the same community can never pass; always re-bootstrap.
- Badge-gate membership-cache lag (15-45 s) bites fresh redeems: the kind-0 replica confirm fails on the first attempt while the gate warms. App-side, `publishProfileToCommunity` retries `false` OKs every 2.5 s for 30 s, and `RedeemModal` retries check existing membership first (they used to burn another redemption and surface "token redemption limit reached").

### Commerce e2e (store-beer / gym-pass / capacity, 2026-07-30)

`node .qa/qa-verify-event.mjs [store-beer|gym-pass|capacity|all]` drives the purchase + capacity flows through the real UI (full details in `.qa/README.md`, gaps pinned in `.qa/SPEC-GAPS.md`): provision with `node .qa/qa-scenario-commerce.mjs` (two communities + proxies 7820/7822 + checkout shim 7821), run Metro with `EXPO_PUBLIC_NUTS_API_URL=http://10.0.2.2:7821` and NO `CI=1` (the flows rely on the launcher's Metro auto-discovery layout; `CI=1` Metro also serves stale bundles). Buying is Stripe-bypassed: the app checks out against the shim, which performs the REAL payment `/redeem` (kind-8 award) signed by the payment-service key (`NUTS_PAYMENT_SERVICE_SECRET_KEY` in `/root/code/nuts-cash/.env`).

- Maestro 2.7 env precedence: a subflow's own `env:` block beats BOTH CLI `-e` and `runFlow` env. `redeem.yaml` declares no env block for exactly this reason — pass TOKEN/RELAY_PORT/NSEC/COMMUNITY_NAME from the caller.
- Kind 31925 (RSVP) is addressable, so test RSVPs accumulate across runs; `qa-verify-event.mjs capacity()` retracts stale RSVPs before re-seeding or the "2 going" assert fails on reruns.
- Chrome checkout chain on first run: "Use without an account" → notification prompt ("No thanks") → success page; handle as one-time `when:` branches.
- If a flow dies on its landing assert with a screenshot showing a STALE screen from the previous flow (e.g. Chrome still on the shim success page), check for a native crash first: `adb logcat -d | grep -A15 'F DEBUG'`. Observed once: SIGSEGV in `mqt_v_js` / `MountingCoordinator::pullTransaction` (Fabric) right after bundle mount — the app dies and Android returns to the previous foreground app. Retry the run; if it recurs, it's a real stability bug, not a flow issue.
- `CalendarEventModal` bugs fixed for this: declined RSVPs were ignored (no latest-per-pubkey) so cancelled spots never freed, and a deep link without `address` redboxed in `splitAddress`.
- Web staff-side coverage (gym 10 check-ins + 11th rejection, capacity roster, orders board, QR serve) lives in `/root/code/nuts-cash/.qa/` (`qa-passes-e2e.mjs`, `qa-events-e2e.mjs`, `qa-orders-e2e.mjs`, `qa-scan-e2e.mjs`; `qa-bootstrap.mjs --type sports`).

### Entitlement screens + entitlement e2e (2026-07-30)

Member-side entitlement surfaces (spec `docs/entitlements.md`): `src/app/Award.tsx` + `src/modals/AwardModal.tsx` (one entitlement: status line, remaining uses, live presentation QR, activity), `src/app/Passes.tsx` + `src/modals/PassesModal.tsx` (all passes/memberships grouped by community), plus entry points in `StoreSub` ("Yours" strip), `CalendarEventModal` ("Your ticket" button when the 31923 has `entrance_badge` and the member holds it), and `ProfileModal` ("Passes" row). Data hooks in `src/hooks/useAwards.ts`; derivation ported from web in `src/lib/orders.ts`; the kind-27236 presentation QR port is `src/nostr/presentation.ts` (60 s re-sign, fresh `use:<nonce>` context per signing for passes/memberships — matches web `kind8.svelte`).

- The QR sits on a WHITE card regardless of app theme — deliberate break, scanner contrast beats theme consistency (per `docs/entitlements.md`).
- QA hook: dev builds log every signed QR payload as `[award-qr] <payload>`; `qa-verify-event.mjs` greps logcat and verifies the 27236 derivation-side (`verifyEntitlementPresentation` in `.qa/qa-derive.mjs`).
- `node .qa/qa-verify-event.mjs entitlement` (3 phases: pass 10→9 decrement, beer order → "Served", event ticket). Idempotent — each phase seeds a fresh issuer-signed purchase award before driving the UI. **ENTITLEMENT PASS 2026-07-30** (all phases green on 37237).
- Order/check-in statuses are NIP-97 kind **37237** only. `useAwards` resolves the root-signed anchor and accepts statuses from anchor admins, `badge_issuer`, or holders of a valid `37237`-write role award. Kind 27236 presentation events remain ephemeral by design.
- `entitlement-ticket.yaml` takes EVENT_URL via CLI env and (like `redeem.yaml`) declares no `env:` block — a subflow's own env beats CLI `-e` in maestro 2.7.
- The community header's store entry is labeled **Menu** for hospitality communities and Store otherwise (`CommunitySub.tsx` reads the root-signed kind-31727 anchor's optional `type` display extension) — flows tap `^(Store|Menu)$`.
- Dev builds without Firebase credentials must NOT `console.error` the push-token failure: the RN LogBox banner never dismisses and its invisible container swallows taps on bottom-bar buttons (blocked "Your ticket" in phase 3; `isMissingFirebaseConfig` in `usePushNotifications.ts` downgrades it to `console.log`). Rule of thumb: expected environment gaps → `console.log`, real failures → `console.error`.
- Phase-3 seeding fetches the 31923 by `#d`+author, NEVER by the state file's id — kind 31923 is addressable and a previous run's `entrance_badge` update replaced it (stale id = fetch timeout). Same class of bug as the RSVP retraction rule.

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

The app entry is `expo-router/entry` (package.json `"main"`). Routes live in `src/app/`; `src/app/_layout.tsx` hosts the providers and root Stack, and `src/app/(tabs)/index.tsx` is the root `/` route that opens the Explore feed directly. There is no `App.tsx`/`index.js` entry anymore — the root component is registered as `main`.

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

- Run Metro with `--clear` after adding or renaming route files in `src/app/`; the route context module is cached and a stale bundle won't pick up new routes.
- The dev-client launcher's URL placeholder flips between `exp://` and `http://` depending on build/state; maestro `launch.yaml` matches `(exp|http)://` to cover both.
- Deep-opening the app bare (`nutsrn:///`) lands directly on the Explore tab at `src/app/(tabs)/index.tsx`; do not add a root redirect that navigates to another tab after the native tab router initializes.
- The wizard flows (SignupModal, MintingModal) embed their own inner stack via `createNativeStackNavigator` deep-imported from `expo-router/build/react-navigation/native-stack`. That is a private path with no semver guarantee — re-check it on every expo-router upgrade.
- Tabs use `expo-router/unstable-native-tabs` on both native platforms.
- Route file names in `src/app/` intentionally match the old `RootStackParamList` names, so deep links and existing `router.push('/X')` calls kept working unchanged.
- Screen `presentation` (modal/formSheet/fullScreenModal) and push `animation` MUST be declared as named `<Stack.Screen>` entries in `src/app/_layout.tsx`. They are read at push time; in-route `<Stack.Screen options={...}/>` applies via `navigation.setOptions` in a layout effect after the push, so it is silently ignored and the screen opens as a default card push. Do not reintroduce in-route screen options.
- Typed routes are enabled (`experiments.typedRoutes` in app.json). Expo generates route types into `.expo/types/` when Metro runs; the dir is gitignored and included in tsconfig.

## Invite links (redeem flow)

`https://nuts.cash/redeem?relay=<service-base-url>&token=<token>` (Android intent filter in app.json + AndroidManifest) and the `nutsrn://redeem?…` custom-scheme variant open the `/Redeem` formSheet. Parsing lives in `resolveInviteDeepLink` (`src/navigation/linking.ts`), tried before `resolveNostrDeepLink` in `_layout.tsx`'s `NostrDeepLinkHandler`; the token is opaque and passed through untouched.

`src/app/+native-intent.tsx` (`redirectSystemPath`) returns null for every URL the manual handler routes (invite links, nostr identifiers, njump), so expo-router's own linking leaves them alone. Without it expo-router rewrites the link to a lowercase path (no route → Unmatched Route screen) and double-encodes query params. Keep the two resolvers in sync with it.

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
