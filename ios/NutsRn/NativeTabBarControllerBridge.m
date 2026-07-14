#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(NativeTabBarController, NSObject)

RCT_EXTERN_METHOD(setHidden:(BOOL)hidden animated:(BOOL)animated)
RCT_EXTERN_METHOD(diagnoseScrollViews)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

@end
