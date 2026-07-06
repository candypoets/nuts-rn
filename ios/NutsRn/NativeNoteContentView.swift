import Foundation
import FlatBuffers
import NipworkerSwift
import UIKit

private struct ContentRun {
  let text: String
  let color: UIColor
}

private struct QuoteInfo {
  let id: String
  let relays: [String]
  let depth: Int
  let key: String
}

private enum ContentLine {
  case text([ContentRun])
  case quote(QuoteInfo)
}

private enum NativeContentBlockParser {
  static func build(
    from event: nostr_fb_ParsedEvent,
    baseContentColor: UIColor,
    accentColor: UIColor,
    showQuote: Bool,
    depth: Int,
    resolveRelays: () -> [String]
  ) -> [ContentLine] {
    guard event.kind == 1,
          let kind1 = event.parsed(type: nostr_fb_Kind1Parsed.self) else {
      return [.text([ContentRun(text: "Kind \(event.kind)", color: baseContentColor)])]
    }

    var lines: [ContentLine] = []
    var currentTextRuns: [ContentRun] = []

    func flushText() {
      if !currentTextRuns.isEmpty {
        lines.append(.text(currentTextRuns))
        currentTextRuns.removeAll()
      }
    }

    func appendTextRun(_ run: ContentRun) {
      currentTextRuns.append(run)
    }

    for block in kind1.parsedContent {
      let blockText = normalizeText(block.text)
      switch block.dataType {
      case .none_:
        if !blockText.isEmpty {
          appendTextRun(ContentRun(text: blockText, color: baseContentColor))
        }
      case .nostrdata:
        guard let nostr = block.data(type: nostr_fb_NostrData.self) else { continue }
        let id = nostr.id.trimmingCharacters(in: .whitespacesAndNewlines)
        let entity = nostr.entity.trimmingCharacters(in: .whitespacesAndNewlines)
        let isProfileMention = nostr.author != nil && isUserEntity(entity)
        let isQuote = showQuote && !id.isEmpty && isQuoteEntity(entity) && depth < 3

        if isQuote {
          flushText()
          let quoteRelays = Array(nostr.relays.compactMap { $0 })
          let mergedRelays = quoteRelays.isEmpty ? resolveRelays() : quoteRelays
          let quoteId = "q_\(lines.count)-\(id)"
          lines.append(
            .quote(
              QuoteInfo(
                id: id,
                relays: mergedRelays,
                depth: depth + 1,
                key: quoteId
              )
            )
          )
          continue
        }

        if isProfileMention {
          appendTextRun(ContentRun(text: displayText(entity: entity, id: id, fallback: blockText), color: accentColor))
        } else if isHashtag(blockText) {
          appendTextRun(ContentRun(text: blockText, color: accentColor))
        } else {
          appendTextRun(ContentRun(text: displayText(entity: entity, id: id, fallback: blockText), color: baseContentColor))
        }

      case .hashtagdata:
        if let hashtag = block.data(type: nostr_fb_HashtagData.self) {
          appendTextRun(ContentRun(text: "#\(hashtag.tag ?? "")", color: accentColor))
        } else {
          appendTextRun(ContentRun(
            text: blockText.hasPrefix("#") ? blockText : "#\(blockText)",
            color: accentColor
          ))
        }

      case .linkpreviewdata:
        if let preview = block.data(type: nostr_fb_LinkPreviewData.self) {
          let url = preview.url ?? blockText
          if !url.isEmpty {
            appendTextRun(ContentRun(text: url, color: accentColor))
          }
        }

      case .imagedata:
        if let image = block.data(type: nostr_fb_ImageData.self), !image.url.isEmpty {
          appendTextRun(ContentRun(text: image.url, color: accentColor))
        }

      case .videodata:
        if let video = block.data(type: nostr_fb_VideoData.self), !video.url.isEmpty {
          appendTextRun(ContentRun(text: video.url, color: accentColor))
        }

      case .mediagroupdata:
        if let media = block.data(type: nostr_fb_MediaGroupData.self) {
          for item in media.items {
            if let image = item.image?.url {
              appendTextRun(ContentRun(text: image, color: accentColor))
            } else if let video = item.video?.url {
              appendTextRun(ContentRun(text: video, color: accentColor))
            }
          }
        }

      case .codedata, .cashudata, .emojidata:
        if !blockText.isEmpty {
          appendTextRun(ContentRun(text: blockText, color: baseContentColor))
        }
      }
    }

    flushText()
    return lines
  }

