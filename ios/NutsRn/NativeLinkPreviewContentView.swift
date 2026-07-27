import Foundation
import FlatBuffers
import NipworkerReactNative
import AVFoundation
import SDWebImage
import UIKit
@objc(NativeLinkPreviewContentView)
class NativeLinkPreviewContentView: UIView {
  @objc var onNativeRoute: ((String) -> Void)?
  @objc var onHeightChange: ((CGFloat) -> Void)?

  private static let metadataCache = NSCache<NSString, NativeLinkPreviewMetadataBox>()
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
  private var imageOperation: SDWebImageOperation?
  private var imageSource: String?
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
    cancelPendingLoads()
  }

  @objc func prepareForRecycle() {
    cancelPendingLoads()
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

  func update(preview: LinkPreviewInfo) {
    guard self.preview?.url != preview.url || self.preview?.text != preview.text else { return }
    self.preview = preview
    metadata = Self.metadataCache.object(forKey: preview.url as NSString)?.metadata
    thumbnailFallback = 0
    imageView.image = nil
    metadataTask?.cancel()
    imageOperation?.cancel()
    imageOperation = nil
    imageSource = nil
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
    loadThumbnailIfNeeded()

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
    guard let source = thumbnailUrl else {
      imageOperation?.cancel()
      imageOperation = nil
      imageSource = nil
      imageView.image = nil
      return
    }
    if imageSource == source {
      return
    }

    let width = bounds.width
    guard width > 0 else {
      setNeedsLayout()
      return
    }

    imageOperation?.cancel()
    imageSource = source
    let scale = window?.screen.scale ?? UIScreen.main.scale
    let targetSize = CGSize(width: width * scale, height: floor(width * 9 / 16) * scale)
    imageOperation = NativeMediaSessionRegistry.shared.loadImage(
      for: source,
      targetSize: targetSize,
      highPriority: true
    ) { [weak self] image, finished in
      guard let self, self.imageSource == source else { return }
      if let image {
        self.imageView.image = image
      }
      guard finished else { return }
      self.imageOperation = nil
      if image == nil, self.isYouTube {
        self.imageSource = nil
        self.thumbnailFallback += 1
        self.loadThumbnailIfNeeded()
      }
      self.setNeedsLayout()
      self.reportHeightIfNeeded()
    }
  }

  private func cancelPendingLoads() {
    metadataTask?.cancel()
    metadataTask = nil
    imageOperation?.cancel()
    imageOperation = nil
    imageSource = nil
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

func youtubeVideoId(_ value: String) -> String? {
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
