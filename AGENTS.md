# Agent Notes

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
