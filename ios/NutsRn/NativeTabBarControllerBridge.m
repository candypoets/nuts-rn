#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(NativeTabBarController, NSObject)

RCT_EXTERN_METHOD(setHidden:(BOOL)hidden animated:(BOOL)animated)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

@end
