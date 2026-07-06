import FlatBuffers
import NipworkerSwift
import UIKit

@objc(NativeNoteHeaderContentView)
class NativeNoteHeaderContentView: UIView {
  private static let imageCache = NSCache<NSString, UIImage>()

  private var noteBytes: [UInt8]?
  private var relays: [String] = []
  private var visible = true
  private var profileSubscription: NipworkerHookHandle?
  private var depth: Int = 0
  private var main: Bool = false
  private var showRelays: Bool = true
  private var relayCount: Int = 0
  private var reposterPubkey: String?
  private var fallbackSubId: String?

  private var pubkey: String = ""
  private var createdAt: UInt32 = 0
  private var subId: String = ""
  private var name: String = ""
  private var nip05: String = ""
  private var picture: String = ""
  private var avatarImage: UIImage?
  private var avatarRequestUrl: String?
  private var primaryTextColor = UIColor(red: 17 / 255, green: 24 / 255, blue: 39 / 255, alpha: 1)
  private var secondaryTextColor = UIColor(red: 107 / 255, green: 114 / 255, blue: 128 / 255, alpha: 1)
  private var avatarBackgroundColor = UIColor(red: 229 / 255, green: 231 / 255, blue: 235 / 255, alpha: 1)
  private var accentColor = UIColor(red: 37 / 255, green: 99 / 255, blue: 235 / 255, alpha: 1)

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    isOpaque = false
    backgroundColor = .clear
  }

  deinit {
    profileSubscription?.cancel()
  }

  @objc(updateNoteBytes:)
  func updateNoteBytes(_ value: [NSNumber]?) {
    noteBytes = value?.map { UInt8(truncating: $0) }
    parseNote()
    refreshProfileSubscription()
    setNeedsDisplay()
  }

  @objc(updateRelays:)
  func updateRelays(_ value: [String]?) {
    relays = value ?? []
    refreshProfileSubscription()
  }

  @objc(updateVisible:)
  func updateVisible(_ value: Bool) {
    visible = value
    refreshProfileSubscription()
    setNeedsDisplay()
  }

  @objc(updateDepth:)
  func updateDepth(_ value: NSNumber) {
    depth = value.intValue
    setNeedsDisplay()
  }

  @objc(updateMain:)
  func updateMain(_ value: Bool) {
    main = value
    setNeedsDisplay()
  }

  @objc(updateShowRelays:)
  func updateShowRelays(_ value: Bool) {
    showRelays = value
    setNeedsDisplay()
  }

  @objc(updateRelayCount:)
  func updateRelayCount(_ value: NSNumber) {
    relayCount = value.intValue
    setNeedsDisplay()
  }

  @objc(updateReposterPubkey:)
  func updateReposterPubkey(_ value: String?) {
    reposterPubkey = value
    setNeedsDisplay()
  }

  @objc(updateFallbackSubId:)
  func updateFallbackSubId(_ value: String?) {
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
    let horizontalGap: CGFloat = main ? 8 : 4
    let avatarLeft: CGFloat = 0
    let avatarTop: CGFloat = 0
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
      let badge: CGFloat = quote ? 7 : 11
      context.setFillColor(accentColor.cgColor)
      context.fillEllipse(
        in: CGRect(
          x: avatarLeft + avatarSize - badge,
          y: avatarTop + avatarSize - badge,
          width: badge,
          height: badge
        )
      )
    }

    let primaryFont = UIFont.systemFont(ofSize: main ? 16 : 14, weight: .semibold)
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
        y: top + 2,
        maxX: contentRight,
        font: secondaryFont
      )
    }

    if showRelays {
      drawText(
        "\(relayCount)",
        at: CGPoint(x: bounds.width - 18, y: top + 1),
        maxWidth: 18,
        font: secondaryFont,
        color: secondaryTextColor
      )
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

    pubkey = event.pubkey ?? ""
    createdAt = event.createdAt
    subId = parseWorker(noteBytes)?.subId ?? ""
    if name.isEmpty {
      name = shortPubkey(pubkey)
    }
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
    name = profile.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if name.isEmpty {
      name = profile.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
    nip05 = profile.nip05?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    picture = profile.picture?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    loadAvatarImage()
  }

  private func refreshProfileSubscription() {
    profileSubscription?.cancel()
    profileSubscription = nil
    guard visible, !pubkey.isEmpty else {
      if !visible || pubkey.isEmpty {
        emitNativeDebugLog(
          source: "NativeNoteHeaderContentView",
          event: "refreshProfileSubscription-skipped",
          details: "visible=\(visible), pubkeyEmpty=\(pubkey.isEmpty)"
        )
      }
      return
    }
    emitNativeDebugLog(
      source: "NativeNoteHeaderContentView",
      event: "refreshProfileSubscription",
      details: "pubkey=\(pubkey), relays=\(relays.count)"
    )
    profileSubscription = useSubscriptionHandle(
      subscriptionId: "u_\(pubkey)",
      requests: [
        RequestObject(authors: [pubkey], kinds: [0], limit: 1, relays: relays, closeOnEOSE: true, cacheFirst: true)
      ],
      callback: { [weak self] messages in
        DispatchQueue.main.async {
          self?.handleProfileMessages(messages)
        }
      },
      options: SubscriptionConfig(closeOnEose: true, cacheFirst: true)
    )
  }

  private func handleProfileMessages(_ messages: [WorkerMessageView]) {
    for message in messages {
      guard message.parsedEvent?.pubkey == pubkey, let profile = message.kind0 else { continue }
      emitNativeDebugLog(
        source: "NativeNoteHeaderContentView",
        event: "handleProfileMessages",
        details: "pubkey=\(pubkey), pictureSet=\(!((profile.picture ?? "").isEmpty))"
      )
      applyProfile(profile)
      setNeedsDisplay()
      break
    }
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
    avatarImage = nil
    guard !picture.isEmpty, let url = URL(string: picture) else {
      avatarRequestUrl = nil
      return
    }

    let cacheKey = picture as NSString
    if let cached = Self.imageCache.object(forKey: cacheKey) {
      avatarImage = cached
      setNeedsDisplay()
      return
    }

    avatarRequestUrl = picture
    URLSession.shared.dataTask(with: url) { [weak self] data, response, _ in
      guard
        let self,
        let data,
        let httpResponse = response as? HTTPURLResponse,
        (200..<300).contains(httpResponse.statusCode),
        let image = UIImage(data: data)
      else {
        return
      }

      Self.imageCache.setObject(image, forKey: cacheKey)
      DispatchQueue.main.async {
        guard self.avatarRequestUrl == cacheKey as String else {
          return
        }
        self.avatarImage = image
        self.setNeedsDisplay()
      }
    }.resume()
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
      drawBadgeCheck(at: CGPoint(x: cursorX, y: y + 1))
      cursorX += 18
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
    context.setStrokeColor(UIColor(red: 21 / 255, green: 135 / 255, blue: 119 / 255, alpha: 1).cgColor)
    context.setLineWidth(2.2)
    context.strokeEllipse(in: rect.insetBy(dx: 1.5, dy: 1.5))
    context.move(to: CGPoint(x: rect.minX + 4, y: rect.midY))
    context.addLine(to: CGPoint(x: rect.minX + 6.3, y: rect.maxY - 4.2))
    context.addLine(to: CGPoint(x: rect.maxX - 3.5, y: rect.minY + 4.2))
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
