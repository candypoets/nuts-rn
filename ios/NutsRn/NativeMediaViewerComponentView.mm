#import "NativeMediaViewerComponentView.h"

#import <React/RCTFabricComponentsPlugins.h>
#import <Expo/Expo.h>
#import "Expo-Swift.h"
#import "ExpoModulesCore-Swift.h"
#import <React-RCTAppDelegate/RCTReactNativeFactory.h>
#import <react/renderer/components/NutsRnAppSpec/ComponentDescriptors.h>
#import <react/renderer/components/NutsRnAppSpec/EventEmitters.h>
#import <react/renderer/components/NutsRnAppSpec/Props.h>
#import <react/renderer/components/NutsRnAppSpec/RCTComponentViewHelpers.h>

#if __has_include("NutsRn-Swift.h")
#import "NutsRn-Swift.h"
#else
#import "NutsRn/NutsRn-Swift.h"
#endif

using namespace facebook::react;

static NSArray<NSString *> *RCTNSArrayFromStringVector(const std::vector<std::string> &values);
static NSArray<NSNumber *> *RCTNSArrayFromIntVector(const std::vector<int> &values);
static NSString *RCTNSStringFromString(const std::string &value);

@interface NativeMediaViewerComponentView () <RCTNativeMediaViewerViewProtocol>
- (std::shared_ptr<const NativeMediaViewerEventEmitter>)nativeMediaViewerEventEmitter;
@end

@implementation NativeMediaViewerComponentView {
  NativeMediaViewerContentView *_contentView;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const NativeMediaViewerProps>();
    _props = defaultProps;
    _contentView = [NativeMediaViewerContentView new];
    __weak NativeMediaViewerComponentView *weakSelf = self;
    _contentView.onNativeRoute = ^(NSString *route) {
      NativeMediaViewerComponentView *strongSelf = weakSelf;
      if (!strongSelf || !route) {
        return;
      }
      auto eventEmitter = [strongSelf nativeMediaViewerEventEmitter];
      if (eventEmitter) {
        NativeMediaViewerEventEmitter::OnNativeRoute event;
        event.route = std::string([route UTF8String]);
        eventEmitter->onNativeRoute(event);
      }
    };
    _contentView.onNativeAction = ^(NSString *action) {
      NativeMediaViewerComponentView *strongSelf = weakSelf;
      if (!strongSelf || !action) {
        return;
      }
      auto eventEmitter = [strongSelf nativeMediaViewerEventEmitter];
      if (eventEmitter) {
        NativeMediaViewerEventEmitter::OnNativeAction event;
        event.action = std::string([action UTF8String]);
        eventEmitter->onNativeAction(event);
      }
    };
    self.contentView = _contentView;
  }
  return self;
}

- (std::shared_ptr<const NativeMediaViewerEventEmitter>)nativeMediaViewerEventEmitter
{
  return std::static_pointer_cast<const NativeMediaViewerEventEmitter>(_eventEmitter);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldViewerProps = *std::static_pointer_cast<const NativeMediaViewerProps>(_props);
  const auto &newViewerProps = *std::static_pointer_cast<const NativeMediaViewerProps>(props);

  if (oldViewerProps.sessionId != newViewerProps.sessionId) {
    [_contentView updateSessionId:RCTNSStringFromString(newViewerProps.sessionId)];
  }
  if (
      oldViewerProps.urls != newViewerProps.urls ||
      oldViewerProps.types != newViewerProps.types ||
      oldViewerProps.thumbnails != newViewerProps.thumbnails ||
      oldViewerProps.dims != newViewerProps.dims ||
      oldViewerProps.itemKeys != newViewerProps.itemKeys
  ) {
    [_contentView updateUrls:RCTNSArrayFromStringVector(newViewerProps.urls)
                       types:RCTNSArrayFromStringVector(newViewerProps.types)
                  thumbnails:RCTNSArrayFromStringVector(newViewerProps.thumbnails)
                        dims:RCTNSArrayFromStringVector(newViewerProps.dims)
                    itemKeys:RCTNSArrayFromStringVector(newViewerProps.itemKeys)];
  }
  if (oldViewerProps.noteBytes != newViewerProps.noteBytes) {
    [_contentView updateNoteBytes:RCTNSArrayFromIntVector(newViewerProps.noteBytes)];
  }
  if (oldViewerProps.relays != newViewerProps.relays) {
    [_contentView updateRelays:RCTNSArrayFromStringVector(newViewerProps.relays)];
  }
  if (oldViewerProps.currentUserPubkey != newViewerProps.currentUserPubkey) {
    [_contentView updateCurrentUserPubkey:RCTNSStringFromString(newViewerProps.currentUserPubkey)];
  }
  if (oldViewerProps.optimisticReactionNonce != newViewerProps.optimisticReactionNonce) {
    [_contentView updateOptimisticReactionNonce:newViewerProps.optimisticReactionNonce];
  }
  if (oldViewerProps.primaryTextColor != newViewerProps.primaryTextColor) {
    [_contentView updatePrimaryTextColor:RCTNSStringFromString(newViewerProps.primaryTextColor)];
  }
  if (oldViewerProps.secondaryTextColor != newViewerProps.secondaryTextColor) {
    [_contentView updateSecondaryTextColor:RCTNSStringFromString(newViewerProps.secondaryTextColor)];
  }
  if (oldViewerProps.avatarBackgroundColor != newViewerProps.avatarBackgroundColor) {
    [_contentView updateAvatarBackgroundColor:RCTNSStringFromString(newViewerProps.avatarBackgroundColor)];
  }
  if (oldViewerProps.tintColor != newViewerProps.tintColor) {
    [_contentView updateTintColor:RCTNSStringFromString(newViewerProps.tintColor)];
  }
  if (oldViewerProps.primaryColor != newViewerProps.primaryColor) {
    [_contentView updatePrimaryColor:RCTNSStringFromString(newViewerProps.primaryColor)];
  }
  if (oldViewerProps.accentColor != newViewerProps.accentColor) {
    [_contentView updateAccentColor:RCTNSStringFromString(newViewerProps.accentColor)];
  }
  if (oldViewerProps.zoomBackgroundColor != newViewerProps.zoomBackgroundColor) {
    [_contentView updateZoomBackgroundColor:RCTNSStringFromString(newViewerProps.zoomBackgroundColor)];
  }
  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [_contentView prepareForRecycle];
  [super prepareForRecycle];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<NativeMediaViewerComponentDescriptor>();
}

static NSArray<NSString *> *RCTNSArrayFromStringVector(const std::vector<std::string> &values)
{
  NSMutableArray<NSString *> *array = [NSMutableArray arrayWithCapacity:values.size()];
  for (const auto &value : values) {
    [array addObject:[NSString stringWithUTF8String:value.c_str()]];
  }
  return array;
}

static NSArray<NSNumber *> *RCTNSArrayFromIntVector(const std::vector<int> &values)
{
  NSMutableArray<NSNumber *> *array = [NSMutableArray arrayWithCapacity:values.size()];
  for (const auto value : values) {
    [array addObject:@(value)];
  }
  return array;
}

static NSString *RCTNSStringFromString(const std::string &value)
{
  return value.empty() ? nil : [NSString stringWithUTF8String:value.c_str()];
}

@end

Class<RCTComponentViewProtocol> NativeMediaViewerCls(void)
{
  return NativeMediaViewerComponentView.class;
}
