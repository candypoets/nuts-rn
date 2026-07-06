import Foundation

@inline(__always)
func emitNativeDebugLog(
  source: String,
  event: String,
  details: String = ""
) {
  #if DEBUG
  NativeDebug.log(source: source, event: event, details: details)
  #endif
}

#if DEBUG
enum NativeDebug {
  static let notificationName = Notification.Name("NativeDebugLog")

  @inline(__always)
  static func log(
    source: String,
    event: String,
    details: String = ""
  ) {
    DispatchQueue.main.async {
      let payload: [String: Any] = [
        "source": source,
        "event": event,
        "details": details,
        "ts": Date().timeIntervalSince1970
      ]
      NotificationCenter.default.post(
        name: notificationName,
        object: nil,
        userInfo: payload
      )
    }
  }
}
#endif
