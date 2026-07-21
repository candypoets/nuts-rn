import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { NostrEventCreation } from '../src/modals/post/EventComposer';

jest.mock('@react-native-menu/menu', () => {
  const ReactModule = require('react');
  return {
    MenuView: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

function props(onPublish = jest.fn()) {
  return {
    access: 'everyone' as const,
    badges: [],
    canPublish: true,
    capacity: '40',
    category: 'social' as const,
    communities: [],
    communityRelays: [],
    cover: null,
    currency: 'EUR',
    endsAt: '2026-08-28T22:00',
    isPublishing: false,
    location: 'Rooftop 22',
    onBack: jest.fn(),
    onChangeAccess: jest.fn(),
    onChangeCapacity: jest.fn(),
    onChangeCategory: jest.fn(),
    onChangeCommunityRelays: jest.fn(),
    onChangeCover: jest.fn(),
    onChangeCurrency: jest.fn(),
    onChangeEndsAt: jest.fn(),
    onChangeLocation: jest.fn(),
    onChangePaid: jest.fn(),
    onChangePrice: jest.fn(),
    onChangeSats: jest.fn(),
    onChangeStartsAt: jest.fn(),
    onChangeSummary: jest.fn(),
    onChangeTitle: jest.fn(),
    onClose: jest.fn(),
    onPublish,
    onToggleBadge: jest.fn(),
    paid: false,
    price: '',
    publishLabel: 'Post',
    sats: '',
    startsAt: '2026-08-28T18:30',
    summary: 'An evening for members and friends.',
    title: 'Summer Rooftop Social',
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 6, 21, 16, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

function textContent(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAll(node => typeof node.props.children === 'string')
    .map(node => node.props.children)
    .join(' ');
}

function press(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const target = renderer.root
    .findAll(node => typeof node.props.onPress === 'function')
    .find(node => node.props.accessibilityLabel === label);
  if (!target) throw new Error(`Missing button: ${label}`);
  ReactTestRenderer.act(() => target.props.onPress());
}

test('walks through the four event steps and publishes from review', async () => {
  const onPublish = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <NostrEventCreation {...props(onPublish)} />,
    );
  });

  expect(textContent(renderer)).toContain('Tell people what’s happening');
  expect(textContent(renderer)).not.toContain('Hosted by');
  press(renderer, 'Continue to next step');
  expect(textContent(renderer)).toContain('When and where?');
  press(renderer, 'Continue to next step');
  expect(textContent(renderer)).toContain('Access & pricing');
  expect(textContent(renderer)).toContain('Target audience');
  press(renderer, 'Continue to next step');
  expect(textContent(renderer)).toContain('Ready to publish?');
  expect(textContent(renderer)).toContain('Summer Rooftop Social');

  press(renderer, 'Publish event');
  expect(onPublish).toHaveBeenCalledTimes(1);
});

test('opens the native calendar and applies its selected date', async () => {
  const eventProps = props();
  let renderer!: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<NostrEventCreation {...eventProps} />);
  });

  press(renderer, 'Continue to next step');
  press(renderer, 'Event date');

  const picker = renderer.root.findByProps({
    testID: 'event-date-time-picker',
  });
  expect(picker.props.minimumDate).toEqual(new Date(2026, 6, 21));

  ReactTestRenderer.act(() => {
    picker.props.onChange({ type: 'set' }, new Date(2026, 6, 20, 12, 0));
  });

  expect(eventProps.onChangeStartsAt).not.toHaveBeenCalled();
  expect(eventProps.onChangeEndsAt).not.toHaveBeenCalled();

  const selectedDate = new Date(2026, 8, 2, 12, 0);

  ReactTestRenderer.act(() => {
    picker.props.onChange({ type: 'set' }, selectedDate);
  });

  expect(eventProps.onChangeStartsAt).toHaveBeenCalledWith('2026-09-02T18:30');
  expect(eventProps.onChangeEndsAt).toHaveBeenCalledWith('2026-09-02T22:00');
});

test('blocks an event whose start time is in the past', async () => {
  const eventProps = {
    ...props(),
    startsAt: '2026-07-21T15:00',
    endsAt: '2026-07-21T18:00',
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<NostrEventCreation {...eventProps} />);
  });

  press(renderer, 'Continue to next step');
  expect(textContent(renderer)).toContain('Start time must be in the future.');

  const continueButton = renderer.root.findByProps({
    accessibilityLabel: 'Continue to next step',
  });
  expect(continueButton.props.accessibilityState.disabled).toBe(true);
});

test('selects more than one target community from the access step', async () => {
  const firstRelay = 'wss://one.example';
  const secondRelay = 'wss://two.example';
  const eventProps = {
    ...props(),
    communities: [
      { role: 'owner', url: firstRelay },
      { role: 'member', url: secondRelay },
    ],
    onChangeCommunityRelays: jest.fn(),
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<NostrEventCreation {...eventProps} />);
  });

  press(renderer, 'Continue to next step');
  press(renderer, 'Continue to next step');
  press(renderer, 'Community one.example');
  expect(eventProps.onChangeCommunityRelays).toHaveBeenLastCalledWith([
    firstRelay,
  ]);

  await ReactTestRenderer.act(() => {
    renderer.update(
      <NostrEventCreation {...eventProps} communityRelays={[firstRelay]} />,
    );
  });
  press(renderer, 'Community two.example');
  expect(eventProps.onChangeCommunityRelays).toHaveBeenLastCalledWith([
    firstRelay,
    secondRelay,
  ]);
});
