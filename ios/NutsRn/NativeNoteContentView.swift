import Foundation
import FlatBuffers
import NipworkerSwift
import AVFoundation
import UIKit

private struct ContentRun {
  let text: String
  let color: UIColor
  let profilePubkey: String?

  init(text: String, color: UIColor, profilePubkey: String? = nil) {
    self.text = text
    self.color = color
    self.profilePubkey = profilePubkey
  }
}

private struct QuoteInfo {
  let id: String
  let relays: [String]
  let depth: Int
  let key: String
}

private struct LinkPreviewInfo {
  let url: String
  let text: String
  let key: String
}

private struct LinkPreviewMetadata {
  let title: String?
  let description: String?
  let image: String?
  let siteName: String?
}

private struct MediaInfo {
  let url: String
  let type: String
  let thumbnail: String?
  let dim: String?
  let key: String
}

private final class NativeMediaSessionRegistry {
  static let shared = NativeMediaSessionRegistry()

  private let imageCache = NSCache<NSString, UIImage>()
  private var imageTasksByURL: [String: URLSessionDataTask] = [:]
  private var imageCallbacksByURL: [String: [(UIImage) -> Void]] = [:]
  private var playersByKey: [String: AVPlayer] = [:]

  private init() {}

  func cacheKey(sessionId: String, itemKey: String) -> String {
    "\(sessionId)|\(itemKey)"
  }

  func cachedImage(for url: String) -> UIImage? {
    imageCache.object(forKey: url as NSString)
  }

  func setCachedImage(_ image: UIImage, for url: String) {
    imageCache.setObject(image, forKey: url as NSString)
  }

  func loadImage(for source: String, completion: @escaping (UIImage) -> Void) {
    if let image = cachedImage(for: source) {
      completion(image)
      return
    }
    guard let url = URL(string: source) else { return }

    if imageTasksByURL[source] != nil {
      imageCallbacksByURL[source, default: []].append(completion)
      return
    }

    imageCallbacksByURL[source] = [completion]
    let task = NativeMediaURLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      guard let self else { return }
      guard let data, let image = UIImage(data: data) else {
        DispatchQueue.main.async {
          self.imageTasksByURL[source] = nil
          self.imageCallbacksByURL[source] = nil
        }
        return
      }

      DispatchQueue.main.async {
        self.setCachedImage(image, for: source)
        let callbacks = self.imageCallbacksByURL[source] ?? []
        self.imageTasksByURL[source] = nil
        self.imageCallbacksByURL[source] = nil
        callbacks.forEach { $0(image) }
      }
    }
    imageTasksByURL[source] = task
    task.resume()
  }

  func player(sessionId: String, itemKey: String, url: URL) -> AVPlayer {
    let key = cacheKey(sessionId: sessionId, itemKey: itemKey)
    if let player = playersByKey[key] {
      return player
    }

    let player = AVPlayer(url: url)
    player.actionAtItemEnd = .none
    playersByKey[key] = player
    return player
  }
}

private func nativeMediaFormatDuration(_ seconds: Double) -> String {
  guard seconds.isFinite, seconds > 0 else { return "0:00" }
  let total = max(0, Int(ceil(seconds)))
  return "\(total / 60):\(String(format: "%02d", total % 60))"
}

private func nativeMediaIcon(_ name: String) -> UIImage? {
  UIImage(systemName: name)?.withRenderingMode(.alwaysTemplate)
}

private final class NativeVideoGridControlsView: UIView {
  var onCenterPlay: (() -> Void)?
  private weak var player: AVPlayer?
  private var timeObserver: Any?
  private let centerButton = UIButton(type: .system)
  private let muteButton = UIButton(type: .system)
  private let remainingLabel = UILabel()
  private var centerVisible = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear

    centerButton.tintColor = .white
    centerButton.backgroundColor = UIColor.black.withAlphaComponent(0.65)
    centerButton.layer.cornerRadius = 28
    centerButton.setImage(nativeMediaIcon("play.fill"), for: .normal)
    centerButton.addTarget(self, action: #selector(handleCenterPlay), for: .touchUpInside)
    addSubview(centerButton)

    muteButton.tintColor = .white
    muteButton.backgroundColor = UIColor.black.withAlphaComponent(0.7)
    muteButton.layer.cornerRadius = 16
    muteButton.addTarget(self, action: #selector(toggleMute), for: .touchUpInside)
    addSubview(muteButton)

    remainingLabel.backgroundColor = UIColor.black.withAlphaComponent(0.7)
    remainingLabel.layer.cornerRadius = 12
    remainingLabel.clipsToBounds = true
    remainingLabel.textColor = .white
    remainingLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .bold)
    remainingLabel.textAlignment = .center
    addSubview(remainingLabel)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  deinit {
    detachPlayer()
  }

  func configure(player: AVPlayer, centerVisible: Bool) {
    if self.player !== player {
      detachPlayer()
      self.player = player
      timeObserver = player.addPeriodicTimeObserver(
        forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
        queue: .main
      ) { [weak self] _ in
        self?.refresh()
      }
    }
    self.centerVisible = centerVisible
    refresh()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    centerButton.frame = CGRect(x: bounds.midX - 28, y: bounds.midY - 28, width: 56, height: 56)
    muteButton.frame = CGRect(x: bounds.maxX - 40, y: bounds.minY + 8, width: 32, height: 32)
    remainingLabel.frame = CGRect(x: bounds.maxX - 62, y: bounds.maxY - 32, width: 54, height: 24)
  }

  private func detachPlayer() {
    if let player, let timeObserver {
      player.removeTimeObserver(timeObserver)
    }
    timeObserver = nil
    player = nil
  }

  private func refresh() {
    guard let player else { return }
    let duration = player.currentItem?.duration.seconds ?? 0
    let current = player.currentTime().seconds
    remainingLabel.text = nativeMediaFormatDuration(max(0, duration - current))
    muteButton.setImage(nativeMediaIcon(player.isMuted || player.volume <= 0 ? "speaker.slash.fill" : "speaker.wave.2.fill"), for: .normal)
    centerButton.isHidden = !centerVisible
    muteButton.isHidden = centerVisible
    remainingLabel.isHidden = centerVisible
  }

  @objc private func handleCenterPlay() {
    onCenterPlay?()
  }

  @objc private func toggleMute() {
    guard let player else { return }
    let nextMuted = !(player.isMuted || player.volume <= 0)
    player.isMuted = nextMuted
    player.volume = nextMuted ? 0 : 1
    player.play()
    centerVisible = false
    refresh()
  }
}

private final class NativeVideoZoomControlsView: UIView {
  private weak var player: AVPlayer?
  private var timeObserver: Any?
  private var playbackRate: Float = 1
  private let trackControl = UIControl()
  private let trackRail = UIView()
  private let trackFill = UIView()
  private let rowView = UIView()
  private let playButton = UIButton(type: .system)
  private let remainingLabel = UILabel()
  private let speedButton = UIButton(type: .system)
  private let muteButton = UIButton(type: .system)
  private let replayButton = UIButton(type: .system)

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear

    trackRail.backgroundColor = UIColor.white.withAlphaComponent(0.4)
    trackRail.layer.cornerRadius = 1.5
    trackRail.clipsToBounds = true
    trackFill.backgroundColor = .white
    trackRail.addSubview(trackFill)
    trackControl.addSubview(trackRail)
    trackControl.addTarget(self, action: #selector(seekFromTrack(_:event:)), for: [.touchDown, .touchDragInside, .touchDragOutside, .touchUpInside, .touchUpOutside])
    addSubview(trackControl)

    addSubview(rowView)
    configureButton(playButton, imageName: "pause.fill", action: #selector(togglePlayback))
    configureButton(muteButton, imageName: "speaker.wave.2.fill", action: #selector(toggleMute))
    configureButton(replayButton, imageName: "arrow.counterclockwise", action: #selector(replay))

    remainingLabel.textColor = UIColor.white.withAlphaComponent(0.9)
    remainingLabel.font = .monospacedDigitSystemFont(ofSize: 16, weight: .medium)
    remainingLabel.textAlignment = .center
    rowView.addSubview(remainingLabel)

    speedButton.setTitleColor(.white, for: .normal)
    speedButton.titleLabel?.font = .systemFont(ofSize: 21, weight: .bold)
    speedButton.addTarget(self, action: #selector(toggleRate), for: .touchUpInside)
    rowView.addSubview(speedButton)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  deinit {
    detachPlayer()
  }

  func configure(player: AVPlayer?) {
    guard let player else {
      detachPlayer()
      isHidden = true
      return
    }
    isHidden = false
    if self.player !== player {
      detachPlayer()
      self.player = player
      timeObserver = player.addPeriodicTimeObserver(
        forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
        queue: .main
      ) { [weak self] _ in
        self?.refresh()
      }
    }
    refresh()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let horizontalInset: CGFloat = 16
    trackControl.frame = CGRect(x: horizontalInset, y: 0, width: max(0, bounds.width - horizontalInset * 2), height: 10)
    trackRail.frame = CGRect(x: 0, y: 3.5, width: trackControl.bounds.width, height: 3)

    rowView.frame = CGRect(x: 0, y: 16, width: bounds.width, height: 34)
    let buttonWidth: CGFloat = 44
    let timeWidth: CGFloat = 62
    let speedWidth: CGFloat = 52
    let gap = max(6, (bounds.width - 32 - buttonWidth * 3 - timeWidth - speedWidth) / 4)
    var x: CGFloat = 16
    playButton.frame = CGRect(x: x, y: 0, width: buttonWidth, height: 34)
    x += buttonWidth + gap
    remainingLabel.frame = CGRect(x: x, y: 0, width: timeWidth, height: 34)
    x += timeWidth + gap
    speedButton.frame = CGRect(x: x, y: 0, width: speedWidth, height: 34)
    x += speedWidth + gap
    muteButton.frame = CGRect(x: x, y: 0, width: buttonWidth, height: 34)
    x += buttonWidth + gap
    replayButton.frame = CGRect(x: x, y: 0, width: buttonWidth, height: 34)
    refresh()
  }

  private func configureButton(_ button: UIButton, imageName: String, action: Selector) {
    button.tintColor = .white
    button.setImage(nativeMediaIcon(imageName), for: .normal)
    button.addTarget(self, action: action, for: .touchUpInside)
    rowView.addSubview(button)
  }

  private func detachPlayer() {
    if let player, let timeObserver {
      player.removeTimeObserver(timeObserver)
    }
    timeObserver = nil
    player = nil
  }

  private func refresh() {
    guard let player else { return }
    let duration = player.currentItem?.duration.seconds ?? 0
    let current = player.currentTime().seconds
    let progress = duration > 0 ? min(1, max(0, current / duration)) : 0
    trackFill.frame = CGRect(x: 0, y: 0, width: trackRail.bounds.width * CGFloat(progress), height: trackRail.bounds.height)
    remainingLabel.text = "-\(nativeMediaFormatDuration(max(0, duration - current)))"
    playButton.setImage(nativeMediaIcon(player.timeControlStatus == .playing ? "pause.fill" : "play.fill"), for: .normal)
    muteButton.setImage(nativeMediaIcon(player.isMuted || player.volume <= 0 ? "speaker.slash.fill" : "speaker.wave.2.fill"), for: .normal)
    let rateText: String
    if playbackRate.truncatingRemainder(dividingBy: 1) == 0 {
      rateText = String(Int(playbackRate))
    } else {
      rateText = String(format: "%.1f", playbackRate)
    }
    speedButton.setTitle("\(rateText)x", for: .normal)
  }

  @objc private func seekFromTrack(_ control: UIControl, event: UIEvent) {
    guard let player,
          let touch = event.allTouches?.first else { return }
    let duration = player.currentItem?.duration.seconds ?? 0
    guard duration > 0 else { return }
    let x = touch.location(in: trackControl).x
    let progress = min(1, max(0, x / max(1, trackControl.bounds.width)))
    player.seek(to: CMTime(seconds: duration * Double(progress), preferredTimescale: 600))
    refresh()
  }

  @objc private func togglePlayback() {
    guard let player else { return }
    if player.timeControlStatus == .playing {
      player.pause()
    } else {
      let duration = player.currentItem?.duration.seconds ?? 0
      if duration > 0 && player.currentTime().seconds >= duration - 0.25 {
        player.seek(to: .zero)
      }
      player.play()
    }
    refresh()
  }

  @objc private func toggleRate() {
    guard let player else { return }
    playbackRate = playbackRate >= 2 ? 1 : playbackRate >= 1.5 ? 2 : 1.5
    player.rate = playbackRate
    if player.timeControlStatus != .playing {
      player.playImmediately(atRate: playbackRate)
    }
    refresh()
  }

  @objc private func toggleMute() {
    guard let player else { return }
    let nextMuted = !(player.isMuted || player.volume <= 0)
    player.isMuted = nextMuted
    player.volume = nextMuted ? 0 : 1
    refresh()
  }

  @objc private func replay() {
    guard let player else { return }
    player.seek(to: .zero)
    player.play()
    refresh()
  }
}

private enum ContentLine {
  case text([ContentRun])
  case quote(QuoteInfo)
  case linkPreview(LinkPreviewInfo)
  case mediaGrid([MediaInfo], String)
}

private enum NativeMediaURLSession {
  static let shared: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.urlCache = URLCache(
      memoryCapacity: 64 * 1024 * 1024,
      diskCapacity: 256 * 1024 * 1024,
      diskPath: "NativeMediaURLCache"
    )
    configuration.requestCachePolicy = .returnCacheDataElseLoad
    return URLSession(configuration: configuration)
  }()
}

private enum NativeContentBlockParser {
  static func build(
    from event: nostr_fb_ParsedEvent,
    baseContentColor: UIColor,
    accentColor: UIColor,
    showQuote: Bool,
    showMedia: Bool,
    forceFullContent: Bool,
    depth: Int,
    resolveRelays: () -> [String],
    resolveProfileName: (String, String) -> String
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

    let sourceContent = !forceFullContent && kind1.shortenedContent.count > 0
      ? kind1.shortenedContent
      : kind1.parsedContent

    for block in sourceContent {
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
        let profilePubkey = nostr.author?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let isProfileMention = !profilePubkey.isEmpty && isUserEntity(entity)
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
          let fallback = shortPubkey(profilePubkey)
          appendTextRun(ContentRun(
            text: resolveProfileName(profilePubkey, fallback),
            color: accentColor,
            profilePubkey: profilePubkey
          ))
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
          let url = (preview.url ?? blockText).trimmingCharacters(in: .whitespacesAndNewlines)
          if !url.isEmpty {
            if showMedia {
              flushText()
              lines.append(.linkPreview(LinkPreviewInfo(
                url: url,
                text: blockText.isEmpty ? url : blockText,
                key: "link-\(lines.count)-\(url)"
              )))
            } else {
              appendTextRun(ContentRun(text: blockText.isEmpty ? url : blockText, color: accentColor))
            }
          }
        }

      case .imagedata:
        if let image = block.data(type: nostr_fb_ImageData.self), !image.url.isEmpty {
          let imageUrl = image.url ?? ""
          if showMedia {
            flushText()
            lines.append(.mediaGrid([
              MediaInfo(url: imageUrl, type: "image", thumbnail: nil, dim: image.dim, key: "image-\(lines.count)-\(imageUrl)")
            ], "media-\(lines.count)-\(imageUrl)"))
          } else {
            appendTextRun(ContentRun(text: imageUrl, color: accentColor))
          }
        }

      case .videodata:
        if let video = block.data(type: nostr_fb_VideoData.self), !video.url.isEmpty {
          let videoUrl = video.url ?? ""
          if showMedia {
            flushText()
            lines.append(.mediaGrid([
              MediaInfo(url: videoUrl, type: "video", thumbnail: video.thumbnail, dim: video.dim, key: "video-\(lines.count)-\(videoUrl)")
            ], "media-\(lines.count)-\(videoUrl)"))
          } else {
            appendTextRun(ContentRun(text: videoUrl, color: accentColor))
          }
        }

      case .mediagroupdata:
        if let media = block.data(type: nostr_fb_MediaGroupData.self) {
          var mediaItems: [MediaInfo] = []
          for item in media.items {
            if let image = item.image?.url {
              if showMedia {
                mediaItems.append(MediaInfo(
                  url: image,
                  type: "image",
                  thumbnail: nil,
                  dim: item.image?.dim,
                  key: "image-\(lines.count)-\(mediaItems.count)-\(image)"
                ))
              } else {
                appendTextRun(ContentRun(text: image, color: accentColor))
              }
            } else if let video = item.video, !video.url.isEmpty {
              let videoUrl = video.url ?? ""
              if showMedia {
                mediaItems.append(MediaInfo(
                  url: videoUrl,
                  type: "video",
                  thumbnail: video.thumbnail,
                  dim: video.dim,
                  key: "video-\(lines.count)-\(mediaItems.count)-\(videoUrl)"
                ))
              } else {
                appendTextRun(ContentRun(text: videoUrl, color: accentColor))
              }
            }
          }
          if showMedia && !mediaItems.isEmpty {
            flushText()
            lines.append(.mediaGrid(mediaItems, "media-\(lines.count)-\(mediaItems.first?.url ?? "group")"))
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

  private static func shortPubkey(_ pubkey: String) -> String {
    if pubkey.isEmpty { return "unknown" }
    return "\(pubkey.prefix(12))..."
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

private final class NativeMediaNoteOverlayView: UIView {
  var onNativeRoute: ((String) -> Void)? {
    didSet {
      headerView.onNativeRoute = onNativeRoute
    }
  }
  var onNativeAction: ((String) -> Void)? {
    didSet {
      footerView.onNativeAction = onNativeAction
    }
  }

  private let headerView = NativeNoteHeaderContentView()
  private let textLabel = UILabel()
  private let footerView = NativeNoteFooterContentView()
  private var noteBytes: [UInt8]?
  private var previewText = ""
  private var primaryTextColor = UIColor.white
  private var secondaryTextColor = UIColor.white.withAlphaComponent(0.76)

  override init(frame: CGRect) {
    super.init(frame: frame)
    configure()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    configure()
  }

  @objc(updateNoteBytes:)
  func updateNoteBytes(_ value: [NSNumber]?) {
    let nextBytes = value?.map { UInt8(truncating: $0) }
    if noteBytes == nextBytes { return }
    noteBytes = nextBytes
    headerView.updateNoteBytes(value)
    footerView.updateNoteBytes(value)
    previewText = buildPreviewText(from: parseParsedEvent(nextBytes))
    textLabel.text = previewText
    setNeedsLayout()
  }

  @objc(updateRelays:)
  func updateRelays(_ value: [String]?) {
    headerView.updateRelays(value)
    footerView.updateRelays(value)
  }

  @objc(updateCurrentUserPubkey:)
  func updateCurrentUserPubkey(_ value: String?) {
    footerView.updateCurrentUserPubkey(value)
  }

  @objc(updateOptimisticReactionNonce:)
  func updateOptimisticReactionNonce(_ value: Int32) {
    footerView.updateOptimisticReactionNonce(value)
  }

  @objc(updatePrimaryTextColor:)
  func updatePrimaryTextColor(_ value: String?) {
    primaryTextColor = UIColor(noteCssColor: value) ?? primaryTextColor
    headerView.updatePrimaryTextColor(value)
    textLabel.textColor = primaryTextColor
  }

  @objc(updateSecondaryTextColor:)
  func updateSecondaryTextColor(_ value: String?) {
    secondaryTextColor = UIColor(noteCssColor: value) ?? secondaryTextColor
    headerView.updateSecondaryTextColor(value)
  }

  @objc(updateAvatarBackgroundColor:)
  func updateAvatarBackgroundColor(_ value: String?) {
    headerView.updateAvatarBackgroundColor(value)
  }

  @objc(updateTintColor:)
  func updateTintColor(_ value: String?) {
    footerView.updateTintColor(value)
  }

  @objc(updatePrimaryColor:)
  func updatePrimaryColor(_ value: String?) {
    footerView.updatePrimaryColor(value)
  }

  @objc(updateAccentColor:)
  func updateAccentColor(_ value: String?) {
    headerView.updateAccentColor(value)
    footerView.updateAccentColor(value)
  }

  @objc(updateZoomBackgroundColor:)
  func updateZoomBackgroundColor(_ value: String?) {
    footerView.updateZoomBackgroundColor(value)
  }

  func preferredHeight(compact: Bool) -> CGFloat {
    let textHeight: CGFloat = previewText.isEmpty ? 0 : (compact ? 44 : 48)
    return 42 + textHeight + 52
  }

  func setActive(_ active: Bool) {
    headerView.updateVisible(active)
    footerView.updateVisible(active)
  }

  private func configure() {
    isOpaque = false
    backgroundColor = .clear
    isUserInteractionEnabled = true

    headerView.onNativeRoute = onNativeRoute
    headerView.updateVisible(false)
    headerView.updateDepth(NSNumber(value: 0))
    headerView.updateMain(true)
    headerView.updateShowRelays(false)
    headerView.updatePrimaryTextColor("#ffffff")
    headerView.updateSecondaryTextColor("rgba(255, 255, 255, 0.760)")
    headerView.updateAvatarBackgroundColor("rgba(15, 23, 42, 0.620)")
    addSubview(headerView)

    textLabel.isOpaque = false
    textLabel.backgroundColor = .clear
    textLabel.textColor = primaryTextColor
    textLabel.font = .systemFont(ofSize: 15, weight: .regular)
    textLabel.numberOfLines = 2
    textLabel.lineBreakMode = .byTruncatingTail
    textLabel.shadowColor = UIColor.black.withAlphaComponent(0.75)
    textLabel.shadowOffset = CGSize(width: 0, height: 1)
    addSubview(textLabel)

    footerView.onNativeAction = onNativeAction
    footerView.updateVisible(false)
    footerView.updateMain(true)
    footerView.updateZoom(true)
    addSubview(footerView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let horizontalInset: CGFloat = 16
    let width = max(0, bounds.width - horizontalInset * 2)
    var y: CGFloat = 0
    headerView.frame = CGRect(x: horizontalInset, y: y, width: width, height: 42)
    y += 42
    if previewText.isEmpty {
      textLabel.isHidden = true
    } else {
      textLabel.isHidden = false
      let textHeight = min(48, textLabel.sizeThatFits(CGSize(width: width, height: CGFloat.greatestFiniteMagnitude)).height)
      textLabel.frame = CGRect(x: horizontalInset, y: y, width: width, height: max(20, textHeight))
      y += textLabel.frame.height + 2
    }
    footerView.frame = CGRect(x: 0, y: y, width: bounds.width, height: 48)
  }

  private func parseParsedEvent(_ bytes: [UInt8]?) -> nostr_fb_ParsedEvent? {
    guard let bytes, bytes.count >= 4 else { return nil }
    let byteBuffer = ByteBuffer(bytes: bytes)
    let rootOffset = byteBuffer.read(def: Int32.self, position: 0)
    let worker = nostr_fb_WorkerMessage(byteBuffer, o: rootOffset)
    guard worker.contentType == .parsedevent else { return nil }
    return worker.content(type: nostr_fb_ParsedEvent.self)
  }

  private func buildPreviewText(from event: nostr_fb_ParsedEvent?) -> String {
    guard let event,
          event.kind == 1,
          let kind1 = event.parsed(type: nostr_fb_Kind1Parsed.self) else {
      return ""
    }
    let parts = kind1.parsedContent.compactMap { block -> String? in
      switch block.dataType {
      case .imagedata, .videodata, .mediagroupdata:
        return nil
      default:
        let text = normalizeOverlayText(block.text).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
      }
    }
    return parts.joined(separator: " ")
      .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func normalizeOverlayText(_ value: String) -> String {
    if value.isEmpty { return value }
    let payload = "\"\(value)\""
    guard let data = payload.data(using: .utf8),
          let decoded = try? JSONDecoder().decode(String.self, from: data) else {
      return value.replacingOccurrences(of: "\\\\", with: "\\")
    }
    return decoded
  }
}

private final class NativeMediaOverlayContainerView: UIView {
  var onLayout: (() -> Void)?

  override func layoutSubviews() {
    super.layoutSubviews()
    onLayout?()
  }
}

@objc(NativeMediaViewerContentView)
class NativeMediaViewerContentView: UIView, UIScrollViewDelegate, UIGestureRecognizerDelegate {
  @objc var onNativeRoute: ((String) -> Void)?
  @objc var onNativeAction: ((String) -> Void)?

  private var items: [MediaInfo] = []
  private let defaultSessionId = UUID().uuidString
  private var sessionId = ""
  private let noteOverlayView = NativeMediaNoteOverlayView()
  private var noteBytes: [UInt8]?
  private var imageViewsByKey: [String: UIImageView] = [:]
  private var loadingImageKeys = Set<String>()
  private var videoPlayersByKey: [String: AVPlayer] = [:]
  private var videoLayersByKey: [String: AVPlayerLayer] = [:]
  private var gridControlsByKey: [String: NativeVideoGridControlsView] = [:]
  private var overlayItem: MediaInfo?
  private var overlayView: UIView?
  private weak var overlayDimmingView: UIView?
  private weak var overlayScrollView: UIScrollView?
  private weak var overlayZoomControlsView: NativeVideoZoomControlsView?
  private var overlayChromeVisible = true
  private var overlayIsDismissing = false
  private var overlayOrientationObserver: NSObjectProtocol?
  private var overlayToggleRecognizers: [UITapGestureRecognizer] = []
  private var overlayZoomRecognizers: [UIGestureRecognizer] = []
  private var overlaySuspendedTapRecognizers: [UIGestureRecognizer] = []
  private weak var overlayMovedMediaView: UIImageView?
  private var overlayMovedItemKey: String?
  private var overlayActiveIndex = 0
  private var overlayPageViewsByKey: [String: UIImageView] = [:]
  private var overlayTargetFramesByKey: [String: CGRect] = [:]
  private var overlayVideoLayersByKey: [String: AVPlayerLayer] = [:]
  private weak var overlayDismissPan: UIPanGestureRecognizer?
  private var overlayZoomScalesByKey: [String: CGFloat] = [:]
  private var overlayPinchStartScale: CGFloat = 1
  private weak var overlayOriginalSuperview: UIView?
  private var overlayOriginalSubviewIndex = 0
  private var overlayOriginalFrame = CGRect.zero
  private var overlayOriginalContentMode: UIView.ContentMode = .scaleAspectFill
  private var overlayOriginalCornerRadius: CGFloat = 0
  private var overlayOriginalVideoGravity: AVLayerVideoGravity?

  override init(frame: CGRect) {
    super.init(frame: frame)
    clipsToBounds = true
    layer.cornerRadius = 8
    backgroundColor = .clear
    noteOverlayView.onNativeRoute = { [weak self] route in
      self?.onNativeRoute?(route)
    }
    noteOverlayView.onNativeAction = { [weak self] action in
      self?.onNativeAction?(action)
    }
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    clipsToBounds = true
    layer.cornerRadius = 8
    backgroundColor = .clear
    noteOverlayView.onNativeRoute = { [weak self] route in
      self?.onNativeRoute?(route)
    }
    noteOverlayView.onNativeAction = { [weak self] action in
      self?.onNativeAction?(action)
    }
  }

  deinit {
    overlayView?.removeFromSuperview()
    stopAllVideos()
  }

  @objc(updateSessionId:)
  func updateSessionId(_ value: String?) {
    let nextSessionId = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if sessionId == nextSessionId { return }
    sessionId = nextSessionId
    for key in Array(videoPlayersByKey.keys) {
      removeVideo(forKey: key)
    }
    setNeedsLayout()
  }

  @objc(updateUrls:types:thumbnails:dims:)
  func updateUrls(_ urls: [String]?, types: [String]?, thumbnails: [String]?, dims: [String]?) {
    updateUrls(urls, types: types, thumbnails: thumbnails, dims: dims, itemKeys: nil)
  }

  @objc(updateUrls:types:thumbnails:dims:itemKeys:)
  func updateUrls(_ urls: [String]?, types: [String]?, thumbnails: [String]?, dims: [String]?, itemKeys: [String]?) {
    let urls = urls ?? []
    let nextItems = urls.enumerated().map { index, url in
      let type = types?[safe: index]?.isEmpty == false ? types?[safe: index] ?? "image" : "image"
      let thumbnail = thumbnails?[safe: index]?.trimmingCharacters(in: .whitespacesAndNewlines)
      let dim = dims?[safe: index]?.trimmingCharacters(in: .whitespacesAndNewlines)
      let itemKey = itemKeys?[safe: index]?.trimmingCharacters(in: .whitespacesAndNewlines)
      return MediaInfo(
        url: url,
        type: type,
        thumbnail: thumbnail?.isEmpty == false ? thumbnail : nil,
        dim: dim?.isEmpty == false ? dim : nil,
        key: itemKey?.isEmpty == false ? itemKey! : "\(index)-\(url)"
      )
    }
    update(items: nextItems)
  }

  @objc(updateNoteBytes:)
  func updateNoteBytes(_ value: [NSNumber]?) {
    let nextBytes = value?.map { UInt8(truncating: $0) }
    if noteBytes == nextBytes { return }
    noteBytes = nextBytes
    noteOverlayView.updateNoteBytes(value)
    if overlayView != nil {
      noteOverlayView.setActive(nextBytes != nil)
    }
    layoutOverlayChrome()
  }

  @objc(updateRelays:)
  func updateRelays(_ value: [String]?) {
    noteOverlayView.updateRelays(value)
  }

  @objc(updateCurrentUserPubkey:)
  func updateCurrentUserPubkey(_ value: String?) {
    noteOverlayView.updateCurrentUserPubkey(value)
  }

  @objc(updateOptimisticReactionNonce:)
  func updateOptimisticReactionNonce(_ value: Int32) {
    noteOverlayView.updateOptimisticReactionNonce(value)
  }

  @objc(updatePrimaryTextColor:)
  func updatePrimaryTextColor(_ value: String?) {
    noteOverlayView.updatePrimaryTextColor(value)
  }

  @objc(updateSecondaryTextColor:)
  func updateSecondaryTextColor(_ value: String?) {
    noteOverlayView.updateSecondaryTextColor(value)
  }

  @objc(updateAvatarBackgroundColor:)
  func updateAvatarBackgroundColor(_ value: String?) {
    noteOverlayView.updateAvatarBackgroundColor(value)
  }

  @objc(updateTintColor:)
  func updateTintColor(_ value: String?) {
    noteOverlayView.updateTintColor(value)
  }

  @objc(updatePrimaryColor:)
  func updatePrimaryColor(_ value: String?) {
    noteOverlayView.updatePrimaryColor(value)
  }

  @objc(updateAccentColor:)
  func updateAccentColor(_ value: String?) {
    noteOverlayView.updateAccentColor(value)
  }

  @objc(updateZoomBackgroundColor:)
  func updateZoomBackgroundColor(_ value: String?) {
    noteOverlayView.updateZoomBackgroundColor(value)
  }

  fileprivate func update(items: [MediaInfo]) {
    let nextKeys = Set(items.map(\.key))
    for (key, imageView) in imageViewsByKey where !nextKeys.contains(key) {
      imageView.removeFromSuperview()
      imageViewsByKey[key] = nil
      loadingImageKeys.remove(key)
      removeVideo(forKey: key)
    }

    self.items = items
    setNeedsLayout()
    setNeedsDisplay()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let displayItems = Array(items.prefix(NativeMediaLayout.maxDisplayLinks))
    for (index, item) in displayItems.enumerated() {
      let imageView = imageViewsByKey[item.key] ?? {
        let view = UIImageView()
        view.backgroundColor = item.type == "video" ? UIColor.black : UIColor.clear
        view.clipsToBounds = true
        view.contentMode = .scaleAspectFill
        view.isUserInteractionEnabled = true
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleImageTap(_:)))
        tap.delegate = self
        view.addGestureRecognizer(tap)
        addSubview(view)
        imageViewsByKey[item.key] = view
        loadImage(for: item, into: view)
        return view
      }()
      if imageView.superview !== self {
        continue
      }
      imageView.accessibilityIdentifier = "\(index)"
      imageView.contentMode = .scaleAspectFill
      imageView.frame = NativeMediaLayout.tileFrame(total: displayItems.count, index: index, width: bounds.width, height: bounds.height)
      if item.type == "video" {
        configureVideo(for: item, in: imageView, autoplay: displayItems.count == 1 || index == 0)
      } else {
        removeVideo(forKey: item.key)
      }
      videoLayersByKey[item.key]?.frame = imageView.bounds
      gridControlsByKey[item.key]?.frame = imageView.bounds
    }
  }

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    let displayItems = Array(items.prefix(NativeMediaLayout.maxDisplayLinks))
    for (index, item) in displayItems.enumerated() where item.type == "video" {
      let frame = NativeMediaLayout.tileFrame(total: displayItems.count, index: index, width: bounds.width, height: bounds.height)
      context.setFillColor(UIColor.black.withAlphaComponent(0.24).cgColor)
      context.fill(frame)
      drawPlayGlyph(in: frame)
    }
    if items.count > displayItems.count, let lastFrame = displayItems.indices.last.map({ NativeMediaLayout.tileFrame(total: displayItems.count, index: $0, width: bounds.width, height: bounds.height) }) {
      context.setFillColor(UIColor.black.withAlphaComponent(0.58).cgColor)
      context.fill(lastFrame)
      let remaining = "+\(items.count - displayItems.count)"
      let attrs: [NSAttributedString.Key: Any] = [
        .font: UIFont.systemFont(ofSize: 24, weight: .bold),
        .foregroundColor: UIColor.white,
      ]
      let size = remaining.size(withAttributes: attrs)
      remaining.draw(
        at: CGPoint(x: lastFrame.midX - size.width / 2, y: lastFrame.midY - size.height / 2),
        withAttributes: attrs
      )
    }
  }

  @objc private func handleImageTap(_ recognizer: UITapGestureRecognizer) {
    guard let view = recognizer.view,
          let rawIndex = view.accessibilityIdentifier,
          let index = Int(rawIndex),
          index < items.count else { return }
    presentOverlay(startIndex: index, from: view)
  }

  private func presentOverlay(startIndex: Int, from sourceView: UIView) {
    let overlayItems = items
    guard startIndex < overlayItems.count else { return }
    let item = overlayItems[startIndex]
    guard overlayView == nil,
          let mediaView = sourceView as? UIImageView,
          let originalSuperview = mediaView.superview,
          let window = sourceView.window else { return }
    overlayItem = item
    overlayMovedMediaView = mediaView
    overlayMovedItemKey = item.key
    overlayActiveIndex = startIndex
    overlayOriginalSuperview = originalSuperview
    overlayOriginalSubviewIndex = originalSuperview.subviews.firstIndex(of: mediaView) ?? originalSuperview.subviews.count
    overlayOriginalFrame = mediaView.frame
    overlayOriginalContentMode = mediaView.contentMode
    overlayOriginalCornerRadius = mediaView.layer.cornerRadius
    overlayOriginalVideoGravity = videoLayersByKey[item.key]?.videoGravity

    let sourceFrame = mediaView.convert(mediaView.bounds, to: window)
    let targetFrame = overlayTargetFrame(for: item, sourceFrame: sourceFrame, in: window.bounds)
    OrientationGate().setImageZoomActive(true)

    let overlay = NativeMediaOverlayContainerView(frame: window.bounds)
    overlay.backgroundColor = .clear
    overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    overlay.onLayout = { [weak self] in
      self?.relayoutOverlayForCurrentBounds()
    }

    let dimmingView = UIView(frame: overlay.bounds)
    dimmingView.backgroundColor = UIColor.black.withAlphaComponent(0.96)
    dimmingView.alpha = 0
    dimmingView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    overlay.addSubview(dimmingView)

    let scrollView = UIScrollView(frame: overlay.bounds)
    scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    scrollView.isPagingEnabled = true
    scrollView.bounces = false
    scrollView.alwaysBounceHorizontal = false
    scrollView.alwaysBounceVertical = false
    scrollView.showsHorizontalScrollIndicator = false
    scrollView.showsVerticalScrollIndicator = false
    scrollView.delegate = self
    scrollView.contentSize = CGSize(width: overlay.bounds.width * CGFloat(overlayItems.count), height: overlay.bounds.height)
    scrollView.contentOffset = CGPoint(x: overlay.bounds.width * CGFloat(startIndex), y: 0)
    overlay.addSubview(scrollView)

    let dismissPan = UIPanGestureRecognizer(target: self, action: #selector(handleOverlayDismissPan(_:)))
    dismissPan.delegate = self
    scrollView.addGestureRecognizer(dismissPan)

    let zoomControls = NativeVideoZoomControlsView()
    zoomControls.autoresizingMask = [.flexibleWidth, .flexibleTopMargin]
    zoomControls.frame = CGRect(x: 0, y: overlay.bounds.maxY - 86, width: overlay.bounds.width, height: 58)

    noteOverlayView.removeFromSuperview()
    noteOverlayView.autoresizingMask = [.flexibleWidth, .flexibleTopMargin]
    noteOverlayView.setActive(noteBytes != nil)
    overlay.addSubview(noteOverlayView)
    overlay.addSubview(zoomControls)

    window.addSubview(overlay)
    mediaView.removeFromSuperview()
    mediaView.frame = sourceFrame
    mediaView.contentMode = .scaleAspectFit
    mediaView.layer.cornerRadius = 8
    mediaView.clipsToBounds = true
    mediaView.autoresizingMask = []
    overlayView = overlay
    overlayDimmingView = dimmingView
    overlayScrollView = scrollView
    overlayZoomControlsView = zoomControls
    overlayChromeVisible = true
    overlayDismissPan = dismissPan
    overlayOrientationObserver = NotificationCenter.default.addObserver(
      forName: UIDevice.orientationDidChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.scheduleOverlayRelayout()
    }

    let pageWidth = overlay.bounds.width
    for (index, pageItem) in overlayItems.enumerated() {
      let pageFrame = overlayTargetFrame(
        for: pageItem,
        sourceFrame: sourceFrame,
        in: overlay.bounds
      ).offsetBy(dx: pageWidth * CGFloat(index), dy: 0)
      overlayTargetFramesByKey[pageItem.key] = pageFrame

      if index == startIndex {
        mediaView.frame = sourceFrame.offsetBy(dx: pageWidth * CGFloat(index), dy: 0)
        suspendExistingTapRecognizers(on: mediaView)
        addOverlayGestures(to: mediaView)
        scrollView.addSubview(mediaView)
        overlayPageViewsByKey[pageItem.key] = mediaView
      } else {
        let pageView = createOverlayPageView(for: pageItem, frame: pageFrame)
        scrollView.addSubview(pageView)
        overlayPageViewsByKey[pageItem.key] = pageView
      }
    }

    if item.type == "video" {
      videoLayersByKey[item.key]?.videoGravity = .resizeAspect
      videoLayersByKey[item.key]?.frame = mediaView.bounds
      gridControlsByKey[item.key]?.isHidden = true
    }
    layoutOverlayChrome(activeIndex: startIndex)
    updateOverlayPlayback(activeIndex: startIndex)

    UIView.animate(
      withDuration: 0.24,
      delay: 0,
      usingSpringWithDamping: 0.88,
      initialSpringVelocity: 0.18,
      options: [.curveEaseOut, .allowUserInteraction]
    ) {
      dimmingView.alpha = 1
      mediaView.frame = targetFrame.offsetBy(dx: pageWidth * CGFloat(startIndex), dy: 0)
      mediaView.layer.cornerRadius = 0
      self.videoLayersByKey[item.key]?.frame = mediaView.bounds
    }
  }

  @objc private func toggleOverlayChrome() {
    guard overlayView != nil, !overlayIsDismissing else { return }
    overlayChromeVisible.toggle()
    applyOverlayChromeVisibility(animated: true)
  }

  @objc private func handleOverlayDoubleTap(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended,
          let mediaView = recognizer.view,
          let item = overlayItem(for: mediaView),
          !overlayIsDismissing else { return }
    let currentScale = overlayZoomScalesByKey[item.key] ?? 1
    if currentScale > 1.02 {
      setOverlayZoomScale(1, for: item, mediaView: mediaView, animated: true)
    } else {
      setOverlayZoomScale(2.5, for: item, mediaView: mediaView, animated: true)
      if overlayChromeVisible {
        overlayChromeVisible = false
        applyOverlayChromeVisibility(animated: true)
      }
    }
  }

  @objc private func handleOverlayPinch(_ recognizer: UIPinchGestureRecognizer) {
    guard let mediaView = recognizer.view,
          let item = overlayItem(for: mediaView),
          !overlayIsDismissing else { return }

    switch recognizer.state {
    case .began:
      overlayPinchStartScale = overlayZoomScalesByKey[item.key] ?? 1
      if overlayChromeVisible {
        overlayChromeVisible = false
        applyOverlayChromeVisibility(animated: true)
      }
    case .changed:
      let nextScale = min(max(overlayPinchStartScale * recognizer.scale, 1), 4)
      setOverlayZoomScale(nextScale, for: item, mediaView: mediaView, animated: false)
    case .ended, .cancelled, .failed:
      let scale = overlayZoomScalesByKey[item.key] ?? 1
      setOverlayZoomScale(scale < 1.02 ? 1 : scale, for: item, mediaView: mediaView, animated: scale < 1.02)
      overlayPinchStartScale = 1
    default:
      break
    }
  }

  private func overlayItem(for mediaView: UIView) -> MediaInfo? {
    overlayPageViewsByKey.first(where: { $0.value === mediaView }).flatMap { key, _ in
      items.first(where: { $0.key == key })
    }
  }

  private func setOverlayZoomScale(_ rawScale: CGFloat, for item: MediaInfo, mediaView: UIView, animated: Bool) {
    let scale = min(max(rawScale, 1), 4)
    let apply = {
      mediaView.transform = scale <= 1.02 ? .identity : CGAffineTransform(scaleX: scale, y: scale)
      if let targetFrame = self.overlayTargetFramesByKey[item.key] {
        mediaView.center = CGPoint(x: targetFrame.midX, y: targetFrame.midY)
      }
      self.layerForOverlayMedia(item.key)?.frame = mediaView.bounds
    }

    overlayZoomScalesByKey[item.key] = scale <= 1.02 ? 1 : scale
    updateOverlayScrollInteraction()

    if animated {
      UIView.animate(
        withDuration: 0.18,
        delay: 0,
        options: [.curveEaseOut, .allowUserInteraction]
      ) {
        apply()
      }
    } else {
      apply()
    }
  }

  private func updateOverlayScrollInteraction() {
    let zoomed = overlayZoomScalesByKey.values.contains { $0 > 1.02 }
    overlayScrollView?.isScrollEnabled = !zoomed
    overlayDismissPan?.isEnabled = !zoomed
  }

  private func resetOverlayZoom(animated: Bool) {
    let updates = {
      for view in self.overlayPageViewsByKey.values {
        view.transform = .identity
      }
      for (key, view) in self.overlayPageViewsByKey {
        self.layerForOverlayMedia(key)?.frame = view.bounds
      }
    }
    overlayZoomScalesByKey = [:]
    updateOverlayScrollInteraction()
    if animated {
      UIView.animate(withDuration: 0.16, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
        updates()
      }
    } else {
      updates()
    }
  }

  private func scheduleOverlayRelayout() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in
      self?.relayoutOverlayForCurrentBounds()
    }
  }

  private func relayoutOverlayForCurrentBounds() {
    guard let overlay = overlayView,
          let scrollView = overlayScrollView,
          !items.isEmpty,
          !overlayIsDismissing else { return }
    let activeIndex = min(max(currentOverlayIndex(), 0), items.count - 1)
    overlayActiveIndex = activeIndex
    resetOverlayZoom(animated: false)
    let pageWidth = max(1, overlay.bounds.width)
    scrollView.frame = overlay.bounds
    scrollView.contentSize = CGSize(width: pageWidth * CGFloat(items.count), height: overlay.bounds.height)
    scrollView.contentOffset = CGPoint(x: pageWidth * CGFloat(activeIndex), y: 0)
    overlayDimmingView?.frame = overlay.bounds

    for (index, item) in items.enumerated() {
      guard let pageView = overlayPageViewsByKey[item.key] else { continue }
      let sourceFrame = pageView.convert(pageView.bounds, to: overlay)
      let pageFrame = overlayTargetFrame(
        for: item,
        sourceFrame: sourceFrame.isEmpty ? overlay.bounds : sourceFrame,
        in: overlay.bounds
      ).offsetBy(dx: pageWidth * CGFloat(index), dy: 0)
      overlayTargetFramesByKey[item.key] = pageFrame
      pageView.frame = pageFrame
      layerForOverlayMedia(item.key)?.frame = pageView.bounds
    }
    layoutOverlayChrome(activeIndex: activeIndex)
  }

  @objc private func dismissOverlay() {
    guard let overlay = overlayView,
          let scrollView = overlayScrollView,
          !overlayIsDismissing else { return }
    resetOverlayZoom(animated: false)
    overlayIsDismissing = true
    overlayDismissPan?.isEnabled = false
    overlayToggleRecognizers.forEach { $0.isEnabled = false }
    overlayZoomControlsView?.isUserInteractionEnabled = false
    noteOverlayView.isUserInteractionEnabled = false

    let activeIndex = currentOverlayIndex()
    let overlayItems = items
    guard activeIndex < overlayItems.count else {
      cleanupOverlay()
      return
    }
    let activeItem = overlayItems[activeIndex]
    guard let mediaView = overlayPageViewsByKey[activeItem.key] else {
      cleanupOverlay()
      return
    }

    let returnFrame: CGRect
    if activeItem.key == overlayMovedItemKey, let originalSuperview = overlayOriginalSuperview, let window = overlay.window {
      returnFrame = originalSuperview.convert(overlayOriginalFrame, to: window)
    } else if let tileView = imageViewsByKey[activeItem.key], tileView.superview === self, let window = overlay.window {
      returnFrame = tileView.convert(tileView.bounds, to: window)
    } else if let fallbackTileView = fallbackTileViewForDismiss(activeIndex: activeIndex), let window = overlay.window {
      returnFrame = fallbackTileView.convert(fallbackTileView.bounds, to: window)
    } else {
      returnFrame = mediaView.convert(mediaView.bounds, to: overlay)
    }

    restorePlaybackAfterDismiss(activeItem: activeItem)

    if mediaView.superview === scrollView {
      mediaView.frame = scrollView.convert(mediaView.frame, to: overlay)
      mediaView.removeFromSuperview()
      overlay.addSubview(mediaView)
    }

    UIView.animate(
      withDuration: 0.18,
      delay: 0,
      options: [.curveEaseInOut, .allowUserInteraction]
    ) {
      self.overlayDimmingView?.alpha = 0
      mediaView.frame = returnFrame
      mediaView.layer.cornerRadius = self.overlayOriginalCornerRadius
      self.layerForOverlayMedia(activeItem.key)?.frame = mediaView.bounds
    } completion: { _ in
      self.cleanupOverlay()
    }
  }

  private func createOverlayPageView(for item: MediaInfo, frame: CGRect) -> UIImageView {
    let imageView = UIImageView(frame: frame)
    imageView.backgroundColor = item.type == "video" ? .black : .clear
    imageView.clipsToBounds = true
    imageView.contentMode = .scaleAspectFit
    imageView.isUserInteractionEnabled = true
    addOverlayGestures(to: imageView)

    let source = item.type == "video" ? (item.thumbnail ?? item.url) : item.url
    if item.type != "video" || item.thumbnail != nil {
      if let image = NativeMediaSessionRegistry.shared.cachedImage(for: source) {
        imageView.image = image
      } else {
        NativeMediaSessionRegistry.shared.loadImage(for: source) { [weak self, weak imageView] image in
          guard self?.overlayView != nil else { return }
          imageView?.image = image
        }
      }
    }

    if item.type == "video", let url = URL(string: item.url) {
      let player = videoPlayersByKey[item.key] ?? NativeMediaSessionRegistry.shared.player(
        sessionId: effectiveSessionId(),
        itemKey: item.key,
        url: url
      )
      videoPlayersByKey[item.key] = player
      let layer = AVPlayerLayer(player: player)
      layer.videoGravity = .resizeAspect
      layer.frame = imageView.bounds
      imageView.layer.addSublayer(layer)
      overlayVideoLayersByKey[item.key] = layer
    }

    return imageView
  }

  private func addOverlayGestures(to view: UIView) {
    let singleTap = makeOverlayToggleRecognizer()
    let doubleTap = UITapGestureRecognizer(target: self, action: #selector(handleOverlayDoubleTap(_:)))
    doubleTap.numberOfTapsRequired = 2
    doubleTap.delegate = self
    doubleTap.cancelsTouchesInView = false
    singleTap.require(toFail: doubleTap)
    view.addGestureRecognizer(doubleTap)
    view.addGestureRecognizer(singleTap)
    overlayZoomRecognizers.append(doubleTap)

    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handleOverlayPinch(_:)))
    pinch.delegate = self
    pinch.cancelsTouchesInView = false
    view.addGestureRecognizer(pinch)
    overlayZoomRecognizers.append(pinch)
  }

  private func makeOverlayToggleRecognizer() -> UITapGestureRecognizer {
    let recognizer = UITapGestureRecognizer(target: self, action: #selector(toggleOverlayChrome))
    recognizer.delegate = self
    recognizer.cancelsTouchesInView = false
    overlayToggleRecognizers.append(recognizer)
    return recognizer
  }

  private func suspendExistingTapRecognizers(on view: UIView) {
    for recognizer in view.gestureRecognizers ?? [] {
      guard recognizer is UITapGestureRecognizer,
            !overlayToggleRecognizers.contains(where: { $0 === recognizer }),
            recognizer.isEnabled else { continue }
      recognizer.isEnabled = false
      overlaySuspendedTapRecognizers.append(recognizer)
    }
  }

  private func currentOverlayIndex() -> Int {
    guard let scrollView = overlayScrollView, scrollView.bounds.width > 0 else {
      return overlayActiveIndex
    }
    let rawIndex = Int(round(scrollView.contentOffset.x / scrollView.bounds.width))
    let maxIndex = max(0, items.count - 1)
    return min(max(rawIndex, 0), maxIndex)
  }

  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
    let index = currentOverlayIndex()
    overlayActiveIndex = index
    resetOverlayZoom(animated: false)
    updateOverlayPlayback(activeIndex: index)
  }

  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    if decelerate { return }
    let index = currentOverlayIndex()
    overlayActiveIndex = index
    resetOverlayZoom(animated: false)
    updateOverlayPlayback(activeIndex: index)
  }

  func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
    let index = currentOverlayIndex()
    overlayActiveIndex = index
    resetOverlayZoom(animated: false)
    updateOverlayPlayback(activeIndex: index)
  }

  private func updateOverlayPlayback(activeIndex: Int) {
    let overlayItems = items
    var activePlayer: AVPlayer?
    for (index, item) in overlayItems.enumerated() where item.type == "video" {
      guard let player = videoPlayersByKey[item.key] else { continue }
      if index == activeIndex {
        player.isMuted = false
        player.volume = 1
        player.play()
        activePlayer = player
      } else {
        player.isMuted = true
        player.volume = 0
        player.pause()
      }
    }
    overlayZoomControlsView?.configure(player: activePlayer)
    layoutOverlayChrome(activeIndex: activeIndex)
  }

  private func layoutOverlayChrome(activeIndex: Int? = nil) {
    guard let overlay = overlayView else { return }
    let index = activeIndex ?? currentOverlayIndex()
    let activeItem = index < items.count ? items[index] : nil
    let compact = overlay.bounds.width > overlay.bounds.height
    let safeBottom = overlay.window?.safeAreaInsets.bottom ?? 0
    let controlsHeight: CGFloat = 58
    let controlsBottomInset: CGFloat = max(18, safeBottom + 12)
    let controlsY = overlay.bounds.maxY - controlsBottomInset - controlsHeight
    let controlsWidth = overlayChromeWidth(in: overlay.bounds, compact: compact)
    overlayZoomControlsView?.frame = CGRect(
      x: (overlay.bounds.width - controlsWidth) / 2,
      y: controlsY,
      width: controlsWidth,
      height: controlsHeight
    )

    let noteWidth = overlayChromeWidth(in: overlay.bounds, compact: compact)
    let overlayHeight = noteOverlayView.preferredHeight(compact: compact)
    let bottomInset = activeItem?.type == "video"
      ? controlsBottomInset + controlsHeight + 10
      : max(18, safeBottom + 16)
    noteOverlayView.isHidden = noteBytes == nil
    noteOverlayView.frame = CGRect(
      x: (overlay.bounds.width - noteWidth) / 2,
      y: overlay.bounds.maxY - bottomInset - overlayHeight,
      width: noteWidth,
      height: overlayHeight
    )
    noteOverlayView.setNeedsLayout()
    applyOverlayChromeVisibility(animated: false)
  }

  private func overlayChromeWidth(in bounds: CGRect, compact: Bool) -> CGFloat {
    let horizontalInset: CGFloat = compact ? 28 : 0
    let maxWidth: CGFloat = compact ? 720 : bounds.width
    return min(maxWidth, max(0, bounds.width - horizontalInset * 2))
  }

  private func applyOverlayChromeVisibility(animated: Bool) {
    guard overlayView != nil else { return }
    let noteVisible = overlayChromeVisible && noteBytes != nil
    let alpha: CGFloat = overlayChromeVisible ? 1 : 0

    if noteVisible {
      noteOverlayView.isHidden = false
    }
    noteOverlayView.isUserInteractionEnabled = noteVisible
    overlayZoomControlsView?.isUserInteractionEnabled = overlayChromeVisible

    let updates = {
      self.noteOverlayView.alpha = noteVisible ? 1 : 0
      self.overlayZoomControlsView?.alpha = alpha
    }

    if animated {
      UIView.animate(
        withDuration: 0.16,
        delay: 0,
        options: [.curveEaseInOut, .allowUserInteraction]
      ) {
        updates()
      } completion: { _ in
        self.noteOverlayView.isHidden = !noteVisible
      }
    } else {
      updates()
      noteOverlayView.isHidden = !noteVisible
    }
  }

  private func restorePlaybackAfterDismiss(activeItem: MediaInfo) {
    for item in items where item.type == "video" {
      guard let player = videoPlayersByKey[item.key] else { continue }
      player.isMuted = true
      player.volume = 0
      if item.key == activeItem.key,
         let index = items.firstIndex(where: { $0.key == item.key }),
         (items.count <= 1 || index == 0) {
        player.play()
      } else {
        player.pause()
      }
    }
  }

  private func layerForOverlayMedia(_ key: String) -> AVPlayerLayer? {
    overlayVideoLayersByKey[key] ?? videoLayersByKey[key]
  }

  private func fallbackTileViewForDismiss(activeIndex: Int) -> UIView? {
    guard activeIndex >= NativeMediaLayout.maxDisplayLinks else { return nil }
    let fallbackIndex = min(NativeMediaLayout.maxDisplayLinks - 1, items.count - 1)
    guard fallbackIndex >= 0 else { return nil }
    let fallbackItem = items[fallbackIndex]
    let fallbackView = imageViewsByKey[fallbackItem.key]
    return fallbackView?.superview === self ? fallbackView : nil
  }

  @objc private func handleOverlayDismissPan(_ recognizer: UIPanGestureRecognizer) {
    guard let scrollView = overlayScrollView, !overlayIsDismissing else { return }
    let activeIndex = currentOverlayIndex()
    let overlayItems = items
    guard activeIndex < overlayItems.count,
          let mediaView = overlayPageViewsByKey[overlayItems[activeIndex].key],
          let targetFrame = overlayTargetFramesByKey[overlayItems[activeIndex].key] else { return }

    let translation = recognizer.translation(in: scrollView)
    switch recognizer.state {
    case .changed:
      mediaView.frame = targetFrame.offsetBy(dx: 0, dy: translation.y)
      overlayDimmingView?.alpha = max(0.18, 1 - abs(translation.y) / max(280, scrollView.bounds.height * 0.45))
      layerForOverlayMedia(overlayItems[activeIndex].key)?.frame = mediaView.bounds
    case .ended, .cancelled, .failed:
      let velocity = recognizer.velocity(in: scrollView)
      let shouldDismiss = abs(translation.y) > 110 || abs(velocity.y) > 850
      if shouldDismiss {
        dismissOverlay()
      } else {
        UIView.animate(withDuration: 0.16, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
          mediaView.frame = targetFrame
          self.overlayDimmingView?.alpha = 1
          self.layerForOverlayMedia(overlayItems[activeIndex].key)?.frame = mediaView.bounds
        }
      }
    default:
      break
    }
  }

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    if let overlayDismissPan = overlayDismissPan, gestureRecognizer === overlayDismissPan {
      if overlayZoomScalesByKey.values.contains(where: { $0 > 1.02 }) {
        return false
      }
      let velocity = (gestureRecognizer as? UIPanGestureRecognizer)?.velocity(in: overlayScrollView) ?? .zero
      return abs(velocity.y) > abs(velocity.x)
    }
    return true
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    if overlayToggleRecognizers.contains(where: { $0 === gestureRecognizer || $0 === otherGestureRecognizer }) {
      return true
    }
    if overlayZoomRecognizers.contains(where: { $0 === gestureRecognizer || $0 === otherGestureRecognizer }) {
      return true
    }
    guard let overlayDismissPan = overlayDismissPan else { return false }
    return gestureRecognizer === overlayDismissPan || otherGestureRecognizer === overlayDismissPan
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    var view = touch.view
    while let current = view {
      if current is NativeMediaNoteOverlayView {
        return false
      }
      if current is UIControl {
        return false
      }
      view = current.superview
    }
    return true
  }

  private func cleanupOverlay() {
    for recognizer in overlayToggleRecognizers {
      recognizer.view?.removeGestureRecognizer(recognizer)
    }
    for recognizer in overlayZoomRecognizers {
      recognizer.view?.removeGestureRecognizer(recognizer)
    }
    for recognizer in overlaySuspendedTapRecognizers {
      recognizer.isEnabled = true
    }
    let movedMediaView = overlayMovedMediaView
    movedMediaView?.removeFromSuperview()
    if let movedMediaView,
       let originalSuperview = overlayOriginalSuperview {
      let index = min(overlayOriginalSubviewIndex, originalSuperview.subviews.count)
      originalSuperview.insertSubview(movedMediaView, at: index)
      movedMediaView.frame = overlayOriginalFrame
      movedMediaView.contentMode = overlayOriginalContentMode
      movedMediaView.layer.cornerRadius = overlayOriginalCornerRadius
    }
    if let movedItemKey = overlayMovedItemKey {
      if let originalGravity = overlayOriginalVideoGravity {
        videoLayersByKey[movedItemKey]?.videoGravity = originalGravity
      }
      if let movedMediaView {
        videoLayersByKey[movedItemKey]?.frame = movedMediaView.bounds
      }
      gridControlsByKey[movedItemKey]?.isHidden = false
    }

    for (key, view) in overlayPageViewsByKey where key != overlayMovedItemKey {
      view.removeFromSuperview()
    }
    for layer in overlayVideoLayersByKey.values {
      layer.removeFromSuperlayer()
    }
    noteOverlayView.setActive(false)
    if let overlayOrientationObserver {
      NotificationCenter.default.removeObserver(overlayOrientationObserver)
    }
    OrientationGate().setImageZoomActive(false)
    overlayView?.removeFromSuperview()
    overlayItem = nil
    overlayView = nil
    overlayDimmingView = nil
    overlayScrollView = nil
    overlayZoomControlsView = nil
    overlayChromeVisible = true
    overlayIsDismissing = false
    overlayOrientationObserver = nil
    overlayToggleRecognizers = []
    overlayZoomRecognizers = []
    overlaySuspendedTapRecognizers = []
    overlayMovedMediaView = nil
    overlayMovedItemKey = nil
    overlayPageViewsByKey = [:]
    overlayTargetFramesByKey = [:]
    overlayVideoLayersByKey = [:]
    overlayDismissPan = nil
    overlayZoomScalesByKey = [:]
    overlayPinchStartScale = 1
    overlayOriginalSuperview = nil
    overlayOriginalVideoGravity = nil
    setNeedsLayout()
  }

  private func overlayTargetFrame(for item: MediaInfo, sourceFrame: CGRect, in bounds: CGRect) -> CGRect {
    let horizontalInset: CGFloat = 0
    let verticalInset: CGFloat = 0
    let available = bounds.insetBy(dx: horizontalInset, dy: verticalInset)
    let aspect = aspectRatio(for: item) ?? max(sourceFrame.width, 1) / max(sourceFrame.height, 1)
    if aspect <= 0 { return available }

    var width = available.width
    var height = width / aspect
    if height > available.height {
      height = available.height
      width = height * aspect
    }
    return CGRect(
      x: available.midX - width / 2,
      y: available.midY - height / 2,
      width: width,
      height: height
    )
  }

  private func aspectRatio(for item: MediaInfo) -> CGFloat? {
    if let dim = item.dim?.lowercased() {
      let parts = dim.split(separator: "x").compactMap { Double($0) }
      if parts.count == 2, parts[0] > 0, parts[1] > 0 {
        return CGFloat(parts[0] / parts[1])
      }
    }
    if item.type == "video",
       let size = videoPlayersByKey[item.key]?.currentItem?.presentationSize,
       size.width > 0,
       size.height > 0 {
      return size.width / size.height
    }
    return nil
  }

  private func loadImage(for item: MediaInfo, into imageView: UIImageView) {
    let source = item.type == "video" ? (item.thumbnail ?? item.url) : item.url
    guard item.type != "video" || item.thumbnail != nil else { return }
    guard !loadingImageKeys.contains(item.key) else { return }
    if let image = NativeMediaSessionRegistry.shared.cachedImage(for: source) {
      imageView.backgroundColor = .clear
      imageView.image = image
      return
    }
    loadingImageKeys.insert(item.key)
    NativeMediaSessionRegistry.shared.loadImage(for: source) { [weak self, weak imageView] image in
      self?.loadingImageKeys.remove(item.key)
      imageView?.backgroundColor = .clear
      imageView?.image = image
    }
  }

  private func configureVideo(for item: MediaInfo, in imageView: UIImageView, autoplay: Bool) {
    guard let url = URL(string: item.url) else { return }
    let player = videoPlayersByKey[item.key] ?? {
      let nextPlayer = NativeMediaSessionRegistry.shared.player(
        sessionId: effectiveSessionId(),
        itemKey: item.key,
        url: url
      )
      nextPlayer.isMuted = true
      nextPlayer.volume = 0
      nextPlayer.actionAtItemEnd = .none
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(handleVideoDidEnd(_:)),
        name: .AVPlayerItemDidPlayToEndTime,
        object: nextPlayer.currentItem
      )
      videoPlayersByKey[item.key] = nextPlayer
      return nextPlayer
    }()
    let layer = videoLayersByKey[item.key] ?? {
      let nextLayer = AVPlayerLayer(player: player)
      nextLayer.videoGravity = .resizeAspectFill
      imageView.layer.addSublayer(nextLayer)
      videoLayersByKey[item.key] = nextLayer
      return nextLayer
    }()
    layer.videoGravity = .resizeAspectFill
    layer.frame = imageView.bounds
    if autoplay {
      player.play()
    } else {
      player.pause()
    }
    configureGridControls(for: item, in: imageView, player: player, autoplay: autoplay)
  }

  private func configureGridControls(for item: MediaInfo, in imageView: UIImageView, player: AVPlayer, autoplay: Bool) {
    let controls = gridControlsByKey[item.key] ?? {
      let view = NativeVideoGridControlsView()
      view.onCenterPlay = { [weak self, weak imageView] in
        guard let self, let imageView else { return }
        if let index = self.items.firstIndex(where: { $0.key == item.key }) {
          self.presentOverlay(startIndex: index, from: imageView)
        }
      }
      imageView.addSubview(view)
      gridControlsByKey[item.key] = view
      return view
    }()
    if controls.superview !== imageView {
      controls.removeFromSuperview()
      imageView.addSubview(controls)
    }
    controls.frame = imageView.bounds
    controls.isHidden = overlayMovedItemKey == item.key
    controls.configure(player: player, centerVisible: !autoplay)
  }

  private func effectiveSessionId() -> String {
    sessionId.isEmpty ? defaultSessionId : sessionId
  }

  @objc private func handleVideoDidEnd(_ notification: Notification) {
    guard let endedItem = notification.object as? AVPlayerItem else { return }
    for (key, player) in videoPlayersByKey where player.currentItem === endedItem {
      if overlayView != nil,
         currentOverlayIndex() < items.count,
         items[currentOverlayIndex()].key == key {
        player.pause()
        return
      }
      player.seek(to: .zero)
      player.play()
      return
    }
  }

  private func removeVideo(forKey key: String) {
    if let player = videoPlayersByKey[key] {
      NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: player.currentItem)
      player.pause()
      videoPlayersByKey[key] = nil
    }
    gridControlsByKey[key]?.removeFromSuperview()
    gridControlsByKey[key] = nil
    videoLayersByKey[key]?.removeFromSuperlayer()
    videoLayersByKey[key] = nil
  }

  private func stopAllVideos() {
    for key in Array(videoPlayersByKey.keys) {
      removeVideo(forKey: key)
    }
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
}

@objc(NativeLinkPreviewContentView)
class NativeLinkPreviewContentView: UIView {
  @objc var onNativeRoute: ((String) -> Void)?
  @objc var onHeightChange: ((CGFloat) -> Void)?

  private static let metadataCache = NSCache<NSString, NativeLinkPreviewMetadataBox>()
  private static let imageCache = NSCache<NSString, UIImage>()
  private static let youtubeThumbnails = ["maxresdefault.jpg", "hqdefault.jpg", "mqdefault.jpg", "default.jpg"]

  private let imageView = UIImageView()
  private let playOverlay = UIView()
  private let playLayer = CAShapeLayer()
  private let textStack = UIView()
  private let siteLabel = UILabel()
  private let externalLabel = UILabel()
  private let titleLabel = UILabel()
  private let descriptionLabel = UILabel()

  private var preview: LinkPreviewInfo?
  private var metadata: LinkPreviewMetadata?
  private var metadataTask: URLSessionDataTask?
  private var imageTask: URLSessionDataTask?
  private var thumbnailFallback = 0
  private var lastReportedHeight: CGFloat = 0

  private var baseContentColor = UIColor.label
  private var secondaryTextColor = UIColor.secondaryLabel
  private var cardBackgroundColor = UIColor.secondarySystemBackground
  private var borderColor = UIColor.separator

  override init(frame: CGRect) {
    super.init(frame: frame)
    configure()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    configure()
  }

  deinit {
    metadataTask?.cancel()
    imageTask?.cancel()
  }

  @objc(updateUrl:text:)
  func updateUrl(_ url: String?, text: String?) {
    let nextUrl = url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !nextUrl.isEmpty else { return }
    update(preview: LinkPreviewInfo(
      url: nextUrl,
      text: text ?? nextUrl,
      key: "native-link-\(nextUrl)"
    ))
  }

  @objc(updateBaseContentColor:)
  func updateBaseContentColor(_ value: String?) {
    baseContentColor = UIColor(noteCssColor: value) ?? baseContentColor
    updateColors(
      baseContent: baseContentColor,
      secondaryText: secondaryTextColor,
      background: cardBackgroundColor,
      border: borderColor
    )
  }

  @objc(updateSecondaryTextColor:)
  func updateSecondaryTextColor(_ value: String?) {
    secondaryTextColor = UIColor(noteCssColor: value) ?? secondaryTextColor
    updateColors(
      baseContent: baseContentColor,
      secondaryText: secondaryTextColor,
      background: cardBackgroundColor,
      border: borderColor
    )
  }

  @objc(updateCardBackgroundColor:)
  func updateCardBackgroundColor(_ value: String?) {
    cardBackgroundColor = UIColor(noteCssColor: value) ?? cardBackgroundColor
    updateColors(
      baseContent: baseContentColor,
      secondaryText: secondaryTextColor,
      background: cardBackgroundColor,
      border: borderColor
    )
  }

  @objc(updateBorderColor:)
  func updateBorderColor(_ value: String?) {
    borderColor = UIColor(noteCssColor: value) ?? borderColor
    updateColors(
      baseContent: baseContentColor,
      secondaryText: secondaryTextColor,
      background: cardBackgroundColor,
      border: borderColor
    )
  }

  fileprivate func update(preview: LinkPreviewInfo) {
    guard self.preview?.url != preview.url || self.preview?.text != preview.text else { return }
    self.preview = preview
    metadata = Self.metadataCache.object(forKey: preview.url as NSString)?.metadata
    thumbnailFallback = 0
    imageView.image = nil
    metadataTask?.cancel()
    imageTask?.cancel()
    refreshText()
    loadMetadataIfNeeded()
    loadThumbnailIfNeeded()
    setNeedsLayout()
  }

  func updateColors(baseContent: UIColor, secondaryText: UIColor, background: UIColor, border: UIColor) {
    baseContentColor = baseContent
    secondaryTextColor = secondaryText
    cardBackgroundColor = background
    borderColor = border
    backgroundColor = cardBackgroundColor
    layer.borderColor = borderColor.cgColor
    siteLabel.textColor = secondaryTextColor
    externalLabel.textColor = secondaryTextColor
    titleLabel.textColor = baseContentColor
    descriptionLabel.textColor = secondaryTextColor
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = bounds.width
    let thumbnailHeight = hasThumbnail ? floor(width * 9 / 16) : 0
    imageView.isHidden = !hasThumbnail
    playOverlay.isHidden = !isYouTube
    imageView.frame = CGRect(x: 0, y: 0, width: width, height: thumbnailHeight)
    playOverlay.frame = imageView.frame
    layoutPlayLayer()

    let textTop = thumbnailHeight
    let horizontalPadding: CGFloat = 12
    let verticalPadding: CGFloat = 10
    let labelHeight: CGFloat = 16
    let titleHeight: CGFloat = descriptionText.isEmpty ? 40 : 38
    let descriptionHeight: CGFloat = descriptionText.isEmpty ? 0 : 34
    siteLabel.frame = CGRect(x: horizontalPadding, y: textTop + verticalPadding, width: max(0, width - 48), height: labelHeight)
    externalLabel.frame = CGRect(x: width - 28, y: textTop + verticalPadding, width: 16, height: labelHeight)
    titleLabel.frame = CGRect(x: horizontalPadding, y: siteLabel.frame.maxY + 4, width: max(0, width - horizontalPadding * 2), height: titleHeight)
    descriptionLabel.frame = CGRect(x: horizontalPadding, y: titleLabel.frame.maxY + 2, width: max(0, width - horizontalPadding * 2), height: descriptionHeight)
    reportHeightIfNeeded()
  }

  static func height(width: CGFloat, hasThumbnail: Bool, hasDescription: Bool) -> CGFloat {
    let thumbnailHeight = hasThumbnail ? floor(width * 9 / 16) : 0
    let textHeight: CGFloat = hasDescription ? 110 : 86
    return thumbnailHeight + textHeight
  }

  var preferredHeight: CGFloat {
    Self.height(width: bounds.width, hasThumbnail: hasThumbnail, hasDescription: !descriptionText.isEmpty)
  }

  private func configure() {
    clipsToBounds = true
    layer.cornerRadius = 8
    layer.borderWidth = 1
    backgroundColor = cardBackgroundColor
    isUserInteractionEnabled = true
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap)))

