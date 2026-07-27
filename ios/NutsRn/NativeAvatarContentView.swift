import NipworkerReactNative
import SDWebImage
import UIKit

final class NativeAvatarImageLoader {
  static let shared = NativeAvatarImageLoader()

  private init() {}

  @discardableResult
  func loadImage(
    for source: String,
    targetSize: CGSize,
    completion: @escaping (UIImage?) -> Void
  ) -> SDWebImageOperation? {
    guard let url = URL(string: source), targetSize.width > 0, targetSize.height > 0 else { return nil }
    let context: [SDWebImageContextOption: Any] = [
      .imageThumbnailPixelSize: targetSize,
      .imagePreserveAspectRatio: true,
    ]
    return SDWebImageManager.shared.loadImage(
      with: url,
      options: [.retryFailed, .scaleDownLargeImages, .continueInBackground, .highPriority],
      context: context,
      progress: nil
    ) { image, _, _, _, finished, _ in
      guard finished else { return }
      completion(image)
    }
  }
}

@objc(NativeAvatarContentView)
class NativeAvatarContentView: UIView {
  private var pubkey = ""
  private var query = true
  private var picture = ""
  private var avatarImage: UIImage?
  private var avatarRequestUrl: String?
  private var avatarImageOperation: SDWebImageOperation?
  private lazy var profileHook: NativeProfileHook = {
    let hook = NativeProfileHook()
    hook.onProfile = { [weak self] profile in
      guard let self, profile.pubkey == self.pubkey else { return }
      self.picture = profile.picture
      self.loadAvatarImage()
    }
    return hook
  }()
  private var avatarBackgroundColor = UIColor.secondarySystemBackground
  private var avatarBorderColor = UIColor.separator
  private var initials = ""
  private var avatarColor: UIColor?

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
    avatarImageOperation?.cancel()
    profileHook.cancel()
  }

  @objc func prepareForRecycle() {
    avatarImageOperation?.cancel()
    avatarImageOperation = nil
    profileHook.cancel()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      avatarImageOperation?.cancel()
      avatarImageOperation = nil
    } else if avatarImage == nil, !picture.isEmpty {
      loadAvatarImage()
    }
  }

  @objc(updatePubkey:)
  func updatePubkey(_ value: String?) {
    pubkey = value ?? ""
    picture = ""
    avatarImage = nil
    refreshProfileSubscription()
    setNeedsDisplay()
  }

  @objc(updateQuery:)
  func updateQuery(_ value: Bool) {
    query = value
    refreshProfileSubscription()
    setNeedsDisplay()
  }

  @objc(updateBackgroundColor:)
  func updateBackgroundColor(_ value: String?) {
    avatarBackgroundColor = UIColor(avatarCssColor: value) ?? avatarBackgroundColor
    setNeedsDisplay()
  }

  @objc(updateBorderColor:)
  func updateBorderColor(_ value: String?) {
    avatarBorderColor = UIColor(avatarCssColor: value) ?? avatarBorderColor
    setNeedsDisplay()
  }

  @objc(updateInitials:)
  func updateInitials(_ value: String?) {
    initials = value ?? ""
    setNeedsDisplay()
  }

  @objc(updateAvatarColor:)
  func updateAvatarColor(_ value: String?) {
    avatarColor = UIColor(avatarCssColor: value)
    setNeedsDisplay()
  }

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    let avatarRect = bounds.insetBy(dx: 0.5, dy: 0.5)
    context.setFillColor((avatarColor ?? avatarBackgroundColor).cgColor)
    context.fillEllipse(in: avatarRect)
    if let avatarImage {
      context.saveGState()
      context.addEllipse(in: avatarRect)
      context.clip()
      avatarImage.draw(in: avatarRect)
      context.restoreGState()
    } else if !pubkey.isEmpty {
      drawFallback(in: avatarRect)
    }
    context.setStrokeColor(avatarBorderColor.cgColor)
    context.setLineWidth(1)
    context.strokeEllipse(in: avatarRect)
  }

  private func drawFallback(in rect: CGRect) {
    let fallbackColor = UIColor.white.withAlphaComponent(0.92)
    if initials.isEmpty {
      let configuration = UIImage.SymbolConfiguration(pointSize: rect.width * 0.5, weight: .semibold)
      guard let glyph = UIImage(systemName: "person.fill", withConfiguration: configuration) else { return }
      let tinted = glyph.withTintColor(fallbackColor, renderingMode: .alwaysOriginal)
      tinted.draw(
        at: CGPoint(x: rect.midX - tinted.size.width / 2, y: rect.midY - tinted.size.height / 2)
      )
      return
    }
    let font = UIFont.systemFont(ofSize: max(10, rect.width * 0.36), weight: .semibold)
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: fallbackColor,
    ]
    let size = (initials as NSString).size(withAttributes: attributes)
    (initials as NSString).draw(
      at: CGPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2),
      withAttributes: attributes
    )
  }

  private func refreshProfileSubscription() {
    profileHook.update(pubkey: pubkey, relays: [], visible: query)
  }

  private func loadAvatarImage() {
    avatarImageOperation?.cancel()
    avatarImageOperation = nil
    avatarImage = nil
    guard !picture.isEmpty, URL(string: picture) != nil else {
      avatarRequestUrl = nil
      setNeedsDisplay()
      return
    }
    guard window != nil else { return }
    avatarRequestUrl = picture
    let scale = window?.screen.scale ?? UIScreen.main.scale
    let targetSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    avatarImageOperation = NativeAvatarImageLoader.shared.loadImage(for: picture, targetSize: targetSize) { [weak self] image in
      guard let self, self.avatarRequestUrl == self.picture else { return }
      self.avatarImageOperation = nil
      guard let image else { return }
      self.avatarImage = image
      self.setNeedsDisplay()
    }
  }
}

private extension UIColor {
  convenience init?(avatarCssColor: String?) {
    guard let avatarCssColor else { return nil }
    let value = avatarCssColor.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("rgba("), value.hasSuffix(")") {
      let body = value.dropFirst(5).dropLast()
      let parts = body.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      guard parts.count == 4,
            let red = Double(parts[0]),
            let green = Double(parts[1]),
            let blue = Double(parts[2]),
            let alpha = Double(parts[3]) else { return nil }
      self.init(red: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
      return
    }
    let normalized = value.replacingOccurrences(of: "#", with: "")
    guard normalized.count == 6, let hex = UInt32(normalized, radix: 16) else { return nil }
    self.init(
      red: CGFloat((hex >> 16) & 0xff) / 255,
      green: CGFloat((hex >> 8) & 0xff) / 255,
      blue: CGFloat(hex & 0xff) / 255,
      alpha: 1
    )
  }
}
