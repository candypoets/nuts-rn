import Foundation
import FlatBuffers
import NipworkerSwift
import AVFoundation
import UIKit
enum NativeMediaLayout {
  static let maxImageHeight: CGFloat = 384
  static let gridHeight: CGFloat = 192
  static let gap: CGFloat = 4
  static let maxDisplayLinks = 6

  static func height(items: [MediaInfo], width: CGFloat) -> CGFloat {
    let displayCount = min(items.count, maxDisplayLinks)
    guard displayCount > 0 else { return 0 }
    if displayCount == 1 {
      return imageHeight(dim: items[0].dim, width: width)
    }
    return gridHeight
  }

  static func imageHeight(dim: String?, width: CGFloat) -> CGFloat {
    guard let dim,
          let parsed = parseDim(dim),
          parsed.width > 0 else {
      return min(width, maxImageHeight)
    }
    return min((parsed.height * width) / parsed.width, maxImageHeight)
  }

  static func tileFrame(total: Int, index: Int, width: CGFloat, height: CGFloat) -> CGRect {
    let halfWidth = (width - gap) / 2
    let halfHeight = (height - gap) / 2
    let thirdWidth = (width - gap * 2) / 3
    let twoThirdsWidth = thirdWidth * 2 + gap

    if total <= 1 {
      return CGRect(x: 0, y: 0, width: width, height: height)
    }
    if total == 2 {
      return CGRect(x: index == 0 ? 0 : halfWidth + gap, y: 0, width: halfWidth, height: height)
    }
    if total == 3 {
      if index == 0 {
        return CGRect(x: 0, y: 0, width: halfWidth, height: height)
      }
      return CGRect(x: halfWidth + gap, y: index == 1 ? 0 : halfHeight + gap, width: halfWidth, height: halfHeight)
    }
    if total == 4 {
      return CGRect(x: index % 2 == 0 ? 0 : halfWidth + gap, y: index < 2 ? 0 : halfHeight + gap, width: halfWidth, height: halfHeight)
    }
    if total == 5 {
      if index == 0 {
        return CGRect(x: 0, y: 0, width: halfWidth, height: height)
      }
      let offsetIndex = index - 1
      let smallWidth = (halfWidth - gap) / 2
      return CGRect(
        x: halfWidth + gap + CGFloat(offsetIndex % 2) * (smallWidth + gap),
        y: offsetIndex < 2 ? 0 : halfHeight + gap,
        width: smallWidth,
        height: halfHeight
      )
    }
    if total == 6 {
      return CGRect(x: CGFloat(index % 3) * (thirdWidth + gap), y: index < 3 ? 0 : halfHeight + gap, width: thirdWidth, height: halfHeight)
    }
    return CGRect(x: 0, y: 0, width: twoThirdsWidth, height: height)
  }

  private static func parseDim(_ dim: String) -> (width: CGFloat, height: CGFloat)? {
    let parts = dim.split(separator: "x").compactMap { Double($0) }
    guard parts.count == 2, parts[0] > 0, parts[1] > 0 else { return nil }
    return (CGFloat(parts[0]), CGFloat(parts[1]))
  }
}

@objc(NativeContentBlocksContentView)
class NativeContentBlocksContentView: UIView {
  var onNativeRoute: ((String) -> Void)?
  var onContentSizeChange: (() -> Void)?

  private var noteId: String = ""
  private var noteBytes: [UInt8]?
  private var noteEvent: nostr_fb_ParsedEvent?
  private var relays: [String] = []
  private var visible = true
  private var main = false
  private var showQuote = true
  private var showMedia = true
  private var forceFullContent = false
  private var depth = 0
  private var relayResolutionPending = false

  private var primaryTextColor = UIColor.label
  private var secondaryTextColor = UIColor.secondaryLabel
  private var baseContentColor = UIColor.label
  private var cardBackgroundColor = UIColor.secondarySystemBackground
  private var borderColor = UIColor.separator
  private var accentColor = UIColor.systemBlue

  private enum ContentPlacement {
    case inlineText(NSAttributedString, CGRect)
    case quote(QuoteInfo, CGRect)
    case linkPreview(LinkPreviewInfo, CGRect)
    case mediaGrid([MediaInfo], String, CGRect)
  }

