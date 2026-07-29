import FlatBuffers
import NipworkerReactNative
import UIKit

@objc(NativeNoteFooterContentView)
class NativeNoteFooterContentView: UIView {
  private static let defaultRelays = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nuts.cash",
  ]

  @objc var onRelayStatusChange: ((String, String) -> Void)?
  @objc var onNativeAction: ((String) -> Void)?

  private var noteBytes: [UInt8]?
  private var relays: [String] = []
  private var relayResolutionPending = false
  private var currentUserPubkey = ""
  private var visible = true
  private var parsedNoteId = ""
  private var noteIdOverride = ""
  private var noteId: String {
    noteIdOverride.isEmpty ? parsedNoteId : noteIdOverride
  }
  private var notePubkey = ""
  private var noteKind: UInt16 = 0
  private var mainSubscription: NipworkerHookHandle?
  private var quoteSubscription: NipworkerHookHandle?
  private var activeSubscriptionKey = ""
  private var optimisticReactionNonce: Int32 = 0
  private var supportsComments = true
  private var commentsCount = 0
  private var repliesCount = 0
  private var repostsCount = 0
  private var quotesCount = 0
  private var reactionsCount = 0
  private var replied = false
  private var reposted = false
  private var reacted = false
  private var main = false
  private var zoom = false
  private var footerTintColor = UIColor(red: 155 / 255, green: 158 / 255, blue: 164 / 255, alpha: 1)
  private var primaryColor = UIColor(red: 21 / 255, green: 135 / 255, blue: 119 / 255, alpha: 1)
  private var accentColor = UIColor(red: 109 / 255, green: 40 / 255, blue: 217 / 255, alpha: 1)
  private var zoomBackgroundColor = UIColor(red: 15 / 255, green: 23 / 255, blue: 42 / 255, alpha: 0.46)

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    recognizer.cancelsTouchesInView = false
    addGestureRecognizer(recognizer)
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    isOpaque = false
    backgroundColor = .clear
    let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    recognizer.cancelsTouchesInView = false
    addGestureRecognizer(recognizer)
  }

  deinit {
    mainSubscription?.cancel()
    quoteSubscription?.cancel()
  }

  @objc func prepareForRecycle() {
    mainSubscription?.cancel()
    quoteSubscription?.cancel()
    mainSubscription = nil
    quoteSubscription = nil
    activeSubscriptionKey = ""
  }

  @objc(updateNoteBytes:)
  func updateNoteBytes(_ value: [NSNumber]?) {
    let nextBytes = value?.map { UInt8(truncating: $0) }
    if noteBytes == nextBytes { return }
    noteBytes = nextBytes
    let previousNoteId = noteId
    parseNote()
    if previousNoteId != noteId {
      resetCounts()
      activeSubscriptionKey = ""
    }
    refreshSubscriptions()
  }

  @objc(updateNoteId:)
  func updateNoteId(_ value: String?) {
    let previousNoteId = noteId
    noteIdOverride = value ?? ""
    if previousNoteId != noteId {
      resetCounts()
      activeSubscriptionKey = ""
    }
    refreshSubscriptions()
  }

  func updateParsedEvent(_ event: nostr_fb_ParsedEvent?) {
    let previousNoteId = noteId
    guard let event else {
      parsedNoteId = ""
      notePubkey = ""
      noteKind = 0
      supportsComments = true
      if previousNoteId != noteId {
        resetCounts()
        activeSubscriptionKey = ""
      }
      refreshSubscriptions()
      return
    }

    parsedNoteId = event.id ?? ""
    notePubkey = event.pubkey ?? ""
    noteKind = event.kind
    supportsComments = noteKind != 1 && noteKind != 6
    if previousNoteId != noteId {
      resetCounts()
      activeSubscriptionKey = ""
    }
    refreshSubscriptions()
  }

  @objc(updateRelays:)
  func updateRelays(_ value: [String]?) {
    let nextRelays = value ?? []
    if relays == nextRelays { return }
    relays = nextRelays
    refreshSubscriptions()
  }

  @objc(updateRelayResolutionPending:)
  func updateRelayResolutionPending(_ value: Bool) {
    if relayResolutionPending == value { return }
    relayResolutionPending = value
    refreshSubscriptions()
  }

  @objc(updateCurrentUserPubkey:)
  func updateCurrentUserPubkey(_ value: String?) {
    let nextPubkey = value ?? ""
    if currentUserPubkey == nextPubkey { return }
    currentUserPubkey = nextPubkey
    refreshSubscriptions()
  }

  @objc(updateOptimisticReactionNonce:)
  func updateOptimisticReactionNonce(_ value: Int32) {
    guard value != optimisticReactionNonce else { return }
    optimisticReactionNonce = value
    guard value > 0, !reacted else { return }
    reacted = true
    reactionsCount += 1
    setNeedsDisplay()
  }

  @objc(updateVisible:)
  func updateVisible(_ value: Bool) {
    if visible == value { return }
    visible = value
    refreshSubscriptions()
  }
  @objc(updateMain:)
  func updateMain(_ value: Bool) { main = value; setNeedsDisplay() }
  @objc(updateZoom:)
  func updateZoom(_ value: Bool) { zoom = value; setNeedsDisplay() }
  @objc(updateTintColor:)
  func updateTintColor(_ value: String?) { footerTintColor = UIColor(cssColor: value) ?? footerTintColor; setNeedsDisplay() }
  @objc(updatePrimaryColor:)
  func updatePrimaryColor(_ value: String?) { primaryColor = UIColor(cssColor: value) ?? primaryColor; setNeedsDisplay() }
  @objc(updateAccentColor:)
  func updateAccentColor(_ value: String?) { accentColor = UIColor(cssColor: value) ?? accentColor; setNeedsDisplay() }
  @objc(updateZoomBackgroundColor:)
  func updateZoomBackgroundColor(_ value: String?) {
    zoomBackgroundColor = UIColor(cssColor: value) ?? zoomBackgroundColor
    setNeedsDisplay()
  }

  private func parseNote() {
    guard let event = parseParsedEvent(noteBytes) else {
      emitNativeDebugLog(
        source: "NativeNoteFooterContentView",
        event: "parseNote-miss",
        details: "missing note bytes"
      )
      parsedNoteId = ""
      notePubkey = ""
      noteKind = 0
      supportsComments = true
      return
    }
    parsedNoteId = event.id
    notePubkey = event.pubkey
    noteKind = event.kind
    supportsComments = noteKind != 1 && noteKind != 6
  }

  private func resetCounts() {
    commentsCount = 0
    repliesCount = 0
    repostsCount = 0
    quotesCount = 0
    reactionsCount = 0
    replied = false
    reposted = false
    reacted = false
    setNeedsDisplay()
  }

  private func refreshSubscriptions() {
    guard !relayResolutionPending else {
      if !activeSubscriptionKey.isEmpty {
        mainSubscription?.cancel()
        quoteSubscription?.cancel()
        mainSubscription = nil
        quoteSubscription = nil
        activeSubscriptionKey = ""
      }
      return
    }
    let lookupRelays = relays.isEmpty ? Self.defaultRelays : relays
    guard visible, !noteId.isEmpty else {
      if !activeSubscriptionKey.isEmpty {
        mainSubscription?.cancel()
        quoteSubscription?.cancel()
        mainSubscription = nil
        quoteSubscription = nil
        activeSubscriptionKey = ""
      }
      if !visible || noteId.isEmpty {
        emitNativeDebugLog(
          source: "NativeNoteFooterContentView",
          event: "refreshSubscriptions-skipped",
          details: "noteId=\(noteId), visible=\(visible), noteIdEmpty=\(noteId.isEmpty), relaysEmpty=\(relays.isEmpty)",
          context: noteId
        )
      }
      return
    }
    let relaySource = relays.isEmpty ? "fallback" : "props"
    let nextSubscriptionKey = "\(noteId)|\(lookupRelays.joined(separator: ","))|\(currentUserPubkey)|\(supportsComments)"
    if activeSubscriptionKey == nextSubscriptionKey { return }
    mainSubscription?.cancel()
    quoteSubscription?.cancel()
    mainSubscription = nil
    quoteSubscription = nil
    activeSubscriptionKey = nextSubscriptionKey
    emitNativeDebugLog(
      source: "NativeNoteFooterContentView",
      event: "refreshSubscriptions",
      details: "noteId=\(noteId), relays=\(lookupRelays.count), relaySource=\(relaySource), supportsComments=\(supportsComments)",
      context: noteId
    )

    let mainKinds: [UInt16] = supportsComments ? [6, 7, 1111] : [1, 6, 7]
    var mainRequests = [
      RequestObject(kinds: supportsComments ? [6, 7] : [1, 6, 7], tags: ["#e": [noteId]], relays: lookupRelays)
    ]
    if supportsComments {
      mainRequests.append(RequestObject(kinds: [1111], tags: ["#E": [noteId]], relays: lookupRelays))
    }
    mainSubscription = useSubscriptionHandle(
      subscriptionId: "f_\(noteId)_\(lookupRelays.joined(separator: ","))",
      requests: mainRequests,
      callback: { [weak self] messages in DispatchQueue.main.async { self?.handleMainMessages(messages) } },
      options: SubscriptionConfig(
        pipeline: [
          .init(.saveToDb),
          .init(.counter(kinds: mainKinds, pubkey: currentUserPubkey)),
        ],
        bytesPerEvent: 256
      )
    )
    quoteSubscription = useSubscriptionHandle(
      subscriptionId: "fq_\(noteId)_\(lookupRelays.joined(separator: ","))",
      requests: [RequestObject(kinds: [1], tags: ["#q": [noteId]], relays: lookupRelays)],
      callback: { [weak self] messages in DispatchQueue.main.async { self?.handleQuoteMessages(messages) } },
      options: SubscriptionConfig(
        pipeline: [
          .init(.saveToDb),
          .init(.counter(kinds: [1], pubkey: currentUserPubkey)),
        ],
        bytesPerEvent: 256
      )
    )
  }

  private func handleMainMessages(_ messages: [WorkerMessageView]) {
    var changed = false
    for message in messages {
      forwardRelayStatus(message)
      guard let count = message.countResponse else { continue }
      switch count.kind {
      case 1:
        repliesCount = Int(count.count); if count.you { replied = true }; changed = true
      case 1111:
        commentsCount = Int(count.count); changed = true
      case 6:
        repostsCount = Int(count.count); if count.you { reposted = true }; changed = true
      case 7:
        reactionsCount = reacted ? max(Int(count.count), reactionsCount) : Int(count.count)
        if count.you { reacted = true }
        changed = true
      default:
        break
      }
    }
    if changed {
      emitNativeDebugLog(
        source: "NativeNoteFooterContentView",
        event: "handleMainMessages",
        details: "noteId=\(noteId), replies=\(repliesCount), reposts=\(repostsCount), comments=\(commentsCount), likes=\(reactionsCount)",
        context: noteId
      )
      setNeedsDisplay()
    }
  }

  private func handleQuoteMessages(_ messages: [WorkerMessageView]) {
    var changed = false
    for message in messages {
      forwardRelayStatus(message)
      guard let count = message.countResponse, count.kind == 1 else { continue }
      quotesCount = Int(count.count)
      if count.you { reposted = true }
      changed = true
    }
    if changed {
      emitNativeDebugLog(
        source: "NativeNoteFooterContentView",
        event: "handleQuoteMessages",
        details: "noteId=\(noteId), quotes=\(quotesCount)",
        context: noteId
      )
      setNeedsDisplay()
    }
  }

  private func forwardRelayStatus(_ message: WorkerMessageView) {
    guard visible,
          message.contentType == .connectionstatus,
          let status = message.message.content(type: nostr_fb_ConnectionStatus.self),
          !status.relayUrl.isEmpty,
          !status.status.isEmpty else { return }
    onRelayStatusChange?(normalizeRelay(status.relayUrl), status.status)
  }

  private func normalizeRelay(_ value: String) -> String {
    var relay = value.trimmingCharacters(in: .whitespacesAndNewlines)
    while relay.hasSuffix("/") {
      relay.removeLast()
    }
    return relay
  }

  @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    let point = recognizer.location(in: self)
    guard let action = footerAction(at: point) else { return }
    onNativeAction?(action)
  }

  private func footerAction(at point: CGPoint) -> String? {
    zoom ? zoomFooterAction(at: point) : inlineFooterAction(at: point)
  }

  private func inlineFooterAction(at point: CGPoint) -> String? {
    let leftInset: CGFloat = main ? 8 : 48
    let rightInset: CGFloat = 8
    let zapWidth: CGFloat = 24
    let rowMaxX = bounds.width - rightInset - zapWidth
    let y = (bounds.height - 20) / 2
    let gap: CGFloat = 8

    let zapRect = CGRect(x: bounds.width - rightInset - 32, y: 0, width: 32, height: bounds.height)
    if zapRect.contains(point) {
      return "zap"
    }

    var x = leftInset
    let firstAction = supportsComments ? "comments" : "reply"
    let firstLabel = countLabel(supportsComments ? commentsCount : repliesCount)
    let firstEnd = inlineActionEnd(x: x, y: y, label: firstLabel, maxX: rowMaxX)
    if CGRect(x: x, y: 0, width: max(34, firstEnd - x + gap), height: bounds.height).contains(point) {
      return firstAction
    }
    x = firstEnd + gap

    let repostEnd = inlineActionEnd(x: x, y: y, label: countLabel(repostsCount + quotesCount), maxX: rowMaxX)
    if CGRect(x: x, y: 0, width: max(34, repostEnd - x + gap), height: bounds.height).contains(point) {
      return "repost"
    }
    x = repostEnd + gap

    let likeEnd = inlineActionEnd(x: x, y: y, label: countLabel(reactionsCount), maxX: rowMaxX)
    if CGRect(x: x, y: 0, width: max(34, likeEnd - x + gap), height: bounds.height).contains(point) {
      return "like"
    }
    x = likeEnd + gap

    let shareEnd = inlineActionEnd(x: x, y: y, label: nil, maxX: rowMaxX)
    if CGRect(x: x, y: 0, width: max(34, shareEnd - x), height: bounds.height).contains(point) {
      return "share"
    }

    return nil
  }

  private func zoomFooterAction(at point: CGPoint) -> String? {
    let itemWidth = max(72, bounds.width / 4 - 9)
    let gap: CGFloat = 12
    let y = (bounds.height - 48) / 2
    let actions = [supportsComments ? "comments" : "reply", "repost", "like", "share"]
    var x: CGFloat = 0

    for action in actions {
      if CGRect(x: x, y: y, width: itemWidth, height: 48).contains(point) {
        return action
      }
      x += itemWidth + gap
    }

    return nil
  }

  private func inlineActionEnd(x: CGFloat, y: CGFloat, label: String?, maxX: CGFloat) -> CGFloat {
    guard x < maxX else {
      return x
    }

    var nextX = x + 22
    if let label {
      nextX += 4 + labelWidth(label, fontSize: 12, bold: false)
    }
    return min(nextX + 2, maxX)
  }

  private func parseParsedEvent(_ bytes: [UInt8]?) -> nostr_fb_ParsedEvent? {
    guard let bytes, bytes.count >= 4 else { return nil }
    let byteBuffer = ByteBuffer(bytes: bytes)
    let rootOffset = byteBuffer.read(def: Int32.self, position: 0)
    let worker = nostr_fb_WorkerMessage(byteBuffer, o: rootOffset)
    guard worker.contentType == .parsedevent else { return nil }
    return worker.content(type: nostr_fb_ParsedEvent.self)
  }

  override func draw(_ rect: CGRect) {
    guard UIGraphicsGetCurrentContext() != nil else {
      return
    }

    if zoom {
      drawZoomFooter()
    } else {
      drawInlineFooter()
    }
  }

  private func drawInlineFooter() {
    let leftInset: CGFloat = main ? 8 : 48
    let rightInset: CGFloat = 8
    let zapWidth: CGFloat = 24
    let rowMaxX = bounds.width - rightInset - zapWidth
    let y = (bounds.height - 20) / 2
    var x = leftInset
    let gap: CGFloat = 8

    x = drawAction(
      kind: supportsComments ? .comment : .reply,
      x: x,
      y: y,
      label: countLabel(supportsComments ? commentsCount : repliesCount),
      color: (!supportsComments && replied) ? accentColor : footerTintColor,
      filled: false,
      maxX: rowMaxX
    ) + gap

    x = drawAction(
      kind: .repost,
      x: x,
      y: y,
      label: countLabel(repostsCount + quotesCount),
      color: reposted ? primaryColor : footerTintColor,
      filled: false,
      maxX: rowMaxX
    ) + gap

    x = drawAction(
      kind: .like,
      x: x,
      y: y,
      label: countLabel(reactionsCount),
      color: reacted ? accentColor : footerTintColor,
      filled: reacted,
      maxX: rowMaxX
    ) + gap

    _ = drawAction(
      kind: .share,
      x: x,
      y: y,
      label: nil,
      color: footerTintColor,
      filled: false,
      maxX: rowMaxX
    )

    drawZapIcon(in: CGRect(x: bounds.width - rightInset - 24, y: (bounds.height - 24) / 2, width: 24, height: 24))
  }

  private func drawZoomFooter() {
    let itemWidth = max(72, bounds.width / 4 - 9)
    let gap: CGFloat = 12
    var x: CGFloat = 0
    let y = (bounds.height - 48) / 2

    x = drawZoomAction(
      kind: supportsComments ? .comment : .reply,
      x: x,
      y: y,
      width: itemWidth,
      label: countLabel(supportsComments ? commentsCount : repliesCount),
      color: .white,
      filled: false
    ) + gap

    x = drawZoomAction(
      kind: .repost,
      x: x,
      y: y,
      width: itemWidth,
      label: countLabel(repostsCount + quotesCount),
      color: .white,
      filled: false
    ) + gap

    x = drawZoomAction(
      kind: .like,
      x: x,
      y: y,
      width: itemWidth,
      label: countLabel(reactionsCount),
      color: .white,
      filled: reacted
    ) + gap

    _ = drawZoomAction(kind: .share, x: x, y: y, width: itemWidth, label: nil, color: .white, filled: false)
  }

  private func drawZoomAction(
    kind: FooterIconKind,
    x: CGFloat,
    y: CGFloat,
    width: CGFloat,
    label: String?,
    color: UIColor,
    filled: Bool
  ) -> CGFloat {
    let rect = CGRect(x: x, y: y, width: width, height: 48)
    let path = UIBezierPath(roundedRect: rect, cornerRadius: 24)
    zoomBackgroundColor.setFill()
    path.fill()

    let iconX = label == nil ? rect.midX - 10 : rect.midX - 22
    drawIcon(kind, in: CGRect(x: iconX, y: rect.midY - 10, width: 20, height: 20), color: color, filled: filled)
    if let label {
      drawLabel(label, at: CGPoint(x: iconX + 26, y: rect.midY - 9), fontSize: 16, color: color, bold: filled)
    }
    return rect.maxX
  }

  private func drawAction(
    kind: FooterIconKind,
    x: CGFloat,
    y: CGFloat,
    label: String?,
    color: UIColor,
    filled: Bool,
    maxX: CGFloat
  ) -> CGFloat {
    guard x < maxX else {
      return x
    }

    drawIcon(kind, in: CGRect(x: x + 2, y: y, width: 20, height: 20), color: color, filled: filled)
    var nextX = x + 22
    if let label {
      let width = drawLabel(label, at: CGPoint(x: nextX + 4, y: y + 1.5), fontSize: 12, color: color, bold: filled)
      nextX += 4 + width
    }
    return min(nextX + 2, maxX)
  }

  @discardableResult
  private func drawLabel(_ label: String, at point: CGPoint, fontSize: CGFloat, color: UIColor, bold: Bool) -> CGFloat {
    let font = UIFont.systemFont(ofSize: fontSize, weight: bold ? .semibold : .regular)
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: color,
    ]
    let size = (label as NSString).size(withAttributes: attributes)
    (label as NSString).draw(at: point, withAttributes: attributes)
    return ceil(size.width)
  }

  private func labelWidth(_ label: String, fontSize: CGFloat, bold: Bool) -> CGFloat {
    let font = UIFont.systemFont(ofSize: fontSize, weight: bold ? .semibold : .regular)
    return ceil((label as NSString).size(withAttributes: [.font: font]).width)
  }

  private func countLabel(_ count: Int) -> String? {
    count > 0 ? String(count) : nil
  }

  private func drawIcon(_ kind: FooterIconKind, in rect: CGRect, color: UIColor, filled: Bool) {
    switch kind {
    case .reply:
      drawReply(in: rect, color: color)
    case .comment:
      drawComment(in: rect, color: color)
    case .repost:
      drawRepost(in: rect, color: color)
    case .like:
      drawLike(in: rect, color: color, filled: filled)
    case .share:
      drawShare(in: rect, color: color)
    }
  }

  private func transform(_ rect: CGRect) -> CGAffineTransform {
    CGAffineTransform(translationX: rect.minX, y: rect.minY).scaledBy(x: rect.width / 24, y: rect.height / 24)
  }

  private func stroke(_ path: UIBezierPath, in rect: CGRect, color: UIColor, width: CGFloat) {
    path.apply(transform(rect))
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    path.lineWidth = width * rect.width / 24
    color.setStroke()
    path.stroke()
  }

  private func drawReply(in rect: CGRect, color: UIColor) {
    let path = UIBezierPath()
    path.move(to: CGPoint(x: 21, y: 11.5))
    path.addCurve(to: CGPoint(x: 20.1, y: 15.3), controlPoint1: CGPoint(x: 21, y: 12.8), controlPoint2: CGPoint(x: 20.7, y: 14.1))
    path.addCurve(to: CGPoint(x: 12.5, y: 20), controlPoint1: CGPoint(x: 18.6, y: 18.2), controlPoint2: CGPoint(x: 15.7, y: 20))
    path.addCurve(to: CGPoint(x: 8.7, y: 19.1), controlPoint1: CGPoint(x: 11.2, y: 20), controlPoint2: CGPoint(x: 9.9, y: 19.7))
    path.addLine(to: CGPoint(x: 3, y: 21))
    path.addLine(to: CGPoint(x: 4.9, y: 15.3))
    path.addCurve(to: CGPoint(x: 4, y: 11.5), controlPoint1: CGPoint(x: 4.3, y: 14.1), controlPoint2: CGPoint(x: 4, y: 12.8))
    path.addCurve(to: CGPoint(x: 8.7, y: 3.9), controlPoint1: CGPoint(x: 4, y: 8.3), controlPoint2: CGPoint(x: 5.8, y: 5.4))
    path.addCurve(to: CGPoint(x: 12.5, y: 3), controlPoint1: CGPoint(x: 9.9, y: 3.3), controlPoint2: CGPoint(x: 11.2, y: 3))
    path.addLine(to: CGPoint(x: 13, y: 3))
    path.addCurve(to: CGPoint(x: 21, y: 11), controlPoint1: CGPoint(x: 17.4, y: 3.1), controlPoint2: CGPoint(x: 20.9, y: 6.6))
    path.addLine(to: CGPoint(x: 21, y: 11.5))
    stroke(path, in: rect, color: color, width: 1.5)
  }

  private func drawComment(in rect: CGRect, color: UIColor) {
    let path = UIBezierPath()
    path.move(to: CGPoint(x: 21, y: 15))
    path.addCurve(to: CGPoint(x: 19, y: 17), controlPoint1: CGPoint(x: 21, y: 16.1), controlPoint2: CGPoint(x: 20.1, y: 17))
    path.addLine(to: CGPoint(x: 7, y: 17))
    path.addLine(to: CGPoint(x: 3, y: 21))
    path.addLine(to: CGPoint(x: 3, y: 5))
    path.addCurve(to: CGPoint(x: 5, y: 3), controlPoint1: CGPoint(x: 3, y: 3.9), controlPoint2: CGPoint(x: 3.9, y: 3))
    path.addLine(to: CGPoint(x: 19, y: 3))
    path.addCurve(to: CGPoint(x: 21, y: 5), controlPoint1: CGPoint(x: 20.1, y: 3), controlPoint2: CGPoint(x: 21, y: 3.9))
    path.addLine(to: CGPoint(x: 21, y: 15))
    stroke(path, in: rect, color: color, width: 2)
  }

  private func drawRepost(in rect: CGRect, color: UIColor) {
    let path = UIBezierPath()
    path.move(to: CGPoint(x: 4, y: 4))
    path.addLine(to: CGPoint(x: 4, y: 9))
    path.addLine(to: CGPoint(x: 4.582, y: 9))
    path.move(to: CGPoint(x: 19.938, y: 11))
    path.addCurve(to: CGPoint(x: 4.582, y: 9), controlPoint1: CGPoint(x: 17.2, y: 5.8), controlPoint2: CGPoint(x: 9.8, y: 4.8))
    path.move(to: CGPoint(x: 4.582, y: 9))
    path.addLine(to: CGPoint(x: 9, y: 9))
    path.move(to: CGPoint(x: 20, y: 20))
    path.addLine(to: CGPoint(x: 20, y: 15))
    path.addLine(to: CGPoint(x: 19.419, y: 15))
    path.move(to: CGPoint(x: 19.419, y: 15))
    path.addCurve(to: CGPoint(x: 4.062, y: 13), controlPoint1: CGPoint(x: 16.7, y: 20.2), controlPoint2: CGPoint(x: 9.3, y: 21.2))
    path.move(to: CGPoint(x: 19.419, y: 15))
    path.addLine(to: CGPoint(x: 15, y: 15))
    stroke(path, in: rect, color: color, width: 1.5)
  }

  private func drawShare(in rect: CGRect, color: UIColor) {
    let path = UIBezierPath()
    path.move(to: CGPoint(x: 22, y: 2))
    path.addLine(to: CGPoint(x: 11, y: 13))
    path.move(to: CGPoint(x: 22, y: 2))
    path.addLine(to: CGPoint(x: 15, y: 22))
    path.addLine(to: CGPoint(x: 11, y: 13))
    path.addLine(to: CGPoint(x: 2, y: 9))
    path.addLine(to: CGPoint(x: 22, y: 2))
    stroke(path, in: rect, color: color, width: 1.5)
  }

  private func drawLike(in rect: CGRect, color: UIColor, filled: Bool) {
    let path = UIBezierPath()
    path.move(to: CGPoint(x: 12, y: 21.35))
    path.addLine(to: CGPoint(x: 10.55, y: 20.03))
    path.addCurve(to: CGPoint(x: 2, y: 8.5), controlPoint1: CGPoint(x: 5.4, y: 15.36), controlPoint2: CGPoint(x: 2, y: 12.28))
    path.addCurve(to: CGPoint(x: 7.5, y: 3), controlPoint1: CGPoint(x: 2, y: 5.42), controlPoint2: CGPoint(x: 4.42, y: 3))
    path.addCurve(to: CGPoint(x: 12, y: 5.09), controlPoint1: CGPoint(x: 9.24, y: 3), controlPoint2: CGPoint(x: 10.91, y: 3.81))
    path.addCurve(to: CGPoint(x: 16.5, y: 3), controlPoint1: CGPoint(x: 13.09, y: 3.81), controlPoint2: CGPoint(x: 14.76, y: 3))
    path.addCurve(to: CGPoint(x: 22, y: 8.5), controlPoint1: CGPoint(x: 19.58, y: 3), controlPoint2: CGPoint(x: 22, y: 5.42))
    path.addCurve(to: CGPoint(x: 13.45, y: 20.04), controlPoint1: CGPoint(x: 22, y: 12.28), controlPoint2: CGPoint(x: 18.6, y: 15.36))
    path.addLine(to: CGPoint(x: 12, y: 21.35))
    path.close()
    path.apply(transform(rect))
    path.lineJoinStyle = .round
    path.lineWidth = 2 * rect.width / 24
    if filled {
      color.setFill()
      path.fill()
    } else {
      color.setStroke()
      path.stroke()
    }
  }

  private func drawZapIcon(in rect: CGRect) {
    UIImage(named: "NutsZap")?.draw(in: rect)
  }
}

private enum FooterIconKind {
  case reply
  case comment
  case repost
  case like
  case share
}

private extension UIColor {
  convenience init?(cssColor: String?) {
    guard let cssColor else {
      return nil
    }

    let value = cssColor.trimmingCharacters(in: .whitespacesAndNewlines)
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
