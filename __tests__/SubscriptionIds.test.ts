import {
  footerQuoteSubIdPrefix,
  replyOptimisticSubIds,
  quoteOptimisticSubIds,
} from '../src/nostr/subscriptionIds';

describe('optimistic subscription ids', () => {
  it('targets reply views without touching the quote counter', () => {
    const subIds = replyOptimisticSubIds('parent-id', 'root-id');

    expect(subIds).toEqual([
      'replies_root-id_',
      'note_parent-id_',
      'f_parent-id_',
    ]);
    expect(subIds).not.toContain(footerQuoteSubIdPrefix('parent-id'));
  });

  it('targets only the quote counter for quotes', () => {
    expect(quoteOptimisticSubIds('quoted-id')).toEqual(['fq_quoted-id_']);
  });
});
