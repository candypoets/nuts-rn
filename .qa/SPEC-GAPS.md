# SPEC-GAPS — RN app vs web spec, and infrastructure findings

Findings from building the commerce QA harness (Layers 1–3: protocol seeding,
Maestro purchase/capacity flows, Playwright staff flows). Date: 2026-07-30.
The web app (`/root/code/nuts-cash`, esp. the admin dashboard) is the spec
reference; `src/lib/orders.ts` there is the canonical derivation.

## RN app gaps vs the web spec

- **Coordinated web checkout deployment required.** RN now submits NIP-97
  `30402` product/pass addresses. The sibling nuts-cash production checkout
  handler still accepts the pre-NIP `30009` catalog shape as of 2026-08-04;
  deploy its NIP-97 checkout migration before releasing this RN change. The
  local `.qa/qa-checkout-shim.mjs` already validates the new shape.
- ~~**No remaining-uses display.**~~ CLOSED (2026-07-30): `src/lib/orders.ts`
  ports the derivation; shown in the StoreSub "Yours" strip, Passes screen,
  and Award screen.
- ~~**No entitlement presentation (kind 27236) in RN.**~~ CLOSED (2026-07-30):
  `src/nostr/presentation.ts` ports the web format; the Award screen signs and
  shows the QR (90 s lifetime, 60 s re-sign), incl. fullscreen present mode.
- ~~**No customer order-status view.**~~ CLOSED (2026-07-30): the Award
  screen's status line + activity list (live 37237 subscription). No
  notifications integration yet (below).
- **No order/status (kind 37237) notifications in RN.** Statuses are visible
  on the Award screen, but there is no notification entry ("Your beer is
  ready") — web treats these via notifications.ts; RN has nothing.
- **RSVP ignores badge gating.** `CalendarEventModal` RSVPs without regard to
  the event's `required_badge` — no entitlement check at RSVP time. (Ticket
  *presentation* landed 2026-07-30: an `entrance_badge` tag surfaces a "Your
  ticket" button that opens the Award screen with the event-context QR.)
- **No admin surface at all in RN** (catalog management, event creation with
  capacity, orders board, roles). Expected for now, but listed for
  completeness.
- **Invite generation stub.** `CommunitySub.tsx:623` `Invite` button does
  nothing; invite minting is web-only.
- **Memberships page web-only** (no RN equivalent of the memberships admin
  view).
- **MenuRow omits the uses pill.** In hospitality menu presentation the row
  renders no detail pill; "10 uses" only appears in catalog presentation
  (CatalogCard). Cosmetic, but it cost a maestro assertion.

## App bugs FIXED while building the harness (2026-07-29/30)

- `CalendarEventModal` ignored RSVP cancellations: declined RSVPs were not
  honored and there was no latest-per-pubkey resolution, so a retracted spot
  never freed up. Fixed with a latest createdAt+status per-pubkey ref.
- `CalendarEventModal` crashed (redbox) when opened by deep link without an
  `address` param (`splitAddress` on undefined). Fixed with a guard.
- `publishProfileToCommunity` (invites.ts) made a single kind-0 publish
  attempt with a 12 s timeout — fresh redeems failed with "The community
  relay did not confirm your profile." whenever the badge gate's membership
  cache lagged (see infra findings). Fixed: retry on `false` OK every 2.5 s,
  30 s window.
- `RedeemModal` retry burned another invite redemption (cap exhaustion showed
  as "token redemption limit reached"). Fixed: retry first checks
  `checkExistingMembership` and short-circuits to done.
- SignupModal: missing top safe-area inset (header under the status bar on
  edge-to-edge Android — uiautomator DROPS covered nodes, so maestro
  selectors silently failed) and a `popToTop` navigation issue. Fixed earlier
  in the session.

## Infrastructure findings (not app bugs)

- **Intermittent native crash on cold bundle load (2026-07-30).** Once in ~6
  suite runs, the app SIGSEGVs right after the dev client connects and the JS
  bundle mounts: `Fatal signal 11 (SEGV_ACCERR)` in `mqt_v_js`,
  `facebook::react::MountingCoordinator::pullTransaction` →
  `ShadowTree::tryCommit` (libreactnative.so, new-arch Fabric). Android then
  returns to the previously foreground app, so a maestro flow fails
  mysteriously on its landing assert with a stale screen in the screenshot.
  Diagnose via `adb logcat -d | grep 'F DEBUG'` before blaming the flow.
  Root cause unknown; looks like a Fabric mounting race, not app JS.

- **Badge-gate membership cache lag (15–45 s).** A just-granted invite award
  is not immediately visible to the strfry-badge gate, so a fresh member's
  first publishes (e.g. the redeem flow's kind-0 replica) are rejected. The
  app-side fix above papers over it; the durable fix belongs in the gate
  (react to award events) or the redeem flow (grant → wait-for-gate).
- **Gate cache never un-caches revoked members.** Membership revocation is
  not honored until gate restart (pinned in qa-commerce.mjs).
- ~~**Ephemeral fulfillment history**~~ RESOLVED: NIP-97 kind **37237** is
  addressable (`d` = `order:<ref>` / `event:<address>`), so a relay swap does
  not depend on non-standard ephemeral retention. Readers and writers use
  37237 only.
- **No server-side capacity enforcement.** 3 accepted RSVPs over a capacity-2
  event are all accepted by the relay; "Full" is purely a client-side
  derivation (pinned in qa-verify-commerce.mjs with a TODO to flip the
  assertion if enforcement ever lands). Same for the 11th check-in of a
  10-use pass: rejected client-side only (pass drops out of "Active passes";
  scanner reports "This entitlement has no uses remaining."). The relay
  accepts any admin-signed 37237.

## Harness-level notes

- nuts-cash `qa-bootstrap.mjs` had a canCreate race (creator-profile lookup
  vs public index relays left the create form unsubmittable); fixed with a
  90 s poll. Harness race, not an app bug.
- Kind 31925 (RSVP) is addressable → latest per pubkey wins; test seeding
  must retract stale RSVPs before re-seeding or counts accumulate across
  runs (qa-verify-event.mjs capacity() does this reset).
