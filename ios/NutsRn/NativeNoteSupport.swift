import Foundation
import FlatBuffers
import NipworkerReactNative
import AVFoundation
import UIKit
enum NativeNoteConstants {
  static let defaultRelays = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nuts.cash",
  ]
}

final class NativeAuthorReadRelaysHook {
  var onRelays: (([String]) -> Void)?

  private var subscription: NipworkerHookHandle?
  private var subscriptionKey = ""
  private var timeout: Timer?

  deinit {
    cancel()
  }

  func cancel() {
    timeout?.invalidate()
    timeout = nil
    subscription?.cancel()
    subscription = nil
    subscriptionKey = ""
  }

  func update(pubkey: String, discoveryRelays: [String], visible: Bool) {
    let cleanPubkey = pubkey.trimmingCharacters(in: .whitespacesAndNewlines)
    guard visible, !cleanPubkey.isEmpty else {
      cancel()
      return
    }

    let relays = Self.normalizedRelays(discoveryRelays + NativeNoteConstants.defaultRelays)
    let relayKey = relays.map { $0.replacingOccurrences(of: #"[^A-Za-z0-9]"#, with: "", options: .regularExpression) }
      .joined()
      .prefix(24)
    let nextKey = "\(cleanPubkey)|\(relayKey)"
    if subscriptionKey == nextKey { return }

    cancel()
    subscriptionKey = nextKey
    timeout = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { [weak self] _ in
      guard let self else { return }
      self.timeout = nil
      self.subscription?.cancel()
      self.subscription = nil
      self.onRelays?([])
    }
    subscription = useSubscriptionHandle(
      subscriptionId: "native_author_relays_\(cleanPubkey)_\(relayKey)",
      requests: [
        RequestObject(authors: [cleanPubkey], kinds: [10002], limit: 1, relays: relays, closeOnEOSE: true, cacheFirst: true)
      ],
      callback: { [weak self] messages in
        DispatchQueue.main.async {
          self?.handle(messages: messages, requestedPubkey: cleanPubkey)
        }
      },
      options: SubscriptionConfig(closeOnEose: true, cacheFirst: true)
    )
  }

  static func normalizedRelays(_ values: [String]) -> [String] {
    var seen = Set<String>()
    var result: [String] = []
    for value in values {
      let relay = normalizeRelay(value)
      guard !relay.isEmpty, relay.hasPrefix("ws://") || relay.hasPrefix("wss://"), !seen.contains(relay) else {
        continue
      }
      seen.insert(relay)
      result.append(relay)
    }
    return result
  }

  private static func normalizeRelay(_ value: String) -> String {
    var relay = value.trimmingCharacters(in: .whitespacesAndNewlines)
    while relay.hasSuffix("/") {
      relay.removeLast()
    }
    return relay
  }

  private func handle(messages: [WorkerMessageView], requestedPubkey: String) {
    for message in messages {
      guard message.parsedEvent?.pubkey == requestedPubkey, let kind10002 = message.kind10002 else { continue }
      let relays = readRelays(from: kind10002)
      timeout?.invalidate()
      timeout = nil
      subscription?.cancel()
      subscription = nil
      onRelays?(relays)
      return
    }
  }

  private func readRelays(from kind10002: nostr_fb_Kind10002Parsed) -> [String] {
    var relays: [String] = []
    for relay in kind10002.relays {
      guard relay.read, let url = relay.url else { continue }
      relays.append(url)
      if relays.count >= 5 { break }
    }
    return Self.normalizedRelays(relays)
  }
}

extension UIColor {
  convenience init?(noteCssColor: String?) {
    guard let noteCssColor else {
      return nil
    }

    let value = noteCssColor.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("rgba("), value.hasSuffix(")") {
      let body = value.dropFirst(5).dropLast()
      let parts = body.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      guard parts.count == 4,
            let red = Double(parts[0]),
            let green = Double(parts[1]),
            let blue = Double(parts[2]),
            let alpha = Double(parts[3]) else {
        return nil
      }
      self.init(red: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
      return
    }

    let normalized = value.replacingOccurrences(of: "#", with: "")
    guard normalized.count == 6, let hex = UInt32(normalized, radix: 16) else {
      return nil
    }
    self.init(
      red: CGFloat((hex >> 16) & 0xff) / 255,
      green: CGFloat((hex >> 8) & 0xff) / 255,
      blue: CGFloat(hex & 0xff) / 255,
      alpha: 1
    )
  }
}

extension Array {
  subscript(safe index: Int) -> Element? {
    index >= 0 && index < count ? self[index] : nil
  }
}
