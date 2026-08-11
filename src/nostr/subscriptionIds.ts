// Nipworker optimistic ids select active subscription keys by substring.
// Keep the trailing separator so each prefix targets only its intended family.
export function kind1RepliesSubIdPrefix(rootId: string) {
  return `replies_${rootId}_`;
}

export function noteSubIdPrefix(noteId: string) {
  return `note_${noteId}_`;
}

export function footerSubIdPrefix(noteId: string) {
  return `f_${noteId}_`;
}

export function footerQuoteSubIdPrefix(noteId: string) {
  return `fq_${noteId}_`;
}

export function replyOptimisticSubIds(parentId: string, rootId: string) {
  return [
    kind1RepliesSubIdPrefix(rootId),
    noteSubIdPrefix(parentId),
    footerSubIdPrefix(parentId),
  ];
}

export function quoteOptimisticSubIds(noteId: string) {
  return [footerQuoteSubIdPrefix(noteId)];
}
