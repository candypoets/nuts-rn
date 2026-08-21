import {
  normalizeLightningInvoice,
  splitLightningInvoices,
} from '../src/lib/lightningInvoice';

const INVOICE =
  'lnbc2500u1p5examplepp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

test('normalizes a lightning URI to its BOLT11 payment request', () => {
  expect(normalizeLightningInvoice(`LIGHTNING:${INVOICE.toUpperCase()}`)).toBe(
    INVOICE.toUpperCase(),
  );
  expect(normalizeLightningInvoice('lnbc-short')).toBeNull();
});

test('splits an invoice out of surrounding article prose', () => {
  expect(splitLightningInvoices(`Please pay ${INVOICE}. Thank you.`)).toEqual([
    {type: 'text', text: 'Please pay '},
    {type: 'invoice', invoice: INVOICE},
    {type: 'text', text: '. Thank you.'},
  ]);
});

test('leaves ordinary Lightning prose untouched', () => {
  expect(splitLightningInvoices('Lightning payments are fast.')).toEqual([
    {type: 'text', text: 'Lightning payments are fast.'},
  ]);
});
