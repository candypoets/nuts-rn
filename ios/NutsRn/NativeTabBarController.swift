import Foundation
import UIKit

@objc(NativeTabBarController)
class NativeTabBarController: NSObject {
  private static var hidden = false

  @objc(setHidden:animated:)
  func setHidden(_ hidden: Bool, animated: Bool) {
    DispatchQueue.main.async {
      guard let tabBarController = Self.findTabBarController() else {
        emitNativeDebugLog(
          source: "NativeTabBarController",
          event: "missing-tab-controller",
          details: hidden ? "hide" : "show"
        )
        return
      }

      guard NativeTabBarController.hidden != hidden else { return }
      NativeTabBarController.hidden = hidden

      if #available(iOS 18.0, *) {
        tabBarController.setTabBarHidden(hidden, animated: animated)
      }
    }
  }

  private static func findTabBarController() -> UITabBarController? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .sorted { left, right in
        if left.isKeyWindow != right.isKeyWindow {
          return left.isKeyWindow
        }
        return left.windowLevel.rawValue > right.windowLevel.rawValue
      }
      .compactMap { findTabBarController(in: $0.rootViewController) }
      .first
  }

  private static func findTabBarController(in controller: UIViewController?) -> UITabBarController? {
    guard let controller else { return nil }

    if let tabBarController = controller as? UITabBarController {
      return tabBarController
    }

    if let presented = controller.presentedViewController,
       let tabBarController = findTabBarController(in: presented) {
      return tabBarController
    }

    for child in controller.children {
      if let tabBarController = findTabBarController(in: child) {
        return tabBarController
      }
    }

    return nil
  }
}
