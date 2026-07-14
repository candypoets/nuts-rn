import FlatBuffers
import NipworkerSwift
import SDWebImage
import UIKit

@objc(NativeNoteHeaderContentView)
class NativeNoteHeaderContentView: UIView {
  @objc var onNativeRoute: ((String) -> Void)?

  private var noteBytes: [UInt8]?
  private var relays: [String] = []
  private var relayStatuses: [String: String] = [:]
  private var relayResolutionPending = false
  private var visible = true
  private var profileHook: NativeProfileHook?
  private var reposterProfileHook: NativeProfileHook?
  private var depth: Int = 0
  private var main: Bool = false
  private var showRelays: Bool = true
  private var relayCount: Int = 0
  private var authorPubkey: String?
  private var reposterPubkey: String?
  private var reposterPicture: String = ""
  private var reposterAvatarImage: UIImage?
  private var reposterAvatarRequestUrl: String?
  private var reposterAvatarImageOperation: SDWebImageOperation?
  private var fallbackSubId: String?

  private var pubkey: String = ""
  private var noteId: String = ""
  private var createdAt: UInt32 = 0
  private var subId: String = ""
  private var name: String = ""
  private var nip05: String = ""
  private var picture: String = ""
  private var avatarImage: UIImage?
  private var avatarRequestUrl: String?
  private var avatarImageOperation: SDWebImageOperation?
  private var primaryTextColor = UIColor(red: 17 / 255, green: 24 / 255, blue: 39 / 255, alpha: 1)
  private var secondaryTextColor = UIColor(red: 107 / 255, green: 114 / 255, blue: 128 / 255, alpha: 1)
  private var avatarBackgroundColor = UIColor(red: 229 / 255, green: 231 / 255, blue: 235 / 255, alpha: 1)
  private var accentColor = UIColor(red: 37 / 255, green: 99 / 255, blue: 235 / 255, alpha: 1)

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
    avatarImageOperation?.cancel()
    reposterAvatarImageOperation?.cancel()
    profileHook?.cancel()
    reposterProfileHook?.cancel()
  }

  @objc func prepareForRecycle() {
    avatarImageOperation?.cancel()
    avatarImageOperation = nil
    reposterAvatarImageOperation?.cancel()
    reposterAvatarImageOperation = nil
    profileHook?.cancel()
    reposterProfileHook?.cancel()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      avatarImageOperation?.cancel()
      avatarImageOperation = nil
      reposterAvatarImageOperation?.cancel()
      reposterAvatarImageOperation = nil
    } else {
      if avatarImage == nil, !picture.isEmpty { loadAvatarImage() }
      if reposterAvatarImage == nil, !reposterPicture.isEmpty { loadReposterAvatarImage() }
    }
  }

  @objc(updateNoteBytes:)
  func updateNoteBytes(_ value: [NSNumber]?) {
    let nextBytes = value?.map { UInt8(truncating: $0) }
    if noteBytes == nextBytes { return }
    noteBytes = nextBytes
    parseNote()
    refreshProfileSubscription()
    setNeedsDisplay()
  }

  func updateParsedEvent(_ event: nostr_fb_ParsedEvent?) {
    guard let event else {
      if pubkey.isEmpty { return }
      pubkey = ""
      noteId = ""
      createdAt = 0
      subId = ""
      resetProfileDisplay()
      refreshProfileSubscription()
      setNeedsDisplay()
      return
    }

    noteId = event.id ?? ""
    let nextPubkey = event.pubkey ?? ""
    if pubkey != nextPubkey {
      pubkey = nextPubkey
      resetProfileDisplay()
    }
    createdAt = event.createdAt
    if name.isEmpty {
      name = shortPubkey(pubkey)
    }
    refreshProfileSubscription()
    setNeedsDisplay()
  }

  @objc(updateRelays:)
  func updateRelays(_ value: [String]?) {
    let nextRelays = value ?? []
    if relays == nextRelays { return }
    relays = nextRelays
    refreshProfileSubscription()
  }

  func updateRelayResolutionPending(_ value: Bool) {
    if relayResolutionPending == value { return }
    relayResolutionPending = value
    refreshProfileSubscription()
  }

  @objc(updateVisible:)
  func updateVisible(_ value: Bool) {
    if visible == value { return }
    visible = value
    refreshProfileSubscription()
    setNeedsDisplay()
  }

  @objc(updateDepth:)
  func updateDepth(_ value: NSNumber) {
    if depth == value.intValue { return }
    depth = value.intValue
    setNeedsDisplay()
  }

  @objc(updateMain:)
  func updateMain(_ value: Bool) {
    if main == value { return }
    main = value
    setNeedsDisplay()
  }

  @objc(updateShowRelays:)
  func updateShowRelays(_ value: Bool) {
    if showRelays == value { return }
    showRelays = value
    setNeedsDisplay()
  }

  @objc(updateRelayCount:)
  func updateRelayCount(_ value: NSNumber) {
    if relayCount == value.intValue { return }
    relayCount = value.intValue
    setNeedsDisplay()
  }

  @objc(updateRelayStatuses:)
  func updateRelayStatuses(_ value: [String: String]) {
    if relayStatuses == value { return }
    relayStatuses = value
    setNeedsDisplay()
  }

  @objc(updateReposterPubkey:)
  func updateReposterPubkey(_ value: String?) {
    let nextPubkey = value?.trimmingCharacters(in: .whitespacesAndNewlines)
    if reposterPubkey == nextPubkey { return }
    reposterPubkey = nextPubkey
    reposterPicture = ""
    reposterAvatarImage = nil
    reposterAvatarRequestUrl = nil
    refreshReposterProfileSubscription()
    setNeedsDisplay()
  }

  @objc(updateAuthorPubkey:)
  func updateAuthorPubkey(_ value: String?) {
    let nextPubkey = value?.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedPubkey = nextPubkey?.isEmpty == false ? nextPubkey : nil
    if authorPubkey == normalizedPubkey { return }
    authorPubkey = normalizedPubkey
    parseNote()
    refreshProfileSubscription()
    setNeedsDisplay()
  }

  @objc(updateFallbackSubId:)
  func updateFallbackSubId(_ value: String?) {
    if fallbackSubId == value { return }
    fallbackSubId = value
    setNeedsDisplay()
  }

  @objc(updatePrimaryTextColor:)
  func updatePrimaryTextColor(_ value: String?) {
    primaryTextColor = UIColor(hexString: value) ?? primaryTextColor
    setNeedsDisplay()
  }

  @objc(updateSecondaryTextColor:)
  func updateSecondaryTextColor(_ value: String?) {
    secondaryTextColor = UIColor(hexString: value) ?? secondaryTextColor
    setNeedsDisplay()
  }

  @objc(updateAvatarBackgroundColor:)
  func updateAvatarBackgroundColor(_ value: String?) {
    avatarBackgroundColor = UIColor(hexString: value) ?? avatarBackgroundColor
    setNeedsDisplay()
  }

  @objc(updateAccentColor:)
  func updateAccentColor(_ value: String?) {
    accentColor = UIColor(hexString: value) ?? accentColor
    setNeedsDisplay()
  }

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else {
      return
    }

    let quote = depth > 0
    let avatarSize: CGFloat = quote ? 16 : 40
    let horizontalGap: CGFloat = quote ? 2 : 6
    let avatarLeft: CGFloat = 0
    let avatarTop: CGFloat = quote ? 0 : 2
    let textLeft = avatarLeft + avatarSize + horizontalGap
    let top: CGFloat = 0

    let avatarRect = CGRect(x: avatarLeft, y: avatarTop, width: avatarSize, height: avatarSize)
    context.setFillColor(avatarBackgroundColor.cgColor)
    context.fillEllipse(in: avatarRect)

    if let avatarImage {
      context.saveGState()
      context.addEllipse(in: avatarRect)
      context.clip()
      avatarImage.draw(in: avatarRect)
      context.restoreGState()
    }

    if let reposterPubkey, !reposterPubkey.isEmpty {
      drawReposterAvatar(
        in: context,
        avatarRect: avatarRect,
        size: quote ? 11 : 19
      )
    }

    let primaryFont = UIFont.systemFont(ofSize: main ? 15 : 13, weight: .semibold)
    let secondaryFont = UIFont.systemFont(ofSize: 12, weight: .regular)

    let displayName = name.isEmpty ? (shortPubkey(pubkey).isEmpty ? "unknown" : shortPubkey(pubkey)) : name
    let relayWidth: CGFloat = showRelays ? 48 : 8
    let contentRight = bounds.width - relayWidth

    if main && !quote {
      drawText(
        displayName,
        at: CGPoint(x: textLeft, y: top),
        maxWidth: contentRight - textLeft,
        font: primaryFont,
        color: primaryTextColor
      )

      drawMetaLine(
        startX: textLeft,
        y: top + 20,
        maxX: bounds.width - 8,
        font: secondaryFont
      )
    } else {
      var cursorX = textLeft
      cursorX += drawInlineText(
        displayName,
        at: CGPoint(x: cursorX, y: top),
        maxWidth: contentRight - cursorX,
        font: primaryFont,
        color: primaryTextColor
      )

      drawMetaLine(
        startX: cursorX + 8,
        y: top + max(0, (primaryFont.lineHeight - secondaryFont.lineHeight) / 2),
        maxX: contentRight,
        font: secondaryFont
      )
    }

    if showRelays {
      drawRelayDots(in: CGRect(x: max(0, bounds.width - 32), y: top + 7, width: 28, height: 8))
    }
  }

  @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    let point = recognizer.location(in: self)
    if showRelays, !relays.isEmpty, point.x >= bounds.width - 44 {
      let subId = fallbackSubId ?? self.subId
      let relayPayload = relays.joined(separator: ",")
      let statusPayload = relayStatuses
        .map { "\($0.key)=\($0.value)" }
        .sorted()
        .joined(separator: ",")
      onNativeRoute?("relays:\(encodeRouteComponent(subId)):\(encodeRouteComponent(relayPayload)):\(encodeRouteComponent(statusPayload))")
      return
    }

    let avatarSize: CGFloat = depth > 0 ? 16 : 40
    let avatarTop: CGFloat = depth > 0 ? 0 : 2
    let avatarRect = CGRect(x: 0, y: avatarTop, width: avatarSize, height: avatarSize)
    let primaryFont = UIFont.systemFont(ofSize: main ? 15 : 13, weight: .semibold)
    let displayName = name.isEmpty ? (shortPubkey(pubkey).isEmpty ? "unknown" : shortPubkey(pubkey)) : name
    let textLeft = avatarSize + (depth > 0 ? 2 : 6)
    let nameWidth = (displayName as NSString).size(withAttributes: [.font: primaryFont]).width
    let nameRect = CGRect(x: textLeft, y: 0, width: nameWidth, height: primaryFont.lineHeight)
    if (avatarRect.contains(point) || nameRect.contains(point)), !pubkey.isEmpty {
      onNativeRoute?("profile:\(pubkey)")
    } else {
      onNativeRoute?("note")
    }
  }

  private func parseNote() {
    guard let event = parseParsedEvent(noteBytes) else {
      emitNativeDebugLog(
        source: "NativeNoteHeaderContentView",
        event: "parseNote-miss",
        details: "missing event payload"
      )
      return
    }

    noteId = event.id ?? ""
    let nextPubkey = authorPubkey ?? event.pubkey ?? ""
    if pubkey != nextPubkey {
      pubkey = nextPubkey
      resetProfileDisplay()
    }
    createdAt = event.createdAt
    subId = parseWorker(noteBytes)?.subId ?? ""
    if name.isEmpty {
      name = shortPubkey(pubkey)
    }
  }

  private func resetProfileDisplay() {
    name = shortPubkey(pubkey)
    nip05 = ""
    picture = ""
    avatarImage = nil
    avatarRequestUrl = nil
  }

  private func parseProfile() {
    guard let profileEvent = parseParsedEvent(noteBytes), profileEvent.parsedType == .kind0parsed,
          let profile = profileEvent.parsed(type: nostr_fb_Kind0Parsed.self) else { return }
    emitNativeDebugLog(
      source: "NativeNoteHeaderContentView",
      event: "parseProfile",
      details: "pubkey=\(pubkey), hasProfile=true"
    )
    applyProfile(profile)
  }

  private func applyProfile(_ profile: nostr_fb_Kind0Parsed) {
    applyProfile(NativeProfileSnapshot(
      pubkey: pubkey,
      name: profile.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
      displayName: profile.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
      nip05: profile.nip05?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
      picture: profile.picture?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    ))
  }

  private func applyProfile(_ profile: NativeProfileSnapshot) {
    name = profile.bestName
    nip05 = profile.nip05
    picture = profile.picture
    loadAvatarImage()
  }

  private func getProfileHook() -> NativeProfileHook {
    if let profileHook {
      return profileHook
    }
    let hook = NativeProfileHook(subscriptionNamespace: "native_note_author")
    hook.onProfile = { [weak self] profile in
      guard let self, profile.pubkey == self.pubkey else { return }
      self.applyProfile(profile)
      self.setNeedsDisplay()
    }
    profileHook = hook
    return hook
  }

  private func getReposterProfileHook() -> NativeProfileHook {
    if let reposterProfileHook {
      return reposterProfileHook
    }
    let hook = NativeProfileHook(subscriptionNamespace: "native_note_reposter")
    hook.onProfile = { [weak self] profile in
      guard let self, profile.pubkey == self.reposterPubkey else { return }
      self.reposterPicture = profile.picture
      self.loadReposterAvatarImage()
      self.setNeedsDisplay()
    }
    reposterProfileHook = hook
    return hook
  }

  private func refreshProfileSubscription() {
    guard !relayResolutionPending else {
      profileHook?.cancel()
      reposterProfileHook?.cancel()
      return
    }
    guard visible, !pubkey.isEmpty else {
      profileHook?.cancel()
      if !visible || pubkey.isEmpty {
        emitNativeDebugLog(
          source: "NativeNoteHeaderContentView",
          event: "refreshProfileSubscription-skipped",
          details: "noteId=\(noteId), visible=\(visible), pubkeyEmpty=\(pubkey.isEmpty)",
          context: noteId
        )
      }
      return
    }
    emitNativeDebugLog(
      source: "NativeNoteHeaderContentView",
      event: "refreshProfileSubscription",
      details: "noteId=\(noteId), pubkey=\(pubkey), relays=\(relays.count)",
      context: noteId
    )
    getProfileHook().update(pubkey: pubkey, relays: relays, visible: visible)
    refreshReposterProfileSubscription()
  }

  private func drawRelayDots(in rect: CGRect) {
    let displayRelays = Array(relays.prefix(3))
    guard !displayRelays.isEmpty else { return }
    let dotSize: CGFloat = 4
    let gap: CGFloat = 3
    let totalWidth = CGFloat(displayRelays.count) * dotSize + CGFloat(max(0, displayRelays.count - 1)) * gap
    var x = rect.maxX - totalWidth
    let y = rect.midY - dotSize / 2
    for relay in displayRelays {
      statusColor(relayStatuses[normalizeRelay(relay)]).setFill()
      UIBezierPath(ovalIn: CGRect(x: x, y: y, width: dotSize, height: dotSize)).fill()
      x += dotSize + gap
    }
  }

  private func statusColor(_ status: String?) -> UIColor {
    switch status {
    case "EOSE", "OK":
      return UIColor(red: 34 / 255, green: 197 / 255, blue: 94 / 255, alpha: 1)
    case "SUBSCRIBED":
      return UIColor(red: 59 / 255, green: 130 / 255, blue: 246 / 255, alpha: 1)
    case "FAILED":
      return UIColor(red: 239 / 255, green: 68 / 255, blue: 68 / 255, alpha: 1)
    case "CLOSED":
      return avatarBackgroundColor
    default:
      return avatarBackgroundColor
    }
  }

  private func normalizeRelay(_ value: String) -> String {
    var relay = value.trimmingCharacters(in: .whitespacesAndNewlines)
    while relay.hasSuffix("/") {
      relay.removeLast()
    }
    return relay
  }

  private func encodeRouteComponent(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
  }

  private func refreshReposterProfileSubscription() {
    guard !relayResolutionPending,
          visible,
          let reposterPubkey,
          !reposterPubkey.isEmpty else {
      reposterProfileHook?.cancel()
      return
    }
    getReposterProfileHook().update(pubkey: reposterPubkey, relays: relays, visible: visible)
  }

  private func parseParsedEvent(_ bytes: [UInt8]?) -> nostr_fb_ParsedEvent? {
    guard let worker = parseWorker(bytes), worker.contentType == .parsedevent else {
      emitNativeDebugLog(
        source: "NativeNoteHeaderContentView",
        event: "parseParsedEvent",
        details: "contentType-not-parsed"
      )
      return nil
    }

    return worker.content(type: nostr_fb_ParsedEvent.self)
  }

  private func parseWorker(_ bytes: [UInt8]?) -> nostr_fb_WorkerMessage? {
    guard let bytes, bytes.count >= 4 else {
      return nil
    }

    let byteBuffer = ByteBuffer(bytes: bytes)
    let rootOffset = byteBuffer.read(def: Int32.self, position: 0)
    return nostr_fb_WorkerMessage(byteBuffer, o: rootOffset)
  }

  private func loadAvatarImage() {
    avatarImageOperation?.cancel()
    avatarImageOperation = nil
    avatarImage = nil
    guard !picture.isEmpty, URL(string: picture) != nil else {
      avatarRequestUrl = nil
      return
    }

    avatarRequestUrl = picture
    let scale = window?.screen.scale ?? UIScreen.main.scale
    let targetSize = CGSize(width: 40 * scale, height: 40 * scale)
    avatarImageOperation = NativeAvatarImageLoader.shared.loadImage(for: picture, targetSize: targetSize) { [weak self] image in
      guard let self, self.avatarRequestUrl == self.picture else { return }
      self.avatarImageOperation = nil
      guard let image else { return }
      self.avatarImage = image
      self.setNeedsDisplay()
    }
  }

  private func loadReposterAvatarImage() {
    reposterAvatarImageOperation?.cancel()
    reposterAvatarImageOperation = nil
    reposterAvatarImage = nil
    guard !reposterPicture.isEmpty, URL(string: reposterPicture) != nil else {
      reposterAvatarRequestUrl = nil
      return
    }

    reposterAvatarRequestUrl = reposterPicture
    let scale = window?.screen.scale ?? UIScreen.main.scale
    let targetSize = CGSize(width: 20 * scale, height: 20 * scale)
    reposterAvatarImageOperation = NativeAvatarImageLoader.shared.loadImage(for: reposterPicture, targetSize: targetSize) { [weak self] image in
      guard let self, self.reposterAvatarRequestUrl == self.reposterPicture else { return }
      self.reposterAvatarImageOperation = nil
      guard let image else { return }
      self.reposterAvatarImage = image
      self.setNeedsDisplay()
    }
  }

  private func drawReposterAvatar(in context: CGContext, avatarRect: CGRect, size: CGFloat) {
    let badgeRect = CGRect(
      x: avatarRect.maxX - size + 2,
      y: avatarRect.maxY - size + 2,
      width: size,
      height: size
    )

    context.saveGState()
    context.setFillColor(avatarBackgroundColor.cgColor)
    context.fillEllipse(in: badgeRect)

    if let reposterAvatarImage {
      context.addEllipse(in: badgeRect)
      context.clip()
      reposterAvatarImage.draw(in: badgeRect)
    } else {
      context.setFillColor(accentColor.cgColor)
      context.fillEllipse(in: badgeRect.insetBy(dx: size * 0.28, dy: size * 0.28))
    }
    context.restoreGState()
  }

  private func drawText(_ value: String, at point: CGPoint, maxWidth: CGFloat, font: UIFont, color: UIColor) {
    guard maxWidth > 0 else {
      return
    }

    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byTruncatingTail
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: color,
      .paragraphStyle: paragraph,
    ]
    (value as NSString).draw(
      with: CGRect(x: point.x, y: point.y, width: maxWidth, height: font.lineHeight + 2),
      options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
      attributes: attributes,
      context: nil
    )
  }

  @discardableResult
  private func drawInlineText(
    _ value: String,
    at point: CGPoint,
    maxWidth: CGFloat,
    font: UIFont,
    color: UIColor
  ) -> CGFloat {
    guard maxWidth > 0, !value.isEmpty else {
      return 0
    }

    let measuredWidth = ceil((value as NSString).size(withAttributes: [.font: font]).width)
    let drawWidth = min(measuredWidth, maxWidth)
    drawText(value, at: point, maxWidth: drawWidth, font: font, color: color)
    return drawWidth
  }

  private func drawMetaLine(startX: CGFloat, y: CGFloat, maxX: CGFloat, font: UIFont) {
    var cursorX = startX
    if !nip05.isEmpty, cursorX < maxX {
      let badgeSlotWidth: CGFloat = 16
      drawBadgeCheck(at: CGPoint(x: cursorX + 1, y: y + 1))
      cursorX += badgeSlotWidth + 4
      cursorX += drawInlineText(
        nip05,
        at: CGPoint(x: cursorX, y: y),
        maxWidth: maxX - cursorX,
        font: font,
        color: secondaryTextColor
      )
      cursorX += 8
    }

    let time = formatTimeShort(createdAt)
    if !time.isEmpty, cursorX < maxX {
      drawText(
        time,
        at: CGPoint(x: cursorX, y: y),
        maxWidth: maxX - cursorX,
        font: font,
        color: secondaryTextColor
      )
    }
  }

  private func drawBadgeCheck(at point: CGPoint) {
    guard let context = UIGraphicsGetCurrentContext() else {
      return
    }

    let rect = CGRect(x: point.x, y: point.y, width: 14, height: 14)
    context.saveGState()
    context.setFillColor(accentColor.cgColor)
    context.fillEllipse(in: rect.insetBy(dx: 0.5, dy: 0.5))
    context.setStrokeColor(UIColor(red: 9 / 255, green: 17 / 255, blue: 28 / 255, alpha: 0.9).cgColor)
    context.setLineWidth(1.9)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.move(to: CGPoint(x: rect.minX + 4.0, y: rect.midY + 0.2))
    context.addLine(to: CGPoint(x: rect.minX + 6.3, y: rect.maxY - 4.1))
    context.addLine(to: CGPoint(x: rect.maxX - 3.3, y: rect.minY + 4.2))
    context.strokePath()
    context.restoreGState()
  }

  private func shortPubkey(_ value: String) -> String {
    guard value.count > 12 else {
      return value
    }

    return "\(value.prefix(6))...\(value.suffix(4))"
  }

  private func formatTimeShort(_ timestamp: UInt32) -> String {
    guard timestamp > 0 else {
      return ""
    }

    let now = UInt32(Date().timeIntervalSince1970)
    let diff = now > timestamp ? now - timestamp : 0
    if diff < 60 {
      return "\(diff)s"
    }
    if diff < 3_600 {
      return "\(diff / 60)m"
    }
    if diff < 86_400 {
      return "\(diff / 3_600)h"
    }
    return "\(diff / 86_400)d"
  }
}

private extension UIColor {
  convenience init?(hexString: String?) {
    guard let hexString else {
      return nil
    }

    let normalized = hexString
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "#", with: "")

    guard normalized.count == 6, let value = UInt32(normalized, radix: 16) else {
      return nil
    }

    self.init(
      red: CGFloat((value >> 16) & 0xff) / 255,
      green: CGFloat((value >> 8) & 0xff) / 255,
      blue: CGFloat(value & 0xff) / 255,
      alpha: 1
    )
  }
}
