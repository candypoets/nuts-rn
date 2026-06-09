#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(OrientationGate, NSObject)

RCT_EXTERN_METHOD(setImageZoomActive:(BOOL)active)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

@end
