# nuts-rn invite-redeem QA harness

Repeatable end-to-end test of the app's invite-redeem entry point, modeled on
the nuts-cash `.qa` style: provision real infrastructure, drive the real app
UI with Maestro, verify protocol state from Node, tear down.

What it covers: a logged-in user opens an invite deep link → RedeemModal →
"Claim invite" → success → community screen. Then a Node verifier proves the
membership actually landed on the community relay (kind-8 badge award for the
user's pubkey + the app's kind-0 replica).

## Prerequisites

- strfry-badge-coordinator in dev mode on `127.0.0.1:7798`
  (`DEV_DIRECT_PORTS=true`; see /root/code/strfry-badge-node/test/app/README.md)
- Android emulator with the `com.nutsrn` dev-client installed, reachable via
  plain `adb`
- Metro on port 8084 + `adb reverse tcp:8084 tcp:8084`
- Admin/test keys at /root/code/strfry-badge-node/test/env/keys.json
- Maestro CLI at ~/.maestro/bin/maestro

## The loop

```sh
# 1. Provision a community + mint an invite (prints the claim URL and the
#    exact maestro command; state goes to /tmp/qa-rn-community.json)
node .qa/qa-bootstrap.mjs

# 2. Drive the app (only ONE emulator — wait until no other maestro run is
#    active; use the bracket pattern, a plain "maestro test" matches your own
#    shell and never exits: `while pgrep -f "AppK[t] test" >/dev/null; do sleep 10; done`)
MAESTRO_CLI_NO_ANALYTICS=1 ~/.maestro/bin/maestro test \
  -e TOKEN=<token from bootstrap> maestro/flows/redeem.yaml

# 3. Protocol-truth check against the community relay (exits non-zero on failure)
node .qa/qa-verify-redeem.mjs

# 4. Clean up (relay container, docker volume, proxy, state file)
node .qa/qa-teardown.mjs
# crash recovery: node .qa/qa-teardown.mjs --sweep
```

## Files

- `qa-lib.mjs` — shared helpers: keys, NIP-98, coordinator API, state file,
  relay pool, proxy lifecycle. Adapted from nuts-cash `.qa/qa-lib.mjs` with
  the browser/dev-server helpers dropped.
- `qa-bootstrap.mjs` — provisions a relay via the coordinator API, plants the
  admin kind-0 (retried — the coordinator reports `running` before the write
  gate serves), mints an invite with a direct NIP-98-signed `POST /invites`,
  starts the proxy, writes the state file.
- `qa-redeem-proxy.mjs` — dev port-split shim (below).
- `qa-verify-redeem.mjs` — queries the community relay for the kind-8 award
  (authored by the badge_issuer service key), the redeemer's kind-0 replica,
  and the 30009 members definition.
- `qa-teardown.mjs` — deletes the relay + `strfry-badge-data-<id>` volume
  (the coordinator does not remove it), stops the proxy, removes the state
  file. `--sweep` removes all `rnqa-*` relays and orphan volumes.
- `../maestro/flows/redeem.yaml` — login as `keys.users[0]` (nsec) →
  `openLink:` the invite → claim → success → community screen.

## The redeem proxy (dev port split)

In production the invite service and the strfry relay share one origin, and
the app derives both from the invite link's `relay=` param
(`src/nostr/invites.ts` `relayUrlFromBaseUrl`). In dev the coordinator
publishes them on two different loopback ports, so `qa-redeem-proxy.mjs`
presents a single origin on `127.0.0.1:7820` (reachable from the emulator as
`http://10.0.2.2:7820`):

- `POST /redeem` → the invite service port (state file `base_url`)
- everything else (nostr websocket upgrade, NIP-11 GET) → the strfry port
  (state file `relay_url`)

Targets are re-read from the state file per request, so re-bootstrapping does
not require a proxy restart. The proxy is safe to leave running; teardown
stops it only if bootstrap spawned it (pid file `/tmp/qa-rn-redeem-proxy.pid`).

