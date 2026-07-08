import NipworkerSwift
import UIKit

@objc(NativeAvatarContentView)
class NativeAvatarContentView: UIView {
  private static let imageCache = NSCache<NSString, UIImage>()

  private var pubkey = ""
  private var query = true
  private var picture = ""
  private var avatarImage: UIImage?
  private var avatarRequestUrl: String?
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
    profileHook.cancel()
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

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    let avatarRect = bounds.insetBy(dx: 0.5, dy: 0.5)
    context.setFillColor(avatarBackgroundColor.cgColor)
    context.fillEllipse(in: avatarRect)
    if let avatarImage {
      context.saveGState()
      context.addEllipse(in: avatarRect)
      context.clip()
      avatarImage.draw(in: avatarRect)
      context.restoreGState()
    } else if !pubkey.isEmpty {
      drawInitial(in: avatarRect)
    }
    context.setStrokeColor(avatarBorderColor.cgColor)
    context.setLineWidth(1)
    context.strokeEllipse(in: avatarRect)
  }

  private func drawInitial(in rect: CGRect) {
    let initial = String(pubkey.prefix(1)).uppercased()
    let font = UIFont.systemFont(ofSize: max(10, rect.width * 0.42), weight: .semibold)
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: UIColor.secondaryLabel,
    ]
    let size = (initial as NSString).size(withAttributes: attributes)
    (initial as NSString).draw(
      at: CGPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2),
      withAttributes: attributes
    )
  }

  private func refreshProfileSubscription() {
    profileHook.update(pubkey: pubkey, relays: [], visible: query)
  }

  private func loadAvatarImage() {
    avatarImage = nil
    guard !picture.isEmpty, let url = URL(string: picture) else {
      avatarRequestUrl = nil
      setNeedsDisplay()
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
      else { return }
      Self.imageCache.setObject(image, forKey: cacheKey)
      DispatchQueue.main.async {
        guard self.avatarRequestUrl == cacheKey as String else { return }
        self.avatarImage = image
        self.setNeedsDisplay()
      }
    }.resume()
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
