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

## Protocol surface (no new formats — ports only)

- **Award** = kind 8, `#a` = 30009 badge-definition address, `#p` = holder.
- **Status** = kind **37237** (addressable — was ephemeral 27237 until
  2026-07-30; strfry's RelayCron evicted those ~300 s after publish, silently
  erasing use-count history). `#e` = award id, `status` tag, exactly one
  context tag (`['order', id]` or `['event', coordinate]`) plus `['d',
  'order:<id>' | 'event:<coordinate>']` — the `d` makes the relay keep only
  the latest status per context. Readers accept BOTH kinds during the
  transition (`LEGACY_BADGE_STATUS_KIND`); writers publish 37237 only. Only
  statuses from authorized signers count (community trust / staff roles —
  `src/lib/communityTrust.ts`, port of web `adminAccess.ts`).
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
| `src/hooks/useAwards.ts` | Hooks: `useMyAwards(relay, pubkey, visible)` (kind 8 `#p` + 30009 defs by `#d`+author), `useAwardStatuses(relay, awardIds, visible)` (kinds `[37237, 27237]` `#e`, live, signer-authorized via `communityTrust.ts`). Follows the `useSubscription` conventions from StoreSub. Subscription ids MUST include the relay url AND a full hash of the id set (prefix slices collide across screens — nipworker silently reuses the other sub's buffer). |
| `src/lib/communityTrust.ts` | Port of web `adminAccess.ts` (member-side subset): relay authority pubkeys (NIP-11 admin fields + `/community/info` badge issuer) and role-award permission resolution; `fetchStatusSignerAuthorized(relay, signer)` gates which statuses count. |
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
5. Expired/revoked states render distinctly (status from derivation; kind-5
   handling deferred — noted in SPEC-GAPS).

Passes list: rows grouped by community (name, type pill, remaining uses or
status, chevron). StoreSub strip: single compact row per award, same content,
tap-through. CalendarEventModal: "Your ticket" primary-toned button under the
RSVP area when a matching award exists.

Copy: existing app voice ("You are going" register). No i18n (project norm).

## Maestro scenario (extends `qa-verify-event.mjs`)

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
- Kind-5 revocation display, membership-expiration UI.
- Offline QR verification (staff side verifies online; out of RN scope).