The websocket leg is message-level forwarding (`ws` library on both sides,
with the client's subprotocol echoed and close codes sanitized before being
re-sent) — deliberately NOT a raw TCP pipe. nipworker's Rust transport
routinely opens duplicate transports per relay and aborts one mid-handshake;
through a raw pipe that race surfaced as "Unexpected close, relay marked
unreliable" → a 30-60 s publish cooldown that silently dropped the redeem
publishes, and the kind-0 OK wait timed out with "The community relay did not
confirm your profile." Also, relay shutdown closes upstreams with code 1006,
which `ws.close()` rejects — an unsanitized forward crashed the proxy on
teardown until close codes were clamped.

Note: the invite-token `/redeem` endpoint does NOT verify NIP-98 (token +
pubkey only — see strfry-badge-node `crates/invite/src/main.rs` `redeem()`),
so the proxy origin in the signed `u` tag is not a problem. The admin-only
`POST /invites` DOES verify NIP-98 strictly, which is why bootstrap signs
against `base_url` directly and never routes invite minting through the proxy.

## Commerce scenario (store / orders / events)

A second harness seeds TWO communities on the same coordinator and exercises
the commerce protocol surface (catalog, checkout fulfillment, punch-card
check-ins, RSVPs, the write gate) from pure Node — no emulator needed:

```sh
node .qa/qa-scenario-commerce.mjs   # provision + seed both communities
node .qa/qa-verify-commerce.mjs     # protocol scenario verifier (exits non-zero on failure)
node .qa/qa-teardown.mjs            # deletes both relays, proxies, shim, state files
```

What gets provisioned:

- **QA RN Bar `<runid>`** (community profile `type=hospitality`): catalog
  product "QA Beer" (5.00 EUR, section "Drinks", product_kind drink,
  max_uses 1, sellable, available) + invite (max_redemptions 5). Reached from
  the emulator via `http://10.0.2.2:7820`.
- **QA RN Gym `<runid>`** (community profile `type=sports`): catalog pass
  "QA 10-Session Pass" (49.00 EUR, max_uses 10), calendar event "QA
  Training" (kind 31923, +2 days, 1h, capacity 2) + invite (max_redemptions
  5). Reached via `http://10.0.2.2:7822`.

### State files (two-community layout)

Everything lands in `/tmp/qa-rn-commerce.json` under
`communities.hospitality` / `communities.sports` (relay_url, base_url,
invite token, catalog item addresses/ids, event address, per-community
`proxy_port`). The hospitality entry is ALSO written to the legacy
`/tmp/qa-rn-community.json`, so `qa-verify-redeem.mjs` and the redeem
maestro flows keep working unchanged against the Bar.

### Two-community proxy layout

`qa-redeem-proxy.mjs` now resolves its targets from `QA_COMMUNITY_KEY` +
`QA_COMMERCE_STATE` when set, so the scenario runs one instance per
community: 7820 → Bar, 7822 → Gym (pid files
`/tmp/qa-rn-commerce-proxy-<key>.pid`). A stale single-community proxy on
7820 (from `qa-bootstrap.mjs`) is detected by comparing `/healthz` targets
and aborts the scenario with a "run qa-teardown first" error.

### Checkout shim (:7821)

`qa-checkout-shim.mjs` stands in for `https://nuts.cash/api/stripe/checkout`.
Point the app at it with `EXPO_PUBLIC_NUTS_API_URL=http://10.0.2.2:7821`
(required for the store flows). It sanity-checks the NIP-98 header
(signature, kind, method, payload hash, staleness — but SKIPS the strict
u-tag origin check), maps the `community` ws URL to a commerce-state
community by proxy port, re-fetches the 30009 definition from the strfry
port, applies the same validation as the real `+server.ts` (sellable,
available, product max_uses=1, pass integer max_uses, membership rules,
payable price), then performs the REAL payment `/redeem` POST against the
invite service (signed by the payment-service key — see below) and returns
`{url: http://10.0.2.2:7821/checkout/success}` plus a success page. Every
checkout is logged as `[checkout] …` (stdout; `/tmp/qa-rn-checkout-shim.log`
when spawned detached by the scenario) for the maestro verifier to grep.