  private var contentLines: [ContentLine] = []
  private var quoteViewsByKey: [String: NativeNoteContentView] = [:]
  private var quoteHeightsByKey: [String: CGFloat] = [:]
  private var linkPreviewViewsByKey: [String: NativeLinkPreviewContentView] = [:]
  private var linkPreviewHeightsByKey: [String: CGFloat] = [:]
  private var mediaViewsByKey: [String: NativeMediaViewerContentView] = [:]
  private var measurementGeneration: UInt64 = 0
  private var profileNamesByPubkey: [String: String] = [:]
  private var profileHooksByPubkey: [String: NativeProfileHook] = [:]

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
    cancelProfileSubscriptions()
    removeAllQuoteViews()
    removeAllLinkPreviewViews()
    removeAllMediaViews()
  }

  @objc(updateNoteId:)
  func updateNoteId(_ value: String?) {
    let nextNoteId = value ?? ""
    if noteId == nextNoteId { return }
    noteId = nextNoteId
    resetMeasuredChildState()
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateNoteBytes:)
  func updateNoteBytes(_ value: [NSNumber]?) {
    let nextBytes = value?.map { UInt8(truncating: $0) }
    if noteBytes == nextBytes { return }
    let previousEventId = noteEvent?.id
    noteBytes = nextBytes
    noteEvent = parseParsedEvent(noteBytes)
    if previousEventId != noteEvent?.id {
      resetMeasuredChildState()
    } else {
      removeAllQuoteViews()
      removeAllLinkPreviewViews()
      removeAllMediaViews()
    }
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  func updateParsedEvent(_ event: nostr_fb_ParsedEvent?) {
    let previousEventId = noteEvent?.id
    noteEvent = event ?? parseParsedEvent(noteBytes)
    if previousEventId != noteEvent?.id {
      resetMeasuredChildState()
    } else {
      removeAllQuoteViews()
      removeAllLinkPreviewViews()
      removeAllMediaViews()
    }
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateRelays:)
  func updateRelays(_ value: [String]?) {
    let nextRelays = value ?? []
    if relays == nextRelays { return }
    relays = nextRelays
    for view in quoteViewsByKey.values {
      view.updateRelays(resolvedRelays())
    }
    rebuildContentLines()
    refreshProfileSubscriptions()
    setNeedsLayout()
    setNeedsDisplay()
  }

  func updateRelayResolutionPending(_ value: Bool) {
    if relayResolutionPending == value { return }
    relayResolutionPending = value
    refreshProfileSubscriptions()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateVisible:)
  func updateVisible(_ value: Bool) {
    if visible == value { return }
    visible = value
    for view in quoteViewsByKey.values {
      view.updateVisible(value)
    }
    refreshProfileSubscriptions()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateMain:)
  func updateMain(_ value: Bool) {
    if main == value { return }
    main = value
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateShowQuote:)
  func updateShowQuote(_ value: Bool) {
    if showQuote == value { return }
    showQuote = value
    resetMeasuredChildState()
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateShowMedia:)
  func updateShowMedia(_ value: Bool) {
    if showMedia == value { return }
    showMedia = value
    resetMeasuredChildState()
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateForceFullContent:)
  func updateForceFullContent(_ value: Bool) {
    if forceFullContent == value { return }
    forceFullContent = value
    resetMeasuredChildState()
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateDepth:)
  func updateDepth(_ value: NSNumber) {
    if depth == value.intValue { return }
    depth = value.intValue
    resetMeasuredChildState()
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updatePrimaryTextColor:)
  func updatePrimaryTextColor(_ value: String?) {
    primaryTextColor = UIColor(noteCssColor: value) ?? primaryTextColor
    setNeedsDisplay()
  }

  @objc(updateSecondaryTextColor:)
  func updateSecondaryTextColor(_ value: String?) {
    secondaryTextColor = UIColor(noteCssColor: value) ?? secondaryTextColor
    setNeedsDisplay()
  }

  @objc(updateBaseContentColor:)
  func updateBaseContentColor(_ value: String?) {
    baseContentColor = UIColor(noteCssColor: value) ?? baseContentColor
    rebuildContentLines()
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
    for view in quoteViewsByKey.values {
      view.updateBorderColor(value)
    }
    setNeedsDisplay()
  }

  @objc(updateAccentColor:)
  func updateAccentColor(_ value: String?) {
    accentColor = UIColor(noteCssColor: value) ?? accentColor
    rebuildContentLines()
    for view in quoteViewsByKey.values {
      view.updateAccentColor(value)
    }
    setNeedsDisplay()
  }

  func estimatedHeight(forWidth width: CGFloat) -> CGFloat {
    contentPlacements(width: width).reduce(CGFloat(0)) { height, placement in
      switch placement {
      case let .inlineText(_, frame):
        return max(height, frame.maxY)
      case let .quote(_, frame):
        return max(height, frame.maxY)
      case let .linkPreview(_, frame):
        return max(height, frame.maxY)
      case let .mediaGrid(_, _, frame):
        return max(height, frame.maxY)
      }
    }
  }

  override var intrinsicContentSize: CGSize {
    CGSize(width: UIView.noIntrinsicMetric, height: estimatedHeight(forWidth: bounds.width))
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let placements = contentPlacements(width: bounds.width)
    let activeQuoteKeys = Set(placements.compactMap { placement -> String? in
      if case let .quote(quote, _) = placement { return quote.key }
      return nil
    })
    let activeMediaKeys = Set(placements.compactMap { placement -> String? in
      if case let .mediaGrid(_, key, _) = placement { return key }
      return nil
    })
    let activeLinkKeys = Set(placements.compactMap { placement -> String? in
      if case let .linkPreview(preview, _) = placement { return preview.key }
      return nil
    })
    var usedKeys = Set<String>()
    var usedLinkKeys = Set<String>()
    var usedMediaKeys = Set<String>()

    for case let .quote(quote, frame) in placements {
      let quoteView = quoteViewsByKey[quote.key] ?? {
        let view = NativeNoteContentView()
        view.onNativeRoute = onNativeRoute
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
      quoteView.onNativeRoute = onNativeRoute
      let generation = measurementGeneration
      quoteView.onHeightChange = { [weak self] height in
        self?.updateQuoteHeight(height, forKey: quote.key, generation: generation)
      }
      propagateColors(to: quoteView)
      if quoteViewsByKey[quote.key] == nil {
        addSubview(quoteView)
        quoteViewsByKey[quote.key] = quoteView
      }
      quoteView.frame = frame
      quoteView.isHidden = false
      usedKeys.insert(quote.key)
    }

    for case let .linkPreview(preview, frame) in placements {
      let previewView = linkPreviewViewsByKey[preview.key] ?? {
        let view = NativeLinkPreviewContentView()
        addSubview(view)
        linkPreviewViewsByKey[preview.key] = view
        return view
      }()
      previewView.onNativeRoute = onNativeRoute
      let generation = measurementGeneration
      previewView.onHeightChange = { [weak self] height in
        self?.updateLinkPreviewHeight(height, forKey: preview.key, generation: generation)
      }
      previewView.updateColors(
        baseContent: baseContentColor,
        secondaryText: secondaryTextColor,
        background: cardBackgroundColor,
        border: borderColor
      )
      previewView.update(preview: preview)
      previewView.frame = frame
      previewView.isHidden = false
      usedLinkKeys.insert(preview.key)
    }

    for case let .mediaGrid(items, key, frame) in placements {
      let mediaView = mediaViewsByKey[key] ?? {
        let view = NativeMediaViewerContentView()
        addSubview(view)
        mediaViewsByKey[key] = view
        return view
      }()
      mediaView.update(items: items)
      mediaView.frame = frame
      mediaView.isHidden = false
      usedMediaKeys.insert(key)
    }

    for (key, view) in quoteViewsByKey where !usedKeys.contains(key) || !activeQuoteKeys.contains(key) {
      view.removeFromSuperview()
      quoteViewsByKey[key] = nil
      quoteHeightsByKey[key] = nil
    }
    for (key, view) in linkPreviewViewsByKey where !usedLinkKeys.contains(key) || !activeLinkKeys.contains(key) {
      view.removeFromSuperview()
      linkPreviewViewsByKey[key] = nil
      linkPreviewHeightsByKey[key] = nil
    }
    for (key, view) in mediaViewsByKey where !usedMediaKeys.contains(key) || !activeMediaKeys.contains(key) {
      view.removeFromSuperview()
      mediaViewsByKey[key] = nil
    }
  }

  override func draw(_ rect: CGRect) {
    for placement in contentPlacements(width: bounds.width) {
      switch placement {
      case let .inlineText(text, frame):
        drawAttributedText(text, in: frame)
      case .linkPreview:
        continue
      case .quote:
        continue
      case .mediaGrid:
        continue
      }
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let point = touches.first?.location(in: self) else {
      super.touchesEnded(touches, with: event)
      return
    }
    for placement in contentPlacements(width: bounds.width) {
      if case let .linkPreview(_, frame) = placement, frame.contains(point) { return }
    }
    super.touchesEnded(touches, with: event)
  }

  private func contentPlacements(width: CGFloat) -> [ContentPlacement] {
    let font = UIFont.systemFont(ofSize: 15)
    let availableWidth = max(0, width)
    var y: CGFloat = 0
    var placements: [ContentPlacement] = []

    for line in contentLines {
      switch line {
      case let .text(runs):
        if runs.isEmpty { continue }
        let attributed = attributedText(from: runs, font: font)
        let size = attributed.boundingRect(
          with: CGSize(width: availableWidth, height: CGFloat.greatestFiniteMagnitude),
          options: [.usesLineFragmentOrigin, .usesFontLeading],
          context: nil as NSStringDrawingContext?
        ).size
        let lineHeight = max(ceil(size.height), ceil(font.lineHeight))
        placements.append(.inlineText(attributed, CGRect(x: 0, y: y, width: availableWidth, height: lineHeight)))
        y += lineHeight + 3

      case let .quote(quote):
        let quoteHeight = max(76, quoteHeightsByKey[quote.key] ?? 76)
        placements.append(.quote(quote, CGRect(x: 0, y: y, width: availableWidth, height: quoteHeight)))
        y += quoteHeight + 8

      case let .linkPreview(preview):
        let height = linkPreviewHeightsByKey[preview.key] ?? NativeLinkPreviewContentView.height(
          width: availableWidth,
          hasThumbnail: youtubeVideoId(preview.url) != nil,
          hasDescription: youtubeVideoId(preview.url) == nil
        )
        placements.append(.linkPreview(preview, CGRect(x: 0, y: y, width: availableWidth, height: height)))
        y += height + 8

      case let .mediaGrid(items, key):
        let height = NativeMediaLayout.height(items: items, width: availableWidth)
        if height > 0 {
          placements.append(.mediaGrid(items, key, CGRect(x: 0, y: y, width: availableWidth, height: height)))
          y += height + 8
        }
      }
    }

    return placements
  }

  private func rebuildContentLines() {
    guard let event = noteEvent else {
      contentLines = noteId.isEmpty ? [] : [.text([ContentRun(text: "Kind \(noteId.prefix(8))", color: baseContentColor)])]
      refreshProfileSubscriptions()
      return
    }

    if event.kind == 1 {
      contentLines = NativeContentBlockParser.build(
        from: event,
        baseContentColor: baseContentColor,
        accentColor: accentColor,
        showQuote: showQuote,
        showMedia: showMedia,
        forceFullContent: forceFullContent,
        depth: depth,
        resolveRelays: resolvedRelays,
        resolveProfileName: { [weak self] pubkey, fallback in
          self?.profileNamesByPubkey[pubkey] ?? fallback
        }
      )
      refreshProfileSubscriptions()
      return
    }

    contentLines = [.text([ContentRun(text: "Kind \(event.kind)", color: baseContentColor)])]
    refreshProfileSubscriptions()
  }

  private func attributedText(from runs: [ContentRun], font: UIFont) -> NSAttributedString {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byWordWrapping
    let attributedText = NSMutableAttributedString()

    for run in runs {
      if run.text.isEmpty { continue }
      attributedText.append(NSAttributedString(string: run.text, attributes: [
        .font: font,
        .foregroundColor: run.color,
        .paragraphStyle: paragraph,
      ]))
    }

    return attributedText
  }

  private func refreshProfileSubscriptions() {
    let nextPubkeys = Set(contentLines.flatMap { line -> [String] in
      guard case let .text(runs) = line else { return [] }
      return runs.compactMap { run in
        let pubkey = run.profilePubkey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return pubkey.isEmpty ? nil : pubkey
      }
    })

    for (pubkey, hook) in profileHooksByPubkey where !nextPubkeys.contains(pubkey) || !visible {
      hook.cancel()
      profileHooksByPubkey[pubkey] = nil
    }

    guard visible else { return }

    for pubkey in nextPubkeys {
      let hook = profileHooksByPubkey[pubkey] ?? {
        let hook = NativeProfileHook()
        hook.onProfile = { [weak self] profile in
          self?.handleProfile(profile, requestedPubkey: pubkey)
        }
        profileHooksByPubkey[pubkey] = hook
        return hook
      }()
      hook.update(pubkey: pubkey, relays: resolvedRelays(), visible: visible && !relayResolutionPending)
    }
  }

  private func cancelProfileSubscriptions() {
    for hook in profileHooksByPubkey.values {
      hook.cancel()
    }
    profileHooksByPubkey = [:]
  }

  private func handleProfile(_ profile: NativeProfileSnapshot, requestedPubkey: String) {
    guard profile.pubkey == requestedPubkey else { return }
    let nextName = profile.bestName
    guard profileNamesByPubkey[requestedPubkey] != nextName else { return }
    profileNamesByPubkey[requestedPubkey] = nextName
    rebuildContentLines()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
    onContentSizeChange?()
  }

  private static func shortPubkey(_ pubkey: String) -> String {
    if pubkey.isEmpty { return "unknown" }
    return "\(pubkey.prefix(12))..."
  }

  private func linkPreviewHeight(width: CGFloat, preview: LinkPreviewInfo) -> CGFloat {
    isYouTubeUrl(preview.url) ? min(width * 9 / 16 + 76, 292) : 96
  }

  private func drawLinkPreview(_ preview: LinkPreviewInfo, in frame: CGRect) {
    let path = UIBezierPath(roundedRect: frame, cornerRadius: 8)
    cardBackgroundColor.setFill()
    path.fill()
    borderColor.setStroke()
    path.lineWidth = 1
    path.stroke()

    let isYouTube = isYouTubeUrl(preview.url)
    var textTop = frame.minY + 10
    if isYouTube {
      let thumbnailFrame = CGRect(x: frame.minX, y: frame.minY, width: frame.width, height: min(frame.width * 9 / 16, frame.height - 76))
      UIColor.black.withAlphaComponent(0.08).setFill()
      UIBezierPath(roundedRect: thumbnailFrame, byRoundingCorners: [.topLeft, .topRight], cornerRadii: CGSize(width: 8, height: 8)).fill()
      drawPlayGlyph(in: thumbnailFrame)
      textTop = thumbnailFrame.maxY + 10
    }

    let label = hostLabel(for: preview.url)
    let labelAttrs: [NSAttributedString.Key: Any] = [
      .font: UIFont.systemFont(ofSize: 11, weight: .semibold),
      .foregroundColor: secondaryTextColor,
    ]
    label.uppercased().draw(
      with: CGRect(x: frame.minX + 12, y: textTop, width: frame.width - 24, height: 16),
      options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
      attributes: labelAttrs,
      context: nil
    )

    let title = preview.text == preview.url ? strippedUrl(preview.url) : preview.text
    let titleAttrs: [NSAttributedString.Key: Any] = [
      .font: UIFont.systemFont(ofSize: 15, weight: .medium),
      .foregroundColor: baseContentColor,
    ]
    title.draw(
      with: CGRect(x: frame.minX + 12, y: textTop + 21, width: frame.width - 24, height: 40),
      options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
      attributes: titleAttrs,
      context: nil
    )
  }

  private func drawPlayGlyph(in frame: CGRect) {
    let circle = CGRect(x: frame.midX - 24, y: frame.midY - 24, width: 48, height: 48)
    UIColor.black.withAlphaComponent(0.62).setFill()
    UIBezierPath(ovalIn: circle).fill()

    let path = UIBezierPath()
    path.move(to: CGPoint(x: circle.midX - 6, y: circle.midY - 11))
    path.addLine(to: CGPoint(x: circle.midX - 6, y: circle.midY + 11))
    path.addLine(to: CGPoint(x: circle.midX + 12, y: circle.midY))
    path.close()
    UIColor.white.setFill()
    path.fill()
  }

  private func isYouTubeUrl(_ value: String) -> Bool {
    let lower = value.lowercased()
    return lower.contains("youtube.com") || lower.contains("youtu.be")
  }

  private func hostLabel(for value: String) -> String {
    guard let url = URL(string: normalizedUrl(value)), let host = url.host else {
      return strippedUrl(value).split(separator: "/").first.map(String.init) ?? value
    }
    return host.replacingOccurrences(of: "www.", with: "")
  }

  private func strippedUrl(_ value: String) -> String {
    value
      .replacingOccurrences(of: "https://", with: "")
      .replacingOccurrences(of: "http://", with: "")
      .replacingOccurrences(of: "www.", with: "")
  }

  private func normalizedUrl(_ value: String) -> String {
    value.range(of: #"^https?://"#, options: .regularExpression) == nil ? "https://\(value)" : value
  }

  private func drawAttributedText(_ attributedText: NSAttributedString, in frame: CGRect) {
    attributedText.draw(
      with: frame,
      options: NSStringDrawingOptions([.usesLineFragmentOrigin, .usesFontLeading]),
      context: nil as NSStringDrawingContext?
    )
  }

  private func removeAllQuoteViews() {
    for view in quoteViewsByKey.values {
      view.removeFromSuperview()
    }
    quoteViewsByKey = [:]
    quoteHeightsByKey = [:]
  }

  private func removeAllLinkPreviewViews() {
    for view in linkPreviewViewsByKey.values {
      view.removeFromSuperview()
    }
    linkPreviewViewsByKey = [:]
    linkPreviewHeightsByKey = [:]
  }

  private func updateQuoteHeight(_ height: CGFloat, forKey key: String, generation: UInt64) {
    guard generation == measurementGeneration else { return }
    guard height.isFinite, height > 0 else { return }
    let nextHeight = ceil(max(76, height))
    if abs((quoteHeightsByKey[key] ?? 76) - nextHeight) < 1 { return }
    quoteHeightsByKey[key] = nextHeight
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
    onContentSizeChange?()
  }

  private func updateLinkPreviewHeight(_ height: CGFloat, forKey key: String, generation: UInt64) {
    guard generation == measurementGeneration else { return }
    guard height.isFinite, height > 0 else { return }
    let nextHeight = ceil(height)
    if abs((linkPreviewHeightsByKey[key] ?? 0) - nextHeight) < 1 { return }
    linkPreviewHeightsByKey[key] = nextHeight
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
    onContentSizeChange?()
  }

  private func removeAllMediaViews() {
    for view in mediaViewsByKey.values {
      view.removeFromSuperview()
    }
    mediaViewsByKey = [:]
  }

  private func resetMeasuredChildState() {
    measurementGeneration &+= 1
    removeAllQuoteViews()
    removeAllLinkPreviewViews()
    removeAllMediaViews()
  }

  private func propagateColors(to note: NativeNoteContentView) {
    if let primary = cssColorString(primaryTextColor) { note.updatePrimaryTextColor(primary) }
    if let secondary = cssColorString(secondaryTextColor) { note.updateSecondaryTextColor(secondary) }
    if let base = cssColorString(baseContentColor) { note.updateBaseContentColor(base) }
    if let background = cssColorString(cardBackgroundColor) { note.updateCardBackgroundColor(background) }
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
    if relayResolutionPending {
      return []
    }
    return relays.isEmpty ? NativeNoteConstants.defaultRelays : relays
  }

  private func parseParsedEvent(_ bytes: [UInt8]?) -> nostr_fb_ParsedEvent? {
    guard let bytes, bytes.count >= 4 else { return nil }
    let byteBuffer = ByteBuffer(bytes: bytes)
    let rootOffset = byteBuffer.read(def: Int32.self, position: 0)
    let worker = nostr_fb_WorkerMessage(byteBuffer, o: rootOffset)
    guard worker.contentType == .parsedevent else { return nil }
    return worker.content(type: nostr_fb_ParsedEvent.self)
  }
}