  private static func isUserEntity(_ entity: String) -> Bool {
    entity.hasPrefix("nprofile") || entity.hasPrefix("npub")
  }

  private static func isQuoteEntity(_ entity: String) -> Bool {
    entity.hasPrefix("nevent") || entity.hasPrefix("naddr") || entity.hasPrefix("note") || entity.hasPrefix("event")
  }

  private static func isHashtag(_ value: String) -> Bool {
    value.hasPrefix("#")
  }

  private static func displayText(entity: String, id: String, fallback: String) -> String {
    let trimmed = entity.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { return trimmed }
    let trimmedId = id.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedId.isEmpty { return trimmedId }
    return fallback
  }

  private static func normalizeText(_ value: String) -> String {
    if value.isEmpty { return value }
    let payload = "\"\(value)\""
    guard let data = payload.data(using: .utf8),
          let decoded = try? JSONDecoder().decode(String.self, from: data) else {
      return value.replacingOccurrences(of: "\\\\", with: "\\")
    }
    return decoded
  }
}

@objc(NativeNoteContentView)
class NativeNoteContentView: UIView {
  private var noteId: String = ""
  private var noteBytes: [UInt8]?
  private var contextBytes: [UInt8]?
  private var relays: [String] = []
  private var visible = true
  private var footer = true
  private var main = false
  private var showQuote = true
  private var showMedia = true
  private var showRoot = true
  private var threadCard = false
  private var disableOpen = false
  private var depth = 0
  private var leading = false
  private var tailing = false

  private var headerView = NativeNoteHeaderContentView()
  private var footerView = NativeNoteFooterContentView()

  private var noteSubscription: NipworkerHookHandle?
  private var noteEvent: nostr_fb_ParsedEvent?
  private var missingState: MissingState = .idle
  private var missingTimer: Timer?

  private var primaryTextColor = UIColor.label
  private var secondaryTextColor = UIColor.secondaryLabel
  private var baseContentColor = UIColor.label
  private var cardBackgroundColor = UIColor.secondarySystemBackground
  private var borderColor = UIColor.separator
  private var accentColor = UIColor.systemBlue

  private enum ContentPlacement {
    case inlineText(NSAttributedString, CGRect)
    case quote(QuoteInfo, CGRect)
  }

  private var contentLines: [ContentLine] = []
  private var estimatedContentHeight: CGFloat = 0
  private var quoteViewsByKey: [String: NativeNoteContentView] = [:]

  private enum MissingState {
    case idle
    case loading
    case notFound
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    addSubview(headerView)
    addSubview(footerView)
    footerView.isHidden = true
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    isOpaque = false
    backgroundColor = .clear
    addSubview(headerView)
    addSubview(footerView)
    footerView.isHidden = true
  }

  deinit {
    noteSubscription?.cancel()
    missingTimer?.invalidate()
    for view in quoteViewsByKey.values {
      view.removeFromSuperview()
    }
  }

  @objc(updateNoteId:)
  func updateNoteId(_ value: String?) {
    noteId = value ?? ""
    noteEvent = nil
    rebuildContentLines()
    removeAllQuoteViews()
    refreshNoteSubscription()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateNoteBytes:)
  func updateNoteBytes(_ value: [NSNumber]?) {
    noteBytes = value?.map { UInt8(truncating: $0) }
    emitNativeDebugLog(
      source: "NativeNoteContentView",
      event: "updateNoteBytes",
      details: "noteId=\(noteId), bytes=\(noteBytes?.count ?? 0)"
    )
    noteEvent = parseParsedEvent(noteBytes)
    missingState = noteEvent == nil && !noteId.isEmpty ? .loading : .idle
    rebuildContentLines()
    removeAllQuoteViews()
    headerView.updateNoteBytes(value)
    footerView.updateNoteBytes(value)
    refreshNoteSubscription()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateContextBytes:)
  func updateContextBytes(_ value: [NSNumber]?) {
    contextBytes = value?.map { UInt8(truncating: $0) }
    if noteEvent == nil {
      noteEvent = parseParsedEvent(contextBytes)
      rebuildContentLines()
    }
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateRelays:)
  func updateRelays(_ value: [String]?) {
    relays = value ?? []
    let relaysForSubcomponents = resolvedRelays()
    headerView.updateRelays(relaysForSubcomponents)
    footerView.updateRelays(relaysForSubcomponents)
    refreshNoteSubscription()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateVisible:)
  func updateVisible(_ value: Bool) {
    visible = value
    headerView.updateVisible(value)
    footerView.updateVisible(value)
    for view in quoteViewsByKey.values { view.updateVisible(value) }
    refreshNoteSubscription()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateFooter:)
  func updateFooter(_ value: Bool) {
    footer = value
    footerView.isHidden = !value
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateMain:)
  func updateMain(_ value: Bool) {
    main = value
    headerView.updateMain(main)
    footerView.updateMain(main)
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateShowQuote:)
  func updateShowQuote(_ value: Bool) {
    showQuote = value
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateShowMedia:)
  func updateShowMedia(_ value: Bool) {
    showMedia = value
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateShowRoot:)
  func updateShowRoot(_ value: Bool) { showRoot = value }