The payment-service key: the invite service only accepts payment
redemptions NIP-98-signed by the coordinator's `NUTS_PAYMENT_SERVICE_PUBKEY`
key. Export its corresponding secret as `QA_PAYMENT_SERVICE_SECRET` before
running checkout flows (the local dev value is stored as
`NUTS_PAYMENT_SERVICE_SECRET_KEY` in `/root/code/nuts-cash/.env`). The public
key defaults to the local coordinator value and can be overridden with
`QA_PAYMENT_SERVICE_PUBKEY`. No payment-service secret is stored in this
repository.

### Status kind (37237, addressable)

Order/check-in statuses are kind **37237** (addressable range), with the
fulfillment context in BOTH the legacy context tag (`['order', ref]` /
`['event', address]`) and `['d', 'order:<ref>' | 'event:<address>']`. The `d`
makes the relay keep exactly the latest status per context — durable history,
no eviction. Readers subscribe to `[37237, 27237]` during the transition;
writers publish 37237 only (`badgeStatus` in qa-commerce.mjs;
`legacyBadgeStatus` remains for back-compat pins).

History (2026-07-30): statuses were kind 27237 (NIP-01 ephemeral range).
Stock strfry master stores ephemeral events and serves them to fresh REQs,
but RelayCron deletes them once older than
`events__ephemeralEventsLifetimeSeconds` (default **300 s**, no override in
the badge relay config — verified: 3/3 served at t+300 s, eviction underway
by t+334 s). Use-count history older than ~5 min silently vanished, which is
why the kind moved. Live delivery is STILL the primary channel for the app
screens (subscribe before staff acts), but late subscribers now get the full
history from storage.

### What qa-verify-commerce.mjs pins

- Punch card: 10 fulfilled check-ins (contexts `checkin-<award>-<i>`) on a
  max_uses=10 pass → derivation (`qa-derive.mjs`, a pure port of nuts-cash
  `orders.ts` `latestStatusEvents`/`remainingAwardUses`) says 0 remaining;
  an 11th fulfillment is rejected by the scanner rule DERIVATION-LEVEL —
  while the relay still accepts it (enforcement is client-side).
- Capacity pin: 3 member RSVPs over the capacity-2 event are ALL accepted
  (no server-side capacity enforcement; TODO in the verifier to flip when
  fixed).
- Gate: non-member kind 1 rejected (`blocked: required badge missing`),
  member kind 1 accepted, kind-5 revocation of an award by the badge issuer
  removes it (relay-side NIP-09 + derivation-level). Also pins the 37237
  relay behavior (stored + served to fresh queries, and republishing the
  same `d` serves only the latest — see the rule above).
  Membership for the test users is established directly from Node via the
  invite `/redeem` endpoint (token + pubkey, no NIP-98). Invite tokens carry
  `max_redemptions` and expire after 86400 s — when runs start failing with
  "token redemption limit reached", refresh in place with
  `node .qa/qa-refresh-invites.mjs` (mints new tokens against the SAME
  communities; no re-provision needed).

### Maestro commerce flows (Layer 2)

`qa-verify-event.mjs` drives the purchase/capacity flows through the real app
UI and proves the protocol state from Node:

```sh
# prerequisites: scenario provisioned (above) + Metro running with
#   EXPO_PUBLIC_NUTS_API_URL=http://10.0.2.2:7821 npx expo start --dev-client --port 8084
# (NO CI=1 — the dev launcher auto-discovers Metro and the flows depend on it)
node .qa/qa-verify-event.mjs [store-beer|gym-pass|capacity|entitlement|all]
```

