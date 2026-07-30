# Push notifications

Nuts registers its native APNs or FCM device token with the central
`strfry-badge-push` service. The registration is authenticated with NIP-98 and
contains the same read relay set used by the in-app notification feed. When
kind 1, 6, or 7 events tag the account on any registered relay, the service
sends one deduplicated push directly through Apple or Google.

## App configuration

`expo-notifications` is used only as the local React Native bridge for
permissions, native tokens, and notification handling. Expo Push Service and
EAS are not used.

- `EXPO_PUBLIC_PUSH_API_URL`: optional push API origin; defaults to
  `https://push.nuts.cash`. The `EXPO_PUBLIC_` prefix only exposes the value to
  the app bundle; it does not involve an Expo-hosted service.
- Android: download the Firebase client config for `com.nutsrn` to
  `android/app/google-services.json`. The Gradle plugin is applied
  automatically when that file exists.
- iOS: enable Push Notifications for the `com.nutsrn` App ID and use a
  provisioning profile containing the `aps-environment` entitlement. Debug
  builds using `com.nutsrn.dev` need the capability on that App ID as well.

Adding `expo-notifications` is a native change. Rebuild the dev client after
adding the platform configuration. On iOS, run `pod install` on a macOS host
before building.

The app asks for notification permission after sign-in. It registers again when
the native token, account, or resolved read-relay set changes. Logout
unregisters the token before removing the signer.

## Service configuration

Deploy `/root/code/strfry-badge-node/Dockerfile.push` once, separately from the
per-community relay containers. The checked-in compose files show the intended
Traefik and persistent-volume configuration.

Required:

```sh
PUSH_LISTEN_ADDR=0.0.0.0:7789
PUSH_DB_PATH=/data/push.sqlite3
NIP98_BASE_URL=https://push.nuts.cash
```

FCM delivery:

```sh
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json
# Optional; otherwise read from the Google credentials.
FCM_PROJECT_ID=your-firebase-project-id
```

APNs delivery:

```sh
APNS_KEY_PATH=/run/secrets/AuthKey_KEYID.p8
APNS_KEY_ID=KEYID
APNS_TEAM_ID=TEAMID
# Release builds (`com.nutsrn`) use the production APNs endpoint.
APNS_TOPIC=com.nutsrn
# Debug builds (`com.nutsrn.dev`) use the sandbox APNs endpoint.
APNS_SANDBOX_TOPIC=com.nutsrn.dev
```

The Firebase service-account JSON and APNs `.p8` file are server secrets. Never
put them in the app or commit them. `google-services.json` is a separate,
non-secret Android client configuration file. The same APNs signing key can be
used for both Apple endpoints; either APNs topic can be omitted if that build
type should not receive notifications.

Optional:

```sh
# Fallback/custom delivery adapter when a native provider is not configured.
PUSH_WEBHOOK_URL=https://provider.example/push
# Local QA only: permits ws:// and private/loopback relay addresses.
PUSH_ALLOW_INSECURE_RELAYS=true
```

The service removes tokens reported as unregistered by APNs or FCM.

For Android-emulator QA, expose the service on `17789`, start the test compose
environment with
`PUSH_NIP98_BASE_URL=http://10.0.2.2:17789`, and start Metro with
`EXPO_PUBLIC_PUSH_API_URL=http://10.0.2.2:17789`. The URL in the NIP-98 `u` tag
must exactly match the service configuration.