  @objc(updateThreadCard:)
  func updateThreadCard(_ value: Bool) {
    threadCard = value
    setNeedsDisplay()
  }

  @objc(updateDisableOpen:)
  func updateDisableOpen(_ value: Bool) { disableOpen = value }

  @objc(updateDepth:)
  func updateDepth(_ value: NSNumber) {
    depth = value.intValue
    headerView.updateDepth(NSNumber(value: depth))
    rebuildContentLines()
    setNeedsLayout()
    invalidateIntrinsicContentSize()
    setNeedsDisplay()
  }

  @objc(updateLeading:)
  func updateLeading(_ value: Bool) { leading = value; setNeedsDisplay() }

  @objc(updateTailing:)
  func updateTailing(_ value: Bool) { tailing = value; setNeedsDisplay() }

  @objc(updatePrimaryTextColor:)
  func updatePrimaryTextColor(_ value: String?) {
    primaryTextColor = UIColor(noteCssColor: value) ?? primaryTextColor
    headerView.updatePrimaryTextColor(value)
    footerView.updatePrimaryColor(value)
    rebuildContentLines()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateSecondaryTextColor:)
  func updateSecondaryTextColor(_ value: String?) {
    secondaryTextColor = UIColor(noteCssColor: value) ?? secondaryTextColor
    headerView.updateSecondaryTextColor(value)
    footerView.updateTintColor(value)
    setNeedsDisplay()
  }

  @objc(updateBaseContentColor:)
  func updateBaseContentColor(_ value: String?) {
    baseContentColor = UIColor(noteCssColor: value) ?? baseContentColor
    rebuildContentLines()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateCardBackgroundColor:)
  func updateCardBackgroundColor(_ value: String?) {
    cardBackgroundColor = UIColor(noteCssColor: value) ?? cardBackgroundColor
    setNeedsDisplay()
  }

  @objc(updateBorderColor:)
  func updateBorderColor(_ value: String?) {
    borderColor = UIColor(noteCssColor: value) ?? borderColor
    setNeedsDisplay()
  }

  @objc(updateAccentColor:)
  func updateAccentColor(_ value: String?) {
    accentColor = UIColor(noteCssColor: value) ?? accentColor
    headerView.updateAccentColor(value)
    footerView.updateAccentColor(value)
    rebuildContentLines()
    setNeedsLayout()
    setNeedsDisplay()
  }

  override var intrinsicContentSize: CGSize {
    let headerHeight: CGFloat = depth > 0 ? 42 : 54
    let footerHeight: CGFloat = footer ? 28 : 0
    let extraBottomPadding: CGFloat = footer ? 12 : 8
    let baseHeight: CGFloat = headerHeight + footerHeight + extraBottomPadding + estimatedContentHeight + (depth > 0 ? 12 : 16)
    let fallbackHeight: CGFloat = depth > 0 ? 76 : (main ? 132 : 108)
    return CGSize(width: UIView.noIntrinsicMetric, height: max(fallbackHeight, baseHeight))
  }

