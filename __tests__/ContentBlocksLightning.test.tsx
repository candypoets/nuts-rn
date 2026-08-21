import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {ContentData, type ContentBlock} from '@candypoets/nipworker';

import {ContentBlocks} from '../src/components/notes/ContentBlocks';

const INVOICE =
  'lnbc2500u1p5examplepp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({navigate: jest.fn()}),
}));

jest.mock('@candypoets/nipworker/utils', () => ({
  asLightningData: (block: {lightning?: unknown}) => block.lightning ?? null,
}));

jest.mock('../src/components/LightningInvoiceCard', () => {
  const ReactModule = require('react');
  const {Text} = require('react-native');
  return {
    LightningInvoiceCard: ({invoice}: {invoice: string}) =>
      ReactModule.createElement(
        Text,
        {accessibilityLabel: 'Rendered Lightning invoice'},
        invoice,
      ),
  };
});

test('renders Nipworker LightningData with the invoice widget', () => {
  const block = {
    dataType: () => ContentData.LightningData,
    lightning: {invoice: () => INVOICE},
    text: () => `lightning:${INVOICE}`,
    type: () => 'lightning',
  } as unknown as ContentBlock;
  let renderer: ReactTestRenderer.ReactTestRenderer;

  act(() => {
    renderer = ReactTestRenderer.create(<ContentBlocks content={[block]} />);
  });

  const widget = renderer!.root.findByProps({
    accessibilityLabel: 'Rendered Lightning invoice',
  });
  expect(widget.props.children).toBe(INVOICE);

  act(() => renderer!.unmount());
});