- `entitlement` (member-side entitlement screens, docs/entitlements.md):
  three phases, each seeding a FRESH issuer-signed purchase award first, so
  reruns never depend on purchase history (fully idempotent).
  1. gym pass (users[1]): Store "Yours" strip → Award screen → the dev-build
     `[award-qr]` logcat line is verified derivation-side (signed kind 27236,
     `use:<nonce>` single-use context, gym relay) → Node publishes a staff
     check-in (37237 fulfilled) → the still-open Award screen must tick
     10 → 9 via its live status sub.
  2. beer order (users[0]): Award QR carries the purchase order reference →
     Node publishes 37237 fulfilled with the `['order', ref]` context →
     screen flips to "Served".
  3. event ticket (users[2]): ticket 30009 (`type event_access`, `a` = event
     coordinate) + `entrance_badge` tag added to the QA Training 31923 →
     deep-link `nutsrn:///CalendarEvent?…` (EVENT_URL passed via CLI env;
     `entitlement-ticket.yaml` declares no `env:` block because a subflow's
     own env beats CLI `-e`) → "Your ticket" button → Award screen QR
     carries the event coordinate.
  Note: statuses are kind 37237 (addressable — see the "Status kind"
  section), so a status published before the app's sub opens is served to a
  fresh REQ with no time limit, and only signer-AUTHORIZED statuses count in
  the app (`src/lib/communityTrust.ts` — the QA statuses are signed by the
  relay's NIP-11 admin key, which passes the trust check).

- `store-beer` (users[0]): redeem bar invite in-app → Menu → Buy "QA Beer" →
  shim checkout → Chrome success page → kind-8 award verified on the bar
  relay (`#a` filter required — the membership award shares issuer + #p).
- `gym-pass` (users[1]): redeem gym invite → Get pass → shim → award +
  `remainingAwardUses === 10` derivation.
- `capacity` (users[2] in-app, users[3]/users[4] as RSVP seeds): retracts
  stale RSVPs from prior runs (kind 31925 is addressable — without the reset,
  counts accumulate across runs and the "2 going" assert fails), seeds 2
  accepted RSVPs over the capacity-2 event → `event-capacity-full.yaml`
  asserts Full/disabled on card + event screen → Node cancels one RSVP (newer
  declined) → `event-capacity-rsvp.yaml` deep-links
  `nutsrn:///CalendarEvent?relay=…&address=…` (stopApp:false) and RSVPs →
  kind 31925 verified on the relay.

Flow authoring rules learned the hard way:

- **A subflow's own `env:` block beats BOTH CLI `-e` and `runFlow` env**
  (maestro 2.7) — `redeem.yaml` declares no env defaults; callers pass
  TOKEN/RELAY_PORT/NSEC/COMMUNITY_NAME explicitly. Standalone runs need all
  four `-e` flags.
- Maestro text regexes must match the WHOLE element text — substring asserts
  need `.*….*`.
- Chrome checkout chain: first run shows "Use without an account" then a
  notification prompt ("No thanks"), then the success page — handle both as
  one-time `when:` branches (Chrome state persists across flows).
- Redeem flow: fresh claim can hit the badge-gate membership-cache lag
  (15–45 s) on the kind-0 replica confirm; the app now retries publishes for
  30 s, and the flow has a 3-attempt flat Try-again ladder on top.
- Reruns against the same scenario take the "already a member" path (the
  flows handle it); a full fresh-claim rerun needs a re-provision.

### Web staff flows (Layer 3)

Staff-side coverage lives in the nuts-cash repo's own harness:
`/root/code/nuts-cash/.qa/` — `qa-passes-e2e.mjs` (gym 10-session pass: 10
check-ins via the Active-passes button, 11th rejected by the scanner with
"This entitlement has no uses remaining."), capacity assertions in
`qa-events-e2e.mjs` ("Going 2 / 2", roster, "0 of 2 places remaining"),
`qa-orders-e2e.mjs` + `qa-scan-e2e.mjs` (hospitality order board + QR serve).
`qa-bootstrap.mjs --type sports` provisions the gym archetype. See
SPEC-GAPS.md for the app gaps and infra quirks all three layers pinned.

## Notes / gotchas

- Domain labels use the `rnqa-` prefix on purpose: the nuts-cash
  `.qa/qa-teardown.mjs --sweep` janitor deletes every relay whose domain
  starts with `qa-` on this shared coordinator (it ate a `qa-rn-*` community
  mid-run once). Do not rename back to a `qa-*` prefix.

- The Maestro flow takes the token via `-e TOKEN=...`; everything else in the
  deep link is fixed (`relay=http%3A%2F%2F10.0.2.2%3A7820`).
- Redeem publishes several events with ~2 s timeouts each plus a 12 s relay
  confirmation for the kind-0 replica — the success assertion allows 120 s.
- Redeem also publishes membership indexes to public INDEXER_RELAYS; the
  emulator needs internet.
- Maestro gotchas (covered-node taps, hideKeyboard dismissing modals,
  whole-element text matching) are documented in ../AGENTS.md.
