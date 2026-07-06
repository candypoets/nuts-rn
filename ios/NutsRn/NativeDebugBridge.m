#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>

static NSString *NativeDebugLogNotificationName = @"NativeDebugLog";

@interface NativeDebugBridge : RCTEventEmitter <RCTBridgeModule>
@end

@implementation NativeDebugBridge

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[@"nativeDebugLog"];
}

- (void)startObserving
{
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleNativeDebugNotification:)
                                               name:NativeDebugLogNotificationName
                                             object:nil];
}

- (void)stopObserving
{
  [[NSNotificationCenter defaultCenter] removeObserver:self
                                                  name:NativeDebugLogNotificationName
                                                object:nil];
}

- (void)handleNativeDebugNotification:(NSNotification *)notification
{
  [self sendEventWithName:@"nativeDebugLog" body:notification.userInfo ?: @{}];
}

@end
