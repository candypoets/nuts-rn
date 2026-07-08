import Foundation
import NipworkerSwift

struct NativeProfileSnapshot: Equatable {
  let pubkey: String
  let name: String
  let displayName: String
  let nip05: String
  let picture: String

  var bestName: String {
    if !name.isEmpty { return name }
    if !displayName.isEmpty { return displayName }
    return NativeProfileHook.shortPubkey(pubkey)
  }
}

final class NativeProfileHook {
  var onProfile: ((NativeProfileSnapshot) -> Void)?

  private var subscription: NipworkerHookHandle?
  private var subscriptionKey = ""

  deinit {
    cancel()
  }

  func cancel() {
    subscription?.cancel()
    subscription = nil
    subscriptionKey = ""
  }

  func update(pubkey: String, relays: [String], visible: Bool) {
    let cleanPubkey = pubkey.trimmingCharacters(in: .whitespacesAndNewlines)
    guard visible, !cleanPubkey.isEmpty else {
      cancel()
      return
    }

    let lookupRelays = NativeProfileHook.normalizedRelays(relays)
    let nextKey = "\(cleanPubkey)|\(lookupRelays.joined(separator: ","))"
    if subscriptionKey == nextKey { return }

    cancel()
    subscriptionKey = nextKey
    let requestedPubkey = cleanPubkey
    subscription = useSubscriptionHandle(
      subscriptionId: "u_\(requestedPubkey)",
      requests: [
        RequestObject(authors: [requestedPubkey], kinds: [0], limit: 1, relays: lookupRelays, closeOnEOSE: true, cacheFirst: true)
      ],
      callback: { [weak self] messages in
        DispatchQueue.main.async {
          self?.handle(messages: messages, requestedPubkey: requestedPubkey)
        }
      },
      options: SubscriptionConfig(closeOnEose: true, cacheFirst: true)
    )
  }

  static func shortPubkey(_ pubkey: String) -> String {
    if pubkey.isEmpty { return "unknown" }
    return "\(pubkey.prefix(12))..."
  }

  private func handle(messages: [WorkerMessageView], requestedPubkey: String) {
    for message in messages {
      guard message.parsedEvent?.pubkey == requestedPubkey, let profile = message.kind0 else { continue }
      onProfile?(NativeProfileSnapshot(
        pubkey: requestedPubkey,
        name: profile.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
        displayName: profile.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
        nip05: profile.nip05?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
        picture: profile.picture?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      ))
      return
    }
  }

  private static func normalizedRelays(_ values: [String]) -> [String] {
    var seen = Set<String>()
    var result: [String] = []
    for value in values {
      var relay = value.trimmingCharacters(in: .whitespacesAndNewlines)
      while relay.hasSuffix("/") {
        relay.removeLast()
      }
      guard !relay.isEmpty, relay.hasPrefix("ws://") || relay.hasPrefix("wss://"), !seen.contains(relay) else {
        continue
      }
      seen.insert(relay)
      result.append(relay)
    }
    return result
  }
}
