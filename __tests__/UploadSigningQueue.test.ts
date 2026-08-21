const mockSignCallbacks: Array<(event: unknown) => void> = [];

jest.mock('@candypoets/nipworker/hooks', () => ({
  useSignEvent: jest.fn(),
}));

import { resetSignEventQueue, signEvent } from '../src/nostr/upload';

const mockUseSignEvent = jest.requireMock('@candypoets/nipworker/hooks')
  .useSignEvent as jest.Mock;

const template = (content: string) => ({
  kind: 1,
  created_at: 1,
  tags: [],
  content,
});

describe('upload signing queue', () => {
  beforeEach(() => {
    mockSignCallbacks.length = 0;
    mockUseSignEvent.mockReset();
    mockUseSignEvent.mockImplementation(
      (_template: unknown, callback: (event: unknown) => void) => {
        mockSignCallbacks.push(callback);
      },
    );
    resetSignEventQueue();
  });

  it('allows a new session to sign after an old remote request never resolves', async () => {
    signEvent(template('stuck'));
    await new Promise<void>(resolve => setImmediate(() => resolve()));
    expect(mockUseSignEvent).toHaveBeenCalledTimes(1);

    resetSignEventQueue();
    const fresh = signEvent(template('fresh'));
    await new Promise<void>(resolve => setImmediate(() => resolve()));
    expect(mockUseSignEvent).toHaveBeenCalledTimes(2);

    mockSignCallbacks[1]({
      ...template('fresh'),
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: 'c'.repeat(128),
    });
    await expect(fresh).resolves.toMatchObject({ content: 'fresh' });
  });
});