    imageView.clipsToBounds = true
    imageView.contentMode = .scaleAspectFill
    imageView.backgroundColor = borderColor
    addSubview(imageView)

    playOverlay.isUserInteractionEnabled = false
    playLayer.fillColor = UIColor.white.cgColor
    playOverlay.layer.addSublayer(playLayer)
    addSubview(playOverlay)

    siteLabel.font = UIFont.systemFont(ofSize: 12, weight: .medium)
    siteLabel.lineBreakMode = .byTruncatingTail
    siteLabel.textColor = secondaryTextColor
    addSubview(siteLabel)

    externalLabel.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
    externalLabel.text = ">"
    externalLabel.textAlignment = .right
    externalLabel.textColor = secondaryTextColor
    addSubview(externalLabel)

    titleLabel.font = UIFont.systemFont(ofSize: 15, weight: .medium)
    titleLabel.numberOfLines = 2
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.textColor = baseContentColor
    addSubview(titleLabel)

    descriptionLabel.font = UIFont.systemFont(ofSize: 12, weight: .regular)
    descriptionLabel.numberOfLines = 2
    descriptionLabel.lineBreakMode = .byTruncatingTail
    descriptionLabel.textColor = secondaryTextColor
    addSubview(descriptionLabel)
  }

  @objc private func handleTap() {
    guard let preview else { return }
    onNativeRoute?("url:\(normalizedUrl(preview.url))")
  }

