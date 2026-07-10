import Foundation
import FlatBuffers
import NipworkerSwift
import AVFoundation
import UIKit
@objc(NativeNoteContentView)
class NativeNoteContentView: UIView, UIGestureRecognizerDelegate {
  @objc var onHeightChange: ((CGFloat) -> Void)?
  @objc var onNativeRoute: ((String) -> Void)? {
    didSet {
      headerView.onNativeRoute = onNativeRoute
      contentBlocksView.onNativeRoute = onNativeRoute
    }
  }
  private var lastReportedHeight: CGFloat = 0

  private var noteId: String = ""
  private var noteBytes: [UInt8]?
  private var contextBytes: [UInt8]?
  private var relays: [String] = []
  private var relayStatuses: [String: String] = [:]
  private var visible = true
  private var footer = true
  private var main = false
  private var showQuote = true
  private var showMedia = true
  private var forceFullContent = false
  private var showRoot = true
  private var threadCard = false
  private var disableOpen = false
  private var depth = 0
  private var leading = false
  private var tailing = false

  private var headerView = NativeNoteHeaderContentView()
  private var contentBlocksView = NativeContentBlocksContentView()
  private var footerView = NativeNoteFooterContentView()

  private var noteSubscription: NipworkerHookHandle?
  private var activeNoteSubscriptionKey = ""
  private lazy var authorRelaysHook: NativeAuthorReadRelaysHook = {
    let hook = NativeAuthorReadRelaysHook()
    hook.onRelays = { [weak self] resolvedRelays in
      guard let self else { return }
      let nextRelays = NativeAuthorReadRelaysHook.normalizedRelays(resolvedRelays)
      if nextRelays.isEmpty {
        self.authorRelayTimedOut = true
        self.applyResolvedRelaysToSubviews()
        self.refreshNoteSubscription()
        self.setNeedsLayout()
        self.setNeedsDisplay()
        return
      }
      if self.authorReadRelays == nextRelays { return }
      self.authorReadRelays = nextRelays
      self.authorRelayTimedOut = false
      self.activeNoteSubscriptionKey = ""
      self.applyResolvedRelaysToSubviews()
      self.refreshNoteSubscription()
      self.setNeedsLayout()
      self.setNeedsDisplay()
    }
    return hook
  }()
  private var authorReadRelays: [String]?
  private var authorRelayTimedOut = false
  private var noteEvent: nostr_fb_ParsedEvent?
  private var missingState: MissingState = .idle
  private var missingTimer: Timer?

