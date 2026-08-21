const LIGHTNING_INVOICE_SOURCE =
  '(?:lightning:)?ln(?:bc|tb|bcrt|sb)[0-9a-z]{20,}';

const EXACT_LIGHTNING_INVOICE = new RegExp(
  `^${LIGHTNING_INVOICE_SOURCE}$`,
  'i',
);

export type LightningInvoicePart =
  | {type: 'text'; text: string}
  | {type: 'invoice'; invoice: string};

export function normalizeLightningInvoice(value: string) {
  const trimmed = value.trim();
  if (!EXACT_LIGHTNING_INVOICE.test(trimmed)) return null;
  return trimmed.replace(/^lightning:/i, '');
}

export function splitLightningInvoices(text: string): LightningInvoicePart[] {
  const pattern = new RegExp(LIGHTNING_INVOICE_SOURCE, 'gi');
  const parts: LightningInvoicePart[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({type: 'text', text: text.slice(cursor, match.index)});
    }

    const invoice = normalizeLightningInvoice(match[0]);
    if (invoice) parts.push({type: 'invoice', invoice});
    cursor = match.index + match[0].length;
  }

  if (!parts.length) return [{type: 'text', text}];
  if (cursor < text.length) {
    parts.push({type: 'text', text: text.slice(cursor)});
  }
  return parts;
}
