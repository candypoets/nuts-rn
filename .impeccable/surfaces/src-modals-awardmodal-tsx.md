---
version: 1
slug: "src-modals-awardmodal-tsx"
primary_target: "src/modals/AwardModal.tsx"
related_targets: ["src/modals/PassesModal.tsx","src/subs/StoreSub.tsx"]
---

Scope: Award entitlement detail screen (+ Passes list, StoreSub strip entries). Visitor mode: Operate.

Audience/job: community member, two scenes equally — at the venue (QR in ~2 taps, arm's-length readable, spotty connectivity) and browsing at home (remaining uses, order status, ticket). Action: present the QR; understand what they hold and its state.

Proof/content: live protocol data only — kind-8 award, NIP-97 definition (30009/30402), 37237 statuses, re-signed 27236 presentation QR (90 s lifetime, 60 s re-sign). Constraints: RN + NativeWind tokens, one deliberate theme break (white QR presentation card for scanner contrast); Android system Back must exit present mode; no staff actions.

Chosen direction: the QR IS the screen — presentation card first and dominant, ownership facts second, activity last. Memorable moment: tap-to-present fullscreen QR.

Unresolved: kind-5 revocation display; notifications integration (deferred per docs/entitlements.md).