  private var primaryTextColor = UIColor.label
  private var secondaryTextColor = UIColor.secondaryLabel
  private var baseContentColor = UIColor.label
  private var cardBackgroundColor = UIColor.secondarySystemBackground
  private var borderColor = UIColor.separator
  private var accentColor = UIColor.systemBlue

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
    addSubview(contentBlocksView)
    addSubview(footerView)
    headerView.onNativeRoute = onNativeRoute
    footerView.onRelayStatusChange = nil
    contentBlocksView.onContentSizeChange = { [weak self] in
      self?.invalidateIntrinsicContentSize()
      self?.setNeedsLayout()
      self?.setNeedsDisplay()
    }
    let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    recognizer.cancelsTouchesInView = false
    recognizer.delegate = self
    addGestureRecognizer(recognizer)
    footerView.isHidden = true
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    isOpaque = false
    backgroundColor = .clear
    addSubview(headerView)
    addSubview(contentBlocksView)
    addSubview(footerView)
    headerView.onNativeRoute = onNativeRoute
    footerView.onRelayStatusChange = nil
    contentBlocksView.onContentSizeChange = { [weak self] in
      self?.invalidateIntrinsicContentSize()
      self?.setNeedsLayout()
      self?.setNeedsDisplay()
    }
    let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    recognizer.cancelsTouchesInView = false
    recognizer.delegate = self
    addGestureRecognizer(recognizer)
    footerView.isHidden = true
  }

  deinit {
    noteSubscription?.cancel()
    authorRelaysHook.cancel()
    missingTimer?.invalidate()
  }

  @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    let point = recognizer.location(in: self)
    if headerView.frame.contains(point) { return }
    let routeId = displayedEvent()?.id ?? noteEvent?.id ?? noteId
    guard !routeId.isEmpty else { return }
    onNativeRoute?("note:\(routeId)")
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    let point = touch.location(in: self)
    return !headerView.frame.contains(point)
  }

  @objc(updateNoteId:)
  func updateNoteId(_ value: String?) {
    let nextNoteId = value ?? ""
    if noteId == nextNoteId && noteBytes == nil { return }
    if noteId != nextNoteId {
      resetHeightReport()
      activeNoteSubscriptionKey = ""
      relayStatuses = [:]
      authorReadRelays = nil
      authorRelayTimedOut = false
      authorRelaysHook.cancel()
    }
    noteId = nextNoteId
    noteEvent = nil
    applyDisplayedEventToSubviews()
    refreshNoteSubscription()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateNoteBytes:)
  func updateNoteBytes(_ value: [NSNumber]?) {
    let nextBytes = value?.map { UInt8(truncating: $0) }
    if noteBytes == nextBytes { return }
    noteBytes = nextBytes
    emitNativeDebugLog(
      source: "NativeNoteContentView",
      event: "updateNoteBytes",
      details: "noteId=\(noteId), bytes=\(noteBytes?.count ?? 0)"
    )
    let nextEvent = parseParsedEvent(noteBytes)
    if noteEvent?.id != nextEvent?.id {
      resetHeightReport()
      activeNoteSubscriptionKey = ""
      relayStatuses = [:]
      authorReadRelays = nil
      authorRelayTimedOut = false
      authorRelaysHook.cancel()
    }
    noteEvent = nextEvent
    missingState = noteEvent == nil && !noteId.isEmpty ? .loading : .idle
    applyDisplayedEventToSubviews()
    refreshAuthorRelayResolution()
    refreshNoteSubscription()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateContextBytes:)
  func updateContextBytes(_ value: [NSNumber]?) {
    contextBytes = value?.map { UInt8(truncating: $0) }
    if noteEvent == nil {
      let nextEvent = parseParsedEvent(contextBytes)
      if noteEvent?.id != nextEvent?.id {
        resetHeightReport()
        relayStatuses = [:]
        authorReadRelays = nil
        authorRelayTimedOut = false
        authorRelaysHook.cancel()
      }
      noteEvent = nextEvent
      applyDisplayedEventToSubviews()
      refreshAuthorRelayResolution()
    }
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateRelays:)
  func updateRelays(_ value: [String]?) {
    let nextRelays = value ?? []
    if relays == nextRelays { return }
    relays = nextRelays
    activeNoteSubscriptionKey = ""
    applyResolvedRelaysToSubviews()
    refreshAuthorRelayResolution()
    refreshNoteSubscription()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateVisible:)
  func updateVisible(_ value: Bool) {
    if visible == value { return }
    visible = value
    activeNoteSubscriptionKey = ""
    headerView.updateVisible(value)
    contentBlocksView.updateVisible(value)
    footerView.updateVisible(value)
    refreshAuthorRelayResolution()
    refreshNoteSubscription()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateFooter:)
  func updateFooter(_ value: Bool) {
    if footer != value { resetHeightReport() }
    footer = value
    footerView.isHidden = !value
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateMain:)
  func updateMain(_ value: Bool) {
    if main != value { resetHeightReport() }
    main = value
    headerView.updateMain(main)
    contentBlocksView.updateMain(main)
    contentBlocksView.updateForceFullContent(forceFullContent || main)
    footerView.updateMain(main)
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateShowQuote:)
  func updateShowQuote(_ value: Bool) {
    if showQuote != value { resetHeightReport() }
    showQuote = value
    contentBlocksView.updateShowQuote(value)
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateShowMedia:)
  func updateShowMedia(_ value: Bool) {
    if showMedia != value { resetHeightReport() }
    showMedia = value
    contentBlocksView.updateShowMedia(value)
    invalidateIntrinsicContentSize()
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateForceFullContent:)
  func updateForceFullContent(_ value: Bool) {
    if forceFullContent != value { resetHeightReport() }
    forceFullContent = value
    contentBlocksView.updateForceFullContent(forceFullContent || main)
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
    if depth != value.intValue { resetHeightReport() }
    depth = value.intValue
    headerView.updateDepth(NSNumber(value: depth))
    contentBlocksView.updateDepth(NSNumber(value: depth))
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
    contentBlocksView.updatePrimaryTextColor(value)
    footerView.updatePrimaryColor(value)
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateSecondaryTextColor:)
  func updateSecondaryTextColor(_ value: String?) {
    secondaryTextColor = UIColor(noteCssColor: value) ?? secondaryTextColor
    headerView.updateSecondaryTextColor(value)
    contentBlocksView.updateSecondaryTextColor(value)
    footerView.updateTintColor(value)
    setNeedsDisplay()
  }

  @objc(updateBaseContentColor:)
  func updateBaseContentColor(_ value: String?) {
    baseContentColor = UIColor(noteCssColor: value) ?? baseContentColor
    contentBlocksView.updateBaseContentColor(value)
    setNeedsLayout()
    setNeedsDisplay()
  }

  @objc(updateCardBackgroundColor:)
  func updateCardBackgroundColor(_ value: String?) {
    cardBackgroundColor = UIColor(noteCssColor: value) ?? cardBackgroundColor
    contentBlocksView.updateCardBackgroundColor(value)
    setNeedsDisplay()
  }

  @objc(updateBorderColor:)
  func updateBorderColor(_ value: String?) {
    borderColor = UIColor(noteCssColor: value) ?? borderColor
    contentBlocksView.updateBorderColor(value)
    setNeedsDisplay()
  }

  @objc(updateAccentColor:)
  func updateAccentColor(_ value: String?) {
    accentColor = UIColor(noteCssColor: value) ?? accentColor
    headerView.updateAccentColor(value)
    contentBlocksView.updateAccentColor(value)
    footerView.updateAccentColor(value)
    setNeedsLayout()
    setNeedsDisplay()
  }

  override var intrinsicContentSize: CGSize {
    let headerHeight = headerHeightForCurrentLayout()
    let footerHeight: CGFloat = shouldShowFooter ? 28 : 0
    let availableWidth = max(0, UIScreen.main.bounds.width - contentHorizontalInsets().left - contentHorizontalInsets().right)
    let contentHeight = contentBlocksView.estimatedHeight(forWidth: availableWidth)
    let verticalPadding: CGFloat = depth > 0 ? 16 : 24
    let contentGap: CGFloat = main ? 4 : (depth > 0 ? 0 : -10)
    let footerGap: CGFloat = shouldShowFooter ? 8 : 0
    let baseHeight = verticalPadding + headerHeight + contentGap + contentHeight + footerGap + footerHeight
    let fallbackHeight: CGFloat = depth > 0 ? 72 : (main ? 124 : 96)
    return CGSize(width: UIView.noIntrinsicMetric, height: max(fallbackHeight, baseHeight))
  }

  override func layoutSubviews() {
    super.layoutSubviews()

    let inset: CGFloat = depth > 0 ? 8 : 0
    let cardRect = bounds.insetBy(dx: inset, dy: 1)
    let headerHeight = headerHeightForCurrentLayout()
    let footerHeight: CGFloat = shouldShowFooter ? 24 : 0
    let headerFrame = CGRect(x: cardRect.minX + 12, y: cardRect.minY + 8, width: max(0, cardRect.width - 24), height: headerHeight)
    headerView.frame = headerFrame

    let contentFrame = contentFrame(in: cardRect)
    let footerFrame = CGRect(
      x: cardRect.minX + 8,
      y: contentFrame.maxY + (shouldShowFooter ? 8 : 0),
      width: max(0, cardRect.width - 16),
      height: footerHeight
    )
    contentBlocksView.frame = contentFrame
    footerView.frame = footerFrame
    footerView.isHidden = !shouldShowFooter
    contentBlocksView.setNeedsLayout()
    reportHeightIfNeeded(requiredHeight: requiredHeight(
      cardRect: cardRect,
      contentFrame: contentFrame,
      footerFrame: footerFrame
    ))
  }

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }

    let inset: CGFloat = depth > 0 ? 8 : 0
    let cardRect = bounds.insetBy(dx: inset, dy: 1)
    let radius: CGFloat = 8
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

    if let event = displayedEvent() {
      drawEvent(event, cardRect: cardRect)
    } else {
      drawMissing(cardRect: cardRect)
    }
  }

  private func drawEvent(_ event: nostr_fb_ParsedEvent, cardRect: CGRect) {
    contentBlocksView.isHidden = false
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

  private var shouldShowFooter: Bool {
    footer && depth == 0
  }

  private func headerHeightForCurrentLayout() -> CGFloat {
    if depth > 0 { return 30 }
    return main ? 48 : 42
  }

  private func contentTopGap() -> CGFloat {
    if main { return 4 }
    if depth > 0 { return 0 }
    return -10
  }

  private func contentHorizontalInsets() -> UIEdgeInsets {
    if main || depth > 0 {
      return UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
    }
    return UIEdgeInsets(top: 0, left: 56, bottom: 0, right: 12)
  }

  private func contentFrame(in cardRect: CGRect) -> CGRect {
    let inset = contentHorizontalInsets()
    let x = cardRect.minX + inset.left
    let y = headerView.frame.maxY + contentTopGap()
    let width = max(0, cardRect.width - inset.left - inset.right)
    let height = contentBlocksView.estimatedHeight(forWidth: width)
    return CGRect(x: x, y: y, width: width, height: height)
  }

  private func requiredHeight(cardRect: CGRect, contentFrame: CGRect, footerFrame: CGRect) -> CGFloat {
    let bottom = shouldShowFooter ? footerFrame.maxY + 8 : contentFrame.maxY + 8
    return max(depth > 0 ? 72 : (main ? 124 : 96), ceil(bottom - bounds.minY + 1))
  }

  private func reportHeightIfNeeded(requiredHeight: CGFloat) {
    guard requiredHeight.isFinite, requiredHeight > 0 else { return }
    if abs(requiredHeight - lastReportedHeight) < 1 { return }
    lastReportedHeight = requiredHeight
    onHeightChange?(requiredHeight)
  }

  private func resetHeightReport() {
    lastReportedHeight = 0
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.invalidateIntrinsicContentSize()
      self.setNeedsLayout()
      self.layoutIfNeeded()
    }
  }

  private func resolvedRelays() -> [String] {
    if let authorReadRelays, !authorReadRelays.isEmpty {
      return authorReadRelays
    }
    if shouldWaitForAuthorRelays() {
      return []
    }
    return fallbackRelays()
  }

  private func fallbackRelays() -> [String] {
    relays.isEmpty ? NativeNoteConstants.defaultRelays : relays
  }

  private func applyResolvedRelaysToSubviews() {
    let relaysForSubcomponents = resolvedRelays()
    let waitingForRelays = shouldWaitForAuthorRelays()
    headerView.updateRelayResolutionPending(waitingForRelays)
    headerView.updateRelays(relaysForSubcomponents)
    headerView.updateRelayCount(NSNumber(value: relaysForSubcomponents.count))
    headerView.updateRelayStatuses(relayStatuses)
    contentBlocksView.updateRelayResolutionPending(waitingForRelays)
    contentBlocksView.updateRelays(relaysForSubcomponents)
    footerView.updateRelayResolutionPending(waitingForRelays)
    footerView.updateRelays(relaysForSubcomponents)
  }

  private func handleRelayStatusChange(relay: String, status: String) {
    guard visible, resolvedRelays().contains(relay) else { return }
    guard relayStatuses[relay] != status else { return }
    relayStatuses[relay] = status
    headerView.updateRelayStatuses(relayStatuses)
  }

  private func shouldWaitForAuthorRelays() -> Bool {
    guard visible, let pubkey = displayedEvent()?.pubkey, !pubkey.isEmpty else { return false }
    return (authorReadRelays == nil || authorReadRelays?.isEmpty == true) && !authorRelayTimedOut
  }

  private func refreshAuthorRelayResolution() {
    guard visible, let pubkey = displayedEvent()?.pubkey, !pubkey.isEmpty else {
      authorReadRelays = nil
      authorRelayTimedOut = false
      authorRelaysHook.cancel()
      applyResolvedRelaysToSubviews()
      return
    }

    authorRelaysHook.update(
      pubkey: pubkey,
      discoveryRelays: fallbackRelays(),
      visible: visible
    )
  }

  private func refreshNoteSubscription() {
    missingTimer?.invalidate()
    missingTimer = nil

    if visible && !noteId.isEmpty {
      applyResolvedRelaysToSubviews()
      headerView.updateVisible(visible)
      headerView.updateMain(main)
      headerView.updateDepth(NSNumber(value: depth))
      headerView.updateShowRelays(true)
      headerView.updateFallbackSubId(noteId)
      footerView.updateVisible(visible)
      footerView.updateMain(main)
      footerView.updateZoom(false)
      footerView.updateCurrentUserPubkey(nil)
    }

    guard visible && noteEvent == nil && !noteId.isEmpty else {
      if !activeNoteSubscriptionKey.isEmpty {
        noteSubscription?.cancel()
        noteSubscription = nil
        activeNoteSubscriptionKey = ""
      }
      if !visible || noteEvent != nil || noteId.isEmpty {
        emitNativeDebugLog(
          source: "NativeNoteContentView",
          event: "refreshNoteSubscription-skipped",
          details: "visible=\(visible), hasNote=\(noteEvent != nil), noteIdEmpty=\(noteId.isEmpty)"
        )
      }
      return
    }

    let lookupRelays = resolvedRelays()
    let relayKey = Self.relayKey(lookupRelays)
    let nextSubscriptionKey = "\(noteId)|\(relayKey)"
    if activeNoteSubscriptionKey == nextSubscriptionKey { return }
    noteSubscription?.cancel()
    noteSubscription = nil
    activeNoteSubscriptionKey = nextSubscriptionKey

    emitNativeDebugLog(
      source: "NativeNoteContentView",
      event: "refreshNoteSubscription",
      details: "noteId=\(noteId), relays=\(lookupRelays.count)"
    )
    missingState = .loading
    noteSubscription = useSubscriptionHandle(
      subscriptionId: "note_\(noteId)_\(relayKey)",
      requests: [
        RequestObject(ids: [noteId], limit: 5, relays: lookupRelays, cacheFirst: true)
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
      applyDisplayedEventToSubviews()
      refreshAuthorRelayResolution()
      invalidateIntrinsicContentSize()
      setNeedsLayout()
      setNeedsDisplay()
      break
    }
  }

  private func displayedEvent() -> nostr_fb_ParsedEvent? {
    guard let event = noteEvent else { return nil }
    guard event.kind == 6,
          let kind6 = event.parsed(type: nostr_fb_Kind6Parsed.self),
          let repostedEvent = kind6.repostedEvent else {
      return event
    }
    return repostedEvent
  }

  private func reposterPubkey() -> String? {
    guard let event = noteEvent,
          event.kind == 6,
          event.parsed(type: nostr_fb_Kind6Parsed.self)?.repostedEvent != nil else {
      return nil
    }
    return event.pubkey
  }

  private func applyDisplayedEventToSubviews() {
    let displayEvent = displayedEvent()
    let displayId = displayEvent?.id ?? noteId
    contentBlocksView.updateNoteId(displayId)
    contentBlocksView.updateParsedEvent(displayEvent)
    headerView.updateParsedEvent(displayEvent)
    headerView.updateReposterPubkey(reposterPubkey())
    footerView.updateParsedEvent(displayEvent)
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

  private static func relayKey(_ relays: [String]) -> String {
    relays.map { $0.replacingOccurrences(of: #"[^A-Za-z0-9]"#, with: "", options: .regularExpression) }
      .joined()
      .prefix(24)
      .description
  }
}
