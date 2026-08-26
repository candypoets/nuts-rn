# Entitlements (member-side) — screen spec

Bucket-A implementation spec. Reference: PRODUCT.md (users/scenes),
`.qa/SPEC-GAPS.md` (the gaps this closes). Web spec sources of truth:
nuts-cash `src/lib/presentation.ts` (QR format), `src/lib/orders.ts` +
`src/routes/notifications/notifications.ts` (derivations),
`src/lib/eventAccess.ts` (ticket badge linking). Mode: **Operate**.

## Scope

Client-side only. The member can: see what they hold per community and across
communities, present a scannable entitlement QR at the venue, and track
order/pass status. No staff actions anywhere.

## Protocol surface (NIP-97)

- **Trust** = relay NIP-11 `pubkey` → current root-signed kind `31727`,
  `d=community` anchor. Its `p` tags are admins and `badge_issuer` is the
  delegated issuer. `/community/info` is never used for authorization.
- **Definition** = kind `30009` for roles/memberships, kind `30402` for
  products/passes/tickets, or a free calendar event (`31922`/`31923`).
- **Award** = kind 8, `#a` = definition address, `#p` = holder. Priced
  definitions may be awarded by an anchor admin or `badge_issuer`; unpriced
  definitions require an anchor admin.
- **Status** = kind **37237**. `#e` = award id, `status` tag, exactly one
  context tag (`['order', id]` or `['event', coordinate]`) plus `['d',
  'order:<id>' | 'event:<coordinate>']` — the `d` makes the relay keep only
  the latest status per context. Only statuses from anchor admins,
  `badge_issuer`, or holders of a valid `37237`-write role award count.
- **Presentation QR** = `nuts:present:<base64url(JSON(signed kind 27236))>`,
  tags: `type=nuts_entitlement_presentation`, `expiration=created+90`,
  `nonce`, `e`=award id, `a`=badge address, `r`=community relay (ws URL),
  exactly one of `order`/`event`. 90 s lifetime → re-sign on a ~60 s timer
  while visible. Signed with `signEvent` from `src/nostr/upload.ts` (works for
  nsec, NIP-46, Amber).
- **Ticket linking**: an event (31923) carries `entrance_badge <badgeAddress>`;
  the member's ticket is the award whose `#a` matches. Badge d-tag convention:
  `event-<eventD>-entrance`.

## New/changed files

| File | What |
|---|---|
| `src/lib/orders.ts` | Port of the derivation: `latestStatusEvents` (latest per context by created_at, lower-id tie-break), `fulfilledUseCount`, `remainingAwardUses`, `awardOrderReference`, `isAwardExpired`, status labels. ParsedEvent stays a FlatBuffer view; strings materialized in accessors only. |
| `src/nostr/presentation.ts` | Port of web `presentation.ts` (template builder + encode/decode + validators), `buildEntitlementPresentation(input)` → `signEvent` → `encodePresentation`. Reuses `base64UrlEncode` from `src/nostr/upload.ts`; nonce via `expo-crypto` if present, else secure-random fallback (NOT `crypto.randomUUID` — absent in Hermes). |
| `src/lib/nip97.ts` | Anchor, definition-kind, address, and permission primitives. |
| `src/hooks/useAwards.ts` | Hooks: `useMyAwards` resolves kind-8 candidates, their NIP-97 definitions and kind-5 revocations against the current anchor; `useAwardStatuses` subscribes to 37237 and filters unauthorized signers. Subscription ids include the relay and a full hash of the id set. |
| `src/lib/communityTrust.ts` | Resolves NIP-11 root → 31727 anchor from the community relay and evaluates award/status signer authorization and kind-scoped role permissions. |
| `src/app/Award.tsx` + `src/modals/AwardModal.tsx` | Award detail screen (the core). Route params: `relay`, `award` (event id). Registered in `src/app/_layout.tsx` as `<Stack.Screen name="Award" options={{presentation:'modal'}}/>`. |
| `src/app/Passes.tsx` + `src/modals/PassesModal.tsx` | Cross-community "your passes & memberships" list. Entry: new `ProfileMenuRow` "Passes" in ProfileModal. |
| `src/subs/StoreSub.tsx` | "Yours" strip above the catalog: member's awards on THIS community relay (name + remaining uses/status), tap → Award. |
| `src/modals/CalendarEventModal.tsx` | "Your ticket" button when the event has `entrance_badge` and the member holds a matching award on the community relay → Award. |

## Award screen (the design contract)

THESIS: the QR IS the screen. A venue-ready presentation card, not a receipt
page with a QR buried at the bottom. Refuses the default "detail list + small
QR" arrangement.

Composition (follows active theme except where noted):

1. **Presentation card** (top, ~70% width, centered): white surface
   REGARDLESS of theme — scanners need contrast; this is the one deliberate
   theme break, like a physical badge. Big QR (`react-native-qrcode-svg`,
   quiet zone ≥ 8), regenerating on the 60 s re-sign timer with a subtle
   countdown affordance. Tap → fullscreen present mode (max-size QR, minimal
   chrome, system Back exits — Android back contract).
2. **What you hold**: item name (title), community name, type pill
   (product/pass/membership/ticket — reuses catalog type labels).
3. **Uses**: for multi-use, the number leads — "7 of 10 sessions left" (large
   count, no progress ring). For single-use: status line instead ("Ready to
   serve", "Served", …).
4. **Activity**: latest status per context, most recent first (check-ins or
   order ladder steps), timestamped. Empty state explains the loop ("Show the
   QR to staff to redeem").
5. Expired or revoked awards are excluded after NIP-97 validity resolution.

Passes list: rows grouped by community (name, type pill, remaining uses or
status, chevron). StoreSub strip: single compact row per award, same content,
tap-through. CalendarEventModal: "Your ticket" primary-toned button under the
RSVP area when a matching award exists.

Copy: existing app voice ("You are going" register). No i18n (project norm).

## Agent Device scenario (extends `qa-verify-event.mjs`)

New `entitlement` scenario, runnable after store-beer/gym-pass on the same
provisioned state:

1. After buying the gym pass: open StoreSub → "Yours" strip shows the pass →
   tap → Award screen shows QR + "10 of 10 sessions left".
2. Node seeds ONE fulfilled check-in (37237, `checkin-` context, admin-signed)
   → app shows "9 of 10 sessions left" (full-loop proof: staff action changes
   what the member sees).
3. QR payload check from Node: the screen's signed 27236 is verified
   derivation-side (decode + `verifyEntitlementPresentation` port in
   `.qa/qa-derive.mjs`) — asserted via a dev log line or a copy-to-clipboard
   affordance, not pixels.
4. Beer: Award screen shows order status line; Node publishes `fulfilled` →
   app shows "Served".
5. Ticket: seed event with `entrance_badge` + ticket award →
   CalendarEventModal shows "Your ticket" → Award screen presents the
   `event`-context QR.

## Deferrals (stay in SPEC-GAPS)

- Notifications entries for 37237 order updates (separate feature).
- Dedicated revocation/expiration history UI (invalid awards are already excluded).
- Offline QR verification (staff side verifies online; out of RN scope).
