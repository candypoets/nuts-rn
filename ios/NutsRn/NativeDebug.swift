import Foundation

@inline(__always)
func emitNativeDebugLog(
  source: String,
  event: String,
  details: String = "",
  context: String = ""
) {
  #if DEBUG
  NativeDebug.log(source: source, event: event, details: details, context: context)
  #endif
}

#if DEBUG
enum NativeDebug {
  static let notificationName = Notification.Name("NativeDebugLog")
  private static var pending: [String: PendingLog] = [:]
  private static var flushScheduled = false

  private struct PendingLog {
    var source: String
    var event: String
    var details: String
    var context: String
    var count: Int
  }

  @inline(__always)
  static func log(
    source: String,
    event: String,
    details: String = "",
    context: String = ""
  ) {
    DispatchQueue.main.async {
      let key = "\(source)|\(event)|\(context)"
      if var existing = pending[key] {
        existing.count += 1
        existing.details = details
        pending[key] = existing
      } else {
        pending[key] = PendingLog(source: source, event: event, details: details, context: context, count: 1)
      }

      guard !flushScheduled else { return }
      flushScheduled = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        flush()
      }
    }
  }

  private static func flush() {
    guard !pending.isEmpty else {
      flushScheduled = false
      return
    }

    let logs = pending.values
      .sorted { left, right in
        if left.count == right.count {
          return "\(left.source).\(left.event)" < "\(right.source).\(right.event)"
        }
        return left.count > right.count
      }
      .map { log in
        [
          "source": log.source,
          "event": log.event,
          "details": log.details,
          "context": log.context,
          "count": log.count,
        ] as [String: Any]
      }

    pending.removeAll()
    flushScheduled = false

    NotificationCenter.default.post(
      name: notificationName,
      object: nil,
      userInfo: [
        "source": "NativeDebug",
        "event": "summary",
        "details": "1s native debug summary",
        "logs": logs,
        "ts": Date().timeIntervalSince1970,
      ]
    )
  }
}
#endif
