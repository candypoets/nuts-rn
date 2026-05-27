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

