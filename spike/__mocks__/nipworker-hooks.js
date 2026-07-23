// Spike mock for @candypoets/nipworker/hooks
module.exports = {
  useSubscription: jest.fn(() => () => {}),
  usePublish: jest.fn(async () => ({ ok: true })),
  useSignEvent: jest.fn(async (e) => ({ ...e, id: 'fakeid', sig: 'fakesig' })),
  useRelayStatus: jest.fn(() => []),
};
