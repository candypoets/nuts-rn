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
    let count = min(items.count, maxDisplayLinks)
    guard count > 0 else { return 0 }
    return count == 1 ? imageHeight(dim: items[0].dim, width: width) : gridHeight
  }

  static func imageHeight(dim: String?, width: CGFloat) -> CGFloat {
    guard let dim, let parsed = parseDim(dim), parsed.width > 0 else { return min(width, maxImageHeight) }
    return min((parsed.height * width) / parsed.width, maxImageHeight)
  }

  static func tileFrame(total: Int, index: Int, width: CGFloat, height: CGFloat) -> CGRect {
    let halfWidth = (width - gap) / 2
    let halfHeight = (height - gap) / 2
    let thirdWidth = (width - gap * 2) / 3
    if total <= 1 { return CGRect(x: 0, y: 0, width: width, height: height) }
    if total == 2 { return CGRect(x: index == 0 ? 0 : halfWidth + gap, y: 0, width: halfWidth, height: height) }
    if total == 3 {
      if index == 0 { return CGRect(x: 0, y: 0, width: halfWidth, height: height) }
      return CGRect(x: halfWidth + gap, y: index == 1 ? 0 : halfHeight + gap, width: halfWidth, height: halfHeight)
    }
    if total == 4 {
      return CGRect(x: index % 2 == 0 ? 0 : halfWidth + gap, y: index < 2 ? 0 : halfHeight + gap, width: halfWidth, height: halfHeight)
    }
    if total == 5 {
      if index == 0 { return CGRect(x: 0, y: 0, width: halfWidth, height: height) }
      let offset = index - 1
      let smallWidth = (halfWidth - gap) / 2
      return CGRect(x: halfWidth + gap + CGFloat(offset % 2) * (smallWidth + gap), y: offset < 2 ? 0 : halfHeight + gap, width: smallWidth, height: halfHeight)
    }
    return CGRect(x: CGFloat(index % 3) * (thirdWidth + gap), y: index < 3 ? 0 : halfHeight + gap, width: thirdWidth, height: halfHeight)
  }

  private static func parseDim(_ dim: String) -> (width: CGFloat, height: CGFloat)? {
    let parts = dim.split(separator: "x").compactMap { Double($0) }
    guard parts.count == 2, parts[0] > 0, parts[1] > 0 else { return nil }
    return (CGFloat(parts[0]), CGFloat(parts[1]))
  }
}

struct ContentRun {
  let text: String
  let color: UIColor
  let profilePubkey: String?

  init(text: String, color: UIColor, profilePubkey: String? = nil) {
    self.text = text
    self.color = color
    self.profilePubkey = profilePubkey
  }
}

struct QuoteInfo {
  let id: String
  let relays: [String]
  let depth: Int
  let key: String
}

struct LinkPreviewInfo {
  let url: String
  let text: String
  let key: String
}

struct LinkPreviewMetadata {
  let title: String?
  let description: String?
  let image: String?
  let siteName: String?
}

struct MediaInfo {
  let url: String
  let type: String
  let thumbnail: String?
  let dim: String?
  let key: String
}

final class NativeMediaSessionRegistry {
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

private final class NativeMediaPlaybackCoordinator {
  static let shared = NativeMediaPlaybackCoordinator()

  private weak var activePlayer: AVPlayer?

  private init() {}

  func play(_ player: AVPlayer) {
    let audioSession = AVAudioSession.sharedInstance()
    do {
      try audioSession.setCategory(.playback, mode: .moviePlayback)
      try audioSession.setActive(true)
    } catch {
      NSLog("[NativeMedia] Failed to activate video audio session: %@", error.localizedDescription)
    }
    if activePlayer !== player {
      activePlayer?.pause()
      activePlayer = player
    }
    player.play()
  }

  func pause(_ player: AVPlayer) {
    player.pause()
    if activePlayer === player {
      activePlayer = nil
    }
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
    NativeMediaPlaybackCoordinator.shared.play(player)
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
      NativeMediaPlaybackCoordinator.shared.pause(player)
    } else {
      let duration = player.currentItem?.duration.seconds ?? 0
      if duration > 0 && player.currentTime().seconds >= duration - 0.25 {
        player.seek(to: .zero)
      }
      NativeMediaPlaybackCoordinator.shared.play(player)
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
    NativeMediaPlaybackCoordinator.shared.play(player)
    refresh()
  }
}

enum ContentLine {
  case text([ContentRun])
  case quote(QuoteInfo)
  case linkPreview(LinkPreviewInfo)
  case mediaGrid([MediaInfo], String)
}

enum NativeMediaURLSession {
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

enum NativeContentBlockParser {
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
  private let remainingItemsLabel = UILabel()
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
    configureRemainingItemsLabel()
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
    configureRemainingItemsLabel()
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

  private func configureRemainingItemsLabel() {
    remainingItemsLabel.backgroundColor = UIColor.black.withAlphaComponent(0.58)
    remainingItemsLabel.textColor = .white
    remainingItemsLabel.font = .systemFont(ofSize: 24, weight: .bold)
    remainingItemsLabel.textAlignment = .center
    remainingItemsLabel.isHidden = true
    remainingItemsLabel.isUserInteractionEnabled = false
    addSubview(remainingItemsLabel)
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

  func update(items: [MediaInfo]) {
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
    if items.count > displayItems.count,
       let lastIndex = displayItems.indices.last {
      remainingItemsLabel.frame = NativeMediaLayout.tileFrame(
        total: displayItems.count,
        index: lastIndex,
        width: bounds.width,
        height: bounds.height
      )
      remainingItemsLabel.text = "+\(items.count - displayItems.count)"
      remainingItemsLabel.isHidden = false
      bringSubviewToFront(remainingItemsLabel)
    } else {
      remainingItemsLabel.isHidden = true
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
        NativeMediaPlaybackCoordinator.shared.play(player)
        activePlayer = player
      } else {
        player.isMuted = true
        player.volume = 0
        NativeMediaPlaybackCoordinator.shared.pause(player)
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
        NativeMediaPlaybackCoordinator.shared.play(player)
      } else {
        NativeMediaPlaybackCoordinator.shared.pause(player)
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
      NativeMediaPlaybackCoordinator.shared.play(player)
    } else {
      NativeMediaPlaybackCoordinator.shared.pause(player)
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
        NativeMediaPlaybackCoordinator.shared.pause(player)
        return
      }
      player.seek(to: .zero)
      NativeMediaPlaybackCoordinator.shared.play(player)
      return
    }
  }

  private func removeVideo(forKey key: String) {
    if let player = videoPlayersByKey[key] {
      NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: player.currentItem)
      NativeMediaPlaybackCoordinator.shared.pause(player)
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