  private func refreshText() {
    guard let preview else { return }
    let parts = urlParts(preview.url)
    let displayText = !preview.text.isEmpty && preview.text != preview.url ? preview.text : parts.path
    siteLabel.text = (metadata?.siteName ?? (isYouTube ? "YouTube" : parts.label)).uppercased()
    titleLabel.text = metadata?.title ?? displayText.replacingOccurrences(of: #"^https?://(www\.)?"#, with: "", options: .regularExpression)
    descriptionLabel.text = descriptionText
    descriptionLabel.isHidden = descriptionText.isEmpty
  }

  private var descriptionText: String {
    guard let preview else { return "" }
    if let description = metadata?.description?.trimmingCharacters(in: .whitespacesAndNewlines), !description.isEmpty {
      return description
    }
    return isYouTube ? "" : truncateMiddle(normalizedUrl(preview.url), limit: 72)
  }

  private var hasThumbnail: Bool {
    thumbnailUrl != nil
  }

  private var isYouTube: Bool {
    guard let preview else { return false }
    return youtubeVideoId(preview.url) != nil
  }

  private var thumbnailUrl: String? {
    guard let preview else { return nil }
    if let videoId = youtubeVideoId(preview.url), thumbnailFallback < Self.youtubeThumbnails.count {
      return "https://i.ytimg.com/vi/\(videoId)/\(Self.youtubeThumbnails[thumbnailFallback])"
    }
    return metadata?.image
  }

  private func loadMetadataIfNeeded() {
    guard let preview, metadata == nil, !isYouTube else { return }
    guard let url = URL(string: normalizedUrl(preview.url)) else { return }
    metadataTask = NativeMediaURLSession.shared.dataTask(with: url) { [weak self] data, response, _ in
      guard let self,
            let data,
            let response = response as? HTTPURLResponse,
            (200..<300).contains(response.statusCode),
            let html = String(data: data.prefix(256 * 1024), encoding: .utf8) else { return }
      let parsed = Self.parseMetadata(html: html, pageUrl: url.absoluteString)
      DispatchQueue.main.async {
        guard self.preview?.url == preview.url else { return }
        self.metadata = parsed
        if let parsed {
          Self.metadataCache.setObject(NativeLinkPreviewMetadataBox(parsed), forKey: preview.url as NSString)
        }
        self.refreshText()
        self.loadThumbnailIfNeeded()
        self.setNeedsLayout()
        self.reportHeightIfNeeded()
      }
    }
    metadataTask?.resume()
  }

  private func loadThumbnailIfNeeded() {
    guard let source = thumbnailUrl, let url = URL(string: source) else {
      imageView.image = nil
      return
    }
    if let cached = Self.imageCache.object(forKey: source as NSString) {
      imageView.image = cached
      return
    }
    imageTask?.cancel()
    imageTask = NativeMediaURLSession.shared.dataTask(with: url) { [weak self] data, response, _ in
      guard let self,
            let data,
            let response = response as? HTTPURLResponse,
            (200..<300).contains(response.statusCode),
            let image = UIImage(data: data) else {
        DispatchQueue.main.async {
          guard let self, self.isYouTube else { return }
          self.thumbnailFallback += 1
          self.loadThumbnailIfNeeded()
        }
        return
      }
      Self.imageCache.setObject(image, forKey: source as NSString)
      DispatchQueue.main.async {
        guard self.thumbnailUrl == source else { return }
        self.imageView.image = image
        self.setNeedsLayout()
        self.reportHeightIfNeeded()
      }
    }
    imageTask?.resume()
  }

  private func reportHeightIfNeeded() {
    let height = preferredHeight
    guard height.isFinite, height > 0, abs(height - lastReportedHeight) >= 1 else { return }
    lastReportedHeight = height
    onHeightChange?(height)
  }

  private func layoutPlayLayer() {
    let circle = CAShapeLayer()
    let diameter: CGFloat = 48
    let circleRect = CGRect(x: playOverlay.bounds.midX - diameter / 2, y: playOverlay.bounds.midY - diameter / 2, width: diameter, height: diameter)
    circle.path = UIBezierPath(ovalIn: circleRect).cgPath
    circle.fillColor = UIColor.black.withAlphaComponent(0.70).cgColor
    playOverlay.layer.sublayers?.removeAll()
    playOverlay.layer.addSublayer(circle)

    let path = UIBezierPath()
    path.move(to: CGPoint(x: circleRect.midX - 6, y: circleRect.midY - 11))
    path.addLine(to: CGPoint(x: circleRect.midX - 6, y: circleRect.midY + 11))
    path.addLine(to: CGPoint(x: circleRect.midX + 12, y: circleRect.midY))
    path.close()
    playLayer.path = path.cgPath
    playOverlay.layer.addSublayer(playLayer)
  }

  private static func parseMetadata(html: String, pageUrl: String) -> LinkPreviewMetadata? {
    let title = firstMatch(in: html, pattern: #"<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["'][^>]*>|<title[^>]*>([^<]+)</title>"#)
    let description = firstMatch(in: html, pattern: #"<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["'][^>]*>|<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>"#)
    let image = firstMatch(in: html, pattern: #"<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["'][^>]*>"#).flatMap { absolutizeUrl($0, pageUrl: pageUrl) }
    let siteName = firstMatch(in: html, pattern: #"<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["'][^>]*>"#)
    if title == nil, description == nil, image == nil, siteName == nil { return nil }
    return LinkPreviewMetadata(title: title, description: description, image: image, siteName: siteName)
  }

  private static func firstMatch(in value: String, pattern: String) -> String? {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]),
          let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) else { return nil }
    for index in 1..<match.numberOfRanges {
      let range = match.range(at: index)
      guard range.location != NSNotFound, let swiftRange = Range(range, in: value) else { continue }
      let text = String(value[swiftRange]).htmlDecoded.trimmingCharacters(in: .whitespacesAndNewlines)
      if !text.isEmpty { return text }
    }
    return nil
  }
}

private final class NativeLinkPreviewMetadataBox: NSObject {
  let metadata: LinkPreviewMetadata
  init(_ metadata: LinkPreviewMetadata) {
    self.metadata = metadata
  }
}

private func normalizedUrl(_ value: String) -> String {
  value.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) == nil ? "https://\(value)" : value
}

private func urlParts(_ value: String) -> (label: String, path: String) {
  guard let url = URL(string: normalizedUrl(value)), let host = url.host else {
    return (value, value)
  }
  let label = host.replacingOccurrences(of: "www.", with: "")
  let path = "\(label)\(url.path == "/" ? "" : url.path)"
  return (label, path)
}

private func youtubeVideoId(_ value: String) -> String? {
  guard let url = URL(string: normalizedUrl(value)),
        let rawHost = url.host else { return nil }
  let host = rawHost.replacingOccurrences(of: "www.", with: "").lowercased()
  if host == "youtu.be" {
    return url.path.split(separator: "/").first.map(String.init)
  }
  if host == "youtube.com" || host == "m.youtube.com" || host == "music.youtube.com" {
    if url.path == "/watch" {
      return URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?
        .first(where: { $0.name == "v" })?
        .value
    }
    let parts = url.path.split(separator: "/").map(String.init)
    if let first = parts.first, ["shorts", "embed", "live"].contains(first), parts.count > 1 {
      return parts[1]
    }
  }
  return nil
}

private func truncateMiddle(_ value: String, limit: Int) -> String {
  guard value.count > limit, limit > 3 else { return value }
  let keep = (limit - 3) / 2
  return "\(value.prefix(keep))...\(value.suffix(keep))"
}

private func absolutizeUrl(_ value: String, pageUrl: String) -> String {
  if value.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil {
    return value
  }
  guard let base = URL(string: pageUrl), let resolved = URL(string: value, relativeTo: base) else {
    return value
  }
  return resolved.absoluteURL.absoluteString
}

private extension String {
  var htmlDecoded: String {
    guard let data = data(using: .utf8),
          let decoded = try? NSAttributedString(
            data: data,
            options: [
              .documentType: NSAttributedString.DocumentType.html,
              .characterEncoding: String.Encoding.utf8.rawValue,
            ],
            documentAttributes: nil
          ).string else {
      return self
    }
    return decoded
  }
}

private enum NativeMediaLayout {
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

private enum NativeNoteConstants {
  static let defaultRelays = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nuts.cash",
  ]
}

private final class NativeAuthorReadRelaysHook {
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
