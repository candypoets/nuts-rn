# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

(Single RN design language shipped identically on iOS — confirmed 2026-07-30.
Android is the dev/test host; iOS parity is inherited, not separately designed.)

## Users

Community members/customers of nostr communities (gyms, bars & hospitality,
clubs) using the Nuts RN app. Two confirmed primary scenes, equal priority:

- **At the venue:** at the gym door / at the bar — needs their entitlement QR
  in ~2 taps, readable at arm's length, tolerant of bad connectivity.
- **Browsing at home:** checking what they own — remaining sessions on a pass,
  order status, event tickets — where richer detail matters.

Staff/admin users are explicitly OUT of scope for the RN app (confirmed
2026-07-30: "the goal of the native app is client side only"); staff tooling
lives in the nuts-cash web app.

## Product Purpose

Nuts is a nostr-native community client: feeds, chat, cashu wallet, and
community commerce — members discover communities, redeem invites, buy
products/passes/memberships, RSVP to (capacity-gated) events, and present
their entitlements at the venue. Success: the full
buy → hold → present → get-served loop works entirely from the phone.

## Positioning

No central account: identity is a nostr key, money is cashu ecash, and
entitlements are protocol objects (kind-8 badge awards, kind-27236
presentation, kind-27237 status) whose truth lives on community relays.
A neighboring product cannot copy "your gym membership is a nostr badge you
hold, not a row in the gym's database."

## Operating Context

- The nuts-cash web app (`/root/code/nuts-cash`) is the staff/admin side and
  the spec reference; `src/lib/orders.ts` there is the canonical
  remaining-uses/status derivation, `src/lib/presentation.ts` the canonical
  entitlement-QR format (`nuts:present:` + signed kind 27236).
- QA harness: `.qa/` Node scripts + Maestro flows (`.qa/README.md`,
  `.qa/SPEC-GAPS.md`); single Android emulator, headless.

## Capabilities and Constraints

- RN + expo-router + NativeWind (theme class tokens: `bg-primary`,
  `text-base-content`, …), nipworker for nostr I/O.
- Stripe checkout is bypassed in QA via a local shim that issues real kind-8
  awards; production checkout redirects to nuts.cash.
- Known app gaps blocking the venue loop (from `.qa/SPEC-GAPS.md`): no award
  surface, no 27236 QR, no remaining-uses display, no customer order status.
- Kind 27237 is NIP-01-ephemeral but stock strfry stores+serves it; treat as
  live-subscription data in app code.
- No server-side enforcement of capacity or max uses — client-side derivation
  is the source of truth shown to users.

## Brand Commitments

Name: Nuts (nuts.cash); package `com.nutsrn`; existing assets
(`assets/nutscash.svg`, app icons, splash). Voice: existing app copy
("Get pass", "You are going", "Who's going").

## Evidence on Hand

- QA harness + findings: `.qa/`, `.qa/SPEC-GAPS.md`.
- Web spec reference implementation: `/root/code/nuts-cash`
  (`_kinds/kind8.svelte` award detail, storefront, admin orders/events).
- No user testimonials, metrics, or press — do not fabricate any.

## Product Principles

1. Client-side only: the RN app serves the member, never the staff console.
2. Protocol truth: everything shown derives from relay events; no local-only
   invention.
3. Two-tap venue path: from cold open to a presentable QR in ~2 taps.
4. One design language: same components and tokens on both OSes.
5. Follow the web spec: reuse nuts-cash formats and derivations verbatim so
   staff-side verification always agrees with what the member sees.
