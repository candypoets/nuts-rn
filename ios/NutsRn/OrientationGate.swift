import Foundation
import UIKit

@objc(OrientationGate)
class OrientationGate: NSObject {
  static var isImageZoomActive = false

  @objc(setImageZoomActive:)
  func setImageZoomActive(_ active: Bool) {
    DispatchQueue.main.async {
      OrientationGate.isImageZoomActive = active
      OrientationGate.refreshSupportedOrientations()
    }
  }

  private static func refreshSupportedOrientations() {
    let mask: UIInterfaceOrientationMask = isImageZoomActive
      ? [.portrait, .landscapeLeft, .landscapeRight]
      : .portrait

    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .forEach { scene in
        scene.windows.forEach { window in
          window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        }

        if #available(iOS 16.0, *) {
          scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask))
        } else {
          UIViewController.attemptRotationToDeviceOrientation()
        }
      }
  }
}
