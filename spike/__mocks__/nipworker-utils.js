// Spike mock for @candypoets/nipworker/utils
const identity = (x) => x;
module.exports = {
  asConnectionStatus: identity,
  asKind0: identity,
  asKind1: identity,
  asKind6: identity,
  asKind7: identity,
  asKind20: identity,
  asKind22: identity,
  asNip51: identity,
  asParsedEvent: identity,
  asPreGeneric: identity,
  isConnectionStatus: () => false,
  isKind0: () => false,
  isKind10002: () => false,
  fbArray: () => [],
  connectWithQRCode: jest.fn(async () => undefined),
};
