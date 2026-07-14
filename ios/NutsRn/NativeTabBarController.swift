import Foundation
import UIKit

@objc(NativeTabBarController)
class NativeTabBarController: NSObject {
  private static var hidden = false

  @objc(configureCompactAppearance)
  func configureCompactAppearance() {
    DispatchQueue.main.async {
      Self.configureCompactAppearance(attempt: 0)
    }
  }

  private static func configureCompactAppearance(attempt: Int) {
    guard let tabBarController = findTabBarController() else {
      guard attempt < 20 else {
        emitNativeDebugLog(
          source: "NativeTabBarController",
          event: "missing-tab-controller",
          details: "configure-compact-appearance attempts=\(attempt + 1)"
        )
        return
      }

      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
        configureCompactAppearance(attempt: attempt + 1)
      }
      return
    }

    guard #available(iOS 18.0, *) else { return }

    let compactTabIdentifiers = tabBarController.tabs.map(\.identifier)
    tabBarController.compactTabIdentifiers = compactTabIdentifiers
    tabBarController.tabBar.itemPositioning = .fill

    let appearance = tabBarController.tabBar.standardAppearance.copy()
      as? UITabBarAppearance ?? UITabBarAppearance()
    let compactItems = appearance.compactInlineLayoutAppearance
    compactItems.normal.titleTextAttributes[.font] = UIFont.systemFont(ofSize: 10, weight: .medium)
    compactItems.selected.titleTextAttributes[.font] = UIFont.systemFont(ofSize: 10, weight: .semibold)
    tabBarController.tabBar.standardAppearance = appearance
    tabBarController.tabBar.scrollEdgeAppearance = appearance
    tabBarController.tabBar.setNeedsLayout()

    emitNativeDebugLog(
      source: "NativeTabBarController",
      event: "compact-appearance-configured",
      details: "identifiers=\(compactTabIdentifiers.joined(separator: ",")); positioning=fill; attempt=\(attempt + 1)"
    )
  }

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

  @objc(diagnoseScrollViews)
  func diagnoseScrollViews() {
    DispatchQueue.main.async {
      guard let tabBarController = Self.findTabBarController() else {
        emitNativeDebugLog(
          source: "NativeTabBarController",
          event: "missing-tab-controller",
          details: "diagnose"
        )
        return
      }
      Self.logSelectedTabScrollViews(tabBarController)
    }
  }

  private static func logSelectedTabScrollViews(_ tabBarController: UITabBarController) {
    guard let rootView = tabBarController.selectedViewController?.view else {
      emitNativeDebugLog(
        source: "NativeTabBarController",
        event: "scroll-view-diagnostic",
        details: "selected tab has no root view"
      )
      return
    }

    var firstChain: [String] = []
    var currentView: UIView? = rootView
    while let view = currentView {
      firstChain.append(String(describing: type(of: view)))
      currentView = view.subviews.first
    }

    var scrollViews: [String] = []
    collectScrollViews(in: rootView, path: [], output: &scrollViews)
    var viewTree: [String] = []
    collectViewTree(in: rootView, path: [], depth: 0, output: &viewTree)
    emitNativeDebugLog(
      source: "NativeTabBarController",
      event: "scroll-view-diagnostic",
      details: "controller=\(type(of: tabBarController))" +
        " selected=\(String(describing: tabBarController.selectedViewController.map { type(of: $0) }))" +
        "; first=\(firstChain.joined(separator: ">"))" +
        "; tree=\(viewTree.joined(separator: " | "))" +
        "; scrolls=\(scrollViews.joined(separator: " | "))"
    )
  }

  private static func collectViewTree(
    in view: UIView,
    path: [Int],
    depth: Int,
    output: inout [String]
  ) {
    guard depth <= 3 else { return }
    let identifier = view.accessibilityIdentifier.map { " id=\($0)" } ?? ""
    output.append(
      "\(path.map(String.init).joined(separator: ".")):\(type(of: view))" +
        " frame=\(view.frame) hidden=\(view.isHidden) z=\(view.layer.zPosition)\(identifier)"
    )
    for (index, child) in view.subviews.enumerated() {
      collectViewTree(in: child, path: path + [index], depth: depth + 1, output: &output)
    }
  }

  private static func collectScrollViews(
    in view: UIView,
    path: [Int],
    output: inout [String]
  ) {
    if let scrollView = view as? UIScrollView {
      output.append(
        "\(path.map(String.init).joined(separator: ".")):\(type(of: scrollView))" +
          " inset=\(scrollView.contentInsetAdjustmentBehavior.rawValue)" +
          " content=\(scrollView.contentSize) frame=\(scrollView.frame)"
      )
    }
    for (index, child) in view.subviews.enumerated() {
      collectScrollViews(in: child, path: path + [index], output: &output)
    }
  }

  private static func findTabBarController() -> UITabBarController? {
    let rootControllers = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .sorted { left, right in
        if left.isKeyWindow != right.isKeyWindow {
          return left.isKeyWindow
        }
        return left.windowLevel.rawValue > right.windowLevel.rawValue
      }
      .compactMap(\.rootViewController)

    return rootControllers
      .compactMap { findReactNativeScreensTabBarController(in: $0) }
      .first ?? rootControllers
      .compactMap { findTabBarController(in: $0) }
      .first
  }

  private static func findReactNativeScreensTabBarController(
    in controller: UIViewController?
  ) -> UITabBarController? {
    guard let controller else { return nil }

    if let tabBarController = controller as? UITabBarController,
       String(describing: type(of: tabBarController)).contains("RNSTabBarController") {
      return tabBarController
    }

    if let presented = controller.presentedViewController,
       let tabBarController = findReactNativeScreensTabBarController(in: presented) {
      return tabBarController
    }

    for child in controller.children {
      if let tabBarController = findReactNativeScreensTabBarController(in: child) {
        return tabBarController
      }
    }

    return nil
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
