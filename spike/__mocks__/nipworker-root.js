// Spike mock for @candypoets/nipworker (root entry).
// App code uses MessageType enum values and a few FlatBuffers generated classes.
const MessageType = {
  Event: 1,
  Eose: 2,
  Ok: 3,
  Closed: 4,
  Notice: 5,
  Auth: 6,
  Count: 7,
  ConnectionStatus: 8,
};

class FakeFbTable {}

module.exports = {
  MessageType,
  ContentData: FakeFbTable,
  ParsedData: FakeFbTable,
  Kind30023Parsed: FakeFbTable,
  Kind1018Parsed: FakeFbTable,
  Kind1068Parsed: FakeFbTable,
  PollType: { Single: 0, Multiple: 1 },
};