  override func layoutSubviews() {
    super.layoutSubviews()

    let inset: CGFloat = depth > 0 ? 8 : 0
    let cardRect = bounds.insetBy(dx: inset, dy: 1)
    let headerHeight: CGFloat = depth > 0 ? 42 : 54
    let footerHeight: CGFloat = footer ? 24 : 0
    let headerFrame = CGRect(x: cardRect.minX + 12, y: cardRect.minY + 8, width: max(0, cardRect.width - 24), height: headerHeight)
    let footerFrame = CGRect(
      x: cardRect.minX + 8,
      y: cardRect.maxY - footerHeight - 8,
      width: max(0, cardRect.width - 16),
      height: footerHeight
    )
    headerView.frame = headerFrame
    footerView.frame = footerFrame
    footerView.isHidden = !footer

    let placements = contentPlacements(in: cardRect)
    let activeQuoteKeys = Set(placements.compactMap { placement in
      if case let .quote(quote, _) = placement { return quote.key }
      return nil
    })

    var usedKeys = Set<String>()

  for case let .quote(quote, frame) in placements {
      let quoteView = quoteViewsByKey[quote.key] ?? {
        let view = NativeNoteContentView()
        view.updateShowQuote(showQuote)
        view.updateFooter(false)
        view.updateMain(false)
        view.updateVisible(visible)
        return view
      }()

      quoteView.updateNoteId(quote.id)
      quoteView.updateRelays(quote.relays)
      quoteView.updateDepth(NSNumber(value: quote.depth))
      quoteView.updateShowQuote(showQuote)
      quoteView.updateShowMedia(showMedia)
      propagateColors(to: quoteView)
      if quoteViewsByKey[quote.key] == nil {
        addSubview(quoteView)
        quoteViewsByKey[quote.key] = quoteView
      }
      quoteView.frame = frame
      quoteView.isHidden = false
      usedKeys.insert(quote.key)
    }

    for (key, view) in quoteViewsByKey where !usedKeys.contains(key) || !activeQuoteKeys.contains(key) {
      view.removeFromSuperview()
      quoteViewsByKey[key] = nil
    }

    estimateContentHeight(placements)
  }

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }

    let inset: CGFloat = depth > 0 ? 8 : 0
    let cardRect = bounds.insetBy(dx: inset, dy: 1)
    let radius: CGFloat = depth > 0 ? 8 : 10
    let path = UIBezierPath(roundedRect: cardRect, cornerRadius: radius)
    cardBackgroundColor.setFill()
    path.fill()
    borderColor.setStroke()
    path.lineWidth = 1
    path.stroke()

    if leading {
      context.setFillColor(borderColor.cgColor)
      context.fill(CGRect(x: 28, y: cardRect.minY, width: 2, height: 32))
    }
    if tailing {
      context.setFillColor(borderColor.cgColor)
      context.fill(CGRect(x: 28, y: cardRect.maxY - 32, width: 2, height: 32))
    }

    if let event = noteEvent {
      drawEvent(event, cardRect: cardRect)
    } else {
      drawMissing(cardRect: cardRect)
    }
  }

  private func drawEvent(_ event: nostr_fb_ParsedEvent, cardRect: CGRect) {
    let placements = contentPlacements(in: cardRect)
    for placement in placements {
      switch placement {
      case let .inlineText(text, frame):
        drawAttributedText(text, in: frame)
      case .quote:
        continue
      }
    }
  }

  private func drawMissing(cardRect: CGRect) {
    let left = cardRect.minX + 12
    let top = cardRect.minY + 12
    let title: String
    switch missingState {
    case .notFound:
      title = "Not found"
    case .loading:
      title = "Loading note"
    case .idle:
      title = "No note"
    }
    drawText(title, x: left, y: top, width: cardRect.width - 24, font: .systemFont(ofSize: 14, weight: .semibold), color: primaryTextColor)
    if !noteId.isEmpty {
      drawText(
        String(noteId.prefix(12)) + "...",
        x: left,
        y: top + 22,
        width: cardRect.width - 24,
        font: .monospacedSystemFont(ofSize: 11, weight: .regular),
        color: secondaryTextColor
      )
    }
  }

  private func contentPlacements(in cardRect: CGRect) -> [ContentPlacement] {
    let font = UIFont.systemFont(ofSize: 15)
    let x = cardRect.minX + 12
    let availableWidth = max(0, cardRect.width - 24)
    var y = headerView.frame.maxY + 2
    var placements: [ContentPlacement] = []

    for line in contentLines {
      switch line {
      case let .text(runs):
        if runs.isEmpty { continue }
        let attributed = attributedText(from: runs, font: font)
        let options: NSStringDrawingOptions = [.usesLineFragmentOrigin, .usesFontLeading]
        let size = attributed.boundingRect(
          with: CGSize(width: availableWidth, height: CGFloat.greatestFiniteMagnitude),
          options: options,
          context: nil as NSStringDrawingContext?
        ).size
        let lineHeight = max(ceil(size.height), ceil(font.lineHeight))
        let frame = CGRect(x: x, y: y, width: availableWidth, height: lineHeight)
        placements.append(.inlineText(attributed, frame))
        y += lineHeight + 2

      case let .quote(quote):
        let quoteFrame = CGRect(x: x, y: y, width: availableWidth, height: 76)
        placements.append(.quote(quote, quoteFrame))
        y += 84
      }
    }

    estimatedContentHeight = max(0, y - (headerView.frame.maxY + 2))
    invalidateIntrinsicContentSize()
    return placements
  }

  private func estimateContentHeight(_ placements: [ContentPlacement]) {
    var total: CGFloat = 0
    for placement in placements {
      switch placement {
      case let .inlineText(_, frame):
        total = max(total, frame.maxY)
      case let .quote(_, frame):
        total = max(total, frame.maxY)
      }
    }
    if total > 0 {
      estimatedContentHeight = max(total - (headerView.frame.maxY + 2), 0)
      invalidateIntrinsicContentSize()
    }
  }

  private func rebuildContentLines() {
    guard let event = noteEvent else {
      contentLines = [ContentLine.text([ContentRun(text: "Kind \(noteId.isEmpty ? "event" : noteId.prefix(8))", color: baseContentColor)])]
      return
    }

    if event.kind == 1 {
      contentLines = NativeContentBlockParser.build(
        from: event,
        baseContentColor: baseContentColor,
        accentColor: accentColor,
        showQuote: showQuote,
        depth: depth,
        resolveRelays: resolvedRelays
      )
      return
    }

    contentLines = [ContentLine.text([ContentRun(text: "Kind \(event.kind)", color: baseContentColor)])]
  }

  private func attributedText(from runs: [ContentRun], font: UIFont) -> NSAttributedString {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byWordWrapping
    let attributedText = NSMutableAttributedString()

    for run in runs {
      let runText = run.text
      if runText.isEmpty { continue }
      let color = run.color
      let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: paragraph,
      ]
      attributedText.append(NSAttributedString(string: runText, attributes: attributes))
    }

    return attributedText
  }

  private func removeAllQuoteViews() {
    for (_, view) in quoteViewsByKey {
      view.removeFromSuperview()
    }
    quoteViewsByKey = [:]
  }

  private func propagateColors(to note: NativeNoteContentView) {
    if let primary = cssColorString(primaryTextColor) { note.updatePrimaryTextColor(primary) }
    if let secondary = cssColorString(secondaryTextColor) { note.updateSecondaryTextColor(secondary) }
    if let base = cssColorString(baseContentColor) { note.updateBaseContentColor(base) }
    if let border = cssColorString(borderColor) { note.updateBorderColor(border) }
    if let accent = cssColorString(accentColor) { note.updateAccentColor(accent) }
  }

  private func cssColorString(_ color: UIColor) -> String? {
    guard let components = color.cgColor.components else { return nil }
    let red = Int((components[safe: 0] ?? 0) * 255)
    let green = Int((components[safe: 1] ?? 0) * 255)
    let blue = Int((components[safe: 2] ?? 0) * 255)
    let alpha = components.count > 3 ? components[3] : 1
    if alpha >= 1 {
      return String(format: "#%02x%02x%02x", red, green, blue)
    }
    return String(format: "rgba(%d, %d, %d, %.3f)", red, green, blue, alpha)
  }

  private func resolvedRelays() -> [String] {
    relays.isEmpty ? NativeNoteConstants.defaultRelays : relays
  }

  private func refreshNoteSubscription() {
    noteSubscription?.cancel()
    noteSubscription = nil
    missingTimer?.invalidate()
    missingTimer = nil

    if visible && !noteId.isEmpty {
      headerView.updateRelays(resolvedRelays())
      headerView.updateVisible(visible)
      headerView.updateMain(main)
      headerView.updateDepth(NSNumber(value: depth))
      headerView.updateShowRelays(true)
      headerView.updateRelayCount(NSNumber(value: resolvedRelays().count))
      headerView.updateFallbackSubId(noteId)
      footerView.updateRelays(resolvedRelays())
      footerView.updateVisible(visible)
      footerView.updateMain(main)
      footerView.updateZoom(false)
      footerView.updateCurrentUserPubkey(nil)
    }

    guard visible && noteEvent == nil && !noteId.isEmpty else {
      if !visible || noteEvent != nil || noteId.isEmpty {
        emitNativeDebugLog(
          source: "NativeNoteContentView",
          event: "refreshNoteSubscription-skipped",
          details: "visible=\(visible), hasNote=\(noteEvent != nil), noteIdEmpty=\(noteId.isEmpty)"
        )
      }
      return
    }

    emitNativeDebugLog(
      source: "NativeNoteContentView",
      event: "refreshNoteSubscription",
      details: "noteId=\(noteId), relays=\(resolvedRelays().count)"
    )
    missingState = .loading
    noteSubscription = useSubscriptionHandle(
      subscriptionId: noteId,
      requests: [
        RequestObject(ids: [noteId], limit: 5, relays: resolvedRelays(), cacheFirst: true)
      ],
      callback: { [weak self] messages in
        DispatchQueue.main.async {
          self?.handleNoteMessages(messages)
        }
      },
      options: SubscriptionConfig(bytesPerEvent: 10 * 1024)
    )
    missingTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: false) { [weak self] _ in
      guard let self, self.noteEvent == nil else { return }
      self.missingState = .notFound
      self.setNeedsDisplay()
    }
  }

  private func handleNoteMessages(_ messages: [WorkerMessageView]) {
    for message in messages {
      guard let parsed = message.parsedEvent, parsed.id == noteId else { continue }
      emitNativeDebugLog(
        source: "NativeNoteContentView",
        event: "handleNoteMessages",
        details: "matched id=\(parsed.id ?? "nil"), kind=\(parsed.kind)"
      )
      noteEvent = parsed
      missingState = .idle
      missingTimer?.invalidate()
      missingTimer = nil
      rebuildContentLines()
      removeAllQuoteViews()
      invalidateIntrinsicContentSize()
      setNeedsLayout()
      setNeedsDisplay()
      break
    }
  }

  private func parseParsedEvent(_ bytes: [UInt8]?) -> nostr_fb_ParsedEvent? {
    guard let bytes, bytes.count >= 4 else { return nil }
    let byteBuffer = ByteBuffer(bytes: bytes)
    let rootOffset = byteBuffer.read(def: Int32.self, position: 0)
    let worker = nostr_fb_WorkerMessage(byteBuffer, o: rootOffset)
    guard worker.contentType == .parsedevent else {
      emitNativeDebugLog(
        source: "NativeNoteContentView",
        event: "parseParsedEvent",
        details: "unexpected contentType=\(worker.contentType)"
      )
      return nil
    }
    return worker.content(type: nostr_fb_ParsedEvent.self)
  }

  private func drawText(_ value: String, x: CGFloat, y: CGFloat, width: CGFloat, font: UIFont, color: UIColor, height: CGFloat? = nil) {
    guard width > 0, !value.isEmpty else { return }
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byTruncatingTail
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: color,
      .paragraphStyle: paragraph,
    ]
    (value as NSString).draw(
      with: CGRect(x: x, y: y, width: width, height: height ?? font.lineHeight + 4),
      options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
      attributes: attributes,
      context: nil
    )
  }

  private func drawAttributedText(_ attributedText: NSAttributedString, in frame: CGRect) {
    attributedText.draw(
      with: frame,
      options: NSStringDrawingOptions([.usesLineFragmentOrigin, .usesFontLeading]),
      context: nil as NSStringDrawingContext?
    )
  }

  private func shortPubkey(_ value: String) -> String {
    value.count <= 12 ? value : "\(value.prefix(6))...\(value.suffix(4))"
  }

  private func formatTimeShort(_ timestamp: UInt32) -> String {
    guard timestamp > 0 else { return "" }
    let diff = max(0, Int(Date().timeIntervalSince1970) - Int(timestamp))
    if diff < 60 { return "\(diff)s" }
    if diff < 3600 { return "\(diff / 60)m" }
    if diff < 86400 { return "\(diff / 3600)h" }
    return "\(diff / 86400)d"
  }
}

private enum NativeNoteConstants {
  static let defaultRelays = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nuts.cash",
  ]
}

private extension UIColor {
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

private extension Array {
  subscript(safe index: Int) -> Element? {
    index >= 0 && index < count ? self[index] : nil
  }
}
