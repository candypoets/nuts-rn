import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Linking} from 'react-native';

import {LightningInvoiceCard} from '../src/components/LightningInvoiceCard';

const mockSetStringAsync = jest.fn();
const INVOICE =
  'lnbc2500u1p5examplepp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args: unknown[]) => mockSetStringAsync(...args),
}));

jest.mock('../src/theme', () => ({
  useAppTheme: () => ({
    colors: {
      primaryContent: '#64748b',
      warning: '#f59e0b',
    },
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSetStringAsync.mockResolvedValue(true);
});

test('opens the invoice in an installed Lightning wallet', async () => {
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  let renderer: ReactTestRenderer.ReactTestRenderer;

  act(() => {
    renderer = ReactTestRenderer.create(
      <LightningInvoiceCard invoice={INVOICE} />,
    );
  });

  const openWallet = renderer!.root.find(
    node => node.props.accessibilityLabel === 'Open Lightning wallet',
  );
  await act(async () =>
    openWallet.props.onPress({stopPropagation: jest.fn()}),
  );

  expect(openUrl).toHaveBeenCalledWith(`lightning:${INVOICE}`);
  expect(mockSetStringAsync).not.toHaveBeenCalled();
  act(() => renderer!.unmount());
});

test('copies the invoice when no Lightning wallet can open it', async () => {
  jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('No handler'));
  let renderer: ReactTestRenderer.ReactTestRenderer;

  act(() => {
    renderer = ReactTestRenderer.create(
      <LightningInvoiceCard invoice={INVOICE} />,
    );
  });

  const openWallet = renderer!.root.find(
    node => node.props.accessibilityLabel === 'Open Lightning wallet',
  );
  await act(async () =>
    openWallet.props.onPress({stopPropagation: jest.fn()}),
  );

  expect(mockSetStringAsync).toHaveBeenCalledWith(INVOICE);
  expect(renderer!.root.findByProps({accessibilityLiveRegion: 'polite'})).toBeTruthy();
  act(() => renderer!.unmount());
});
