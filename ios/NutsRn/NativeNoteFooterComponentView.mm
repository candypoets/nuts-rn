#import "NativeNoteFooterComponentView.h"

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

@interface NativeNoteFooterComponentView () <RCTNativeNoteFooterViewProtocol>
- (std::shared_ptr<const NativeNoteFooterEventEmitter>)nativeNoteFooterEventEmitter;
@end

@implementation NativeNoteFooterComponentView {
  NativeNoteFooterContentView *_contentView;
}

+ (void)load
{
  [super load];
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const NativeNoteFooterProps>();
    _props = defaultProps;
    _contentView = [NativeNoteFooterContentView new];
    __weak NativeNoteFooterComponentView *weakSelf = self;
    _contentView.onNativeAction = ^(NSString *action) {
      NativeNoteFooterComponentView *strongSelf = weakSelf;
      if (!strongSelf || !action) {
        return;
      }
      auto eventEmitter = [strongSelf nativeNoteFooterEventEmitter];
      if (eventEmitter) {
        NativeNoteFooterEventEmitter::OnNativeAction event;
        event.action = std::string([action UTF8String]);
        eventEmitter->onNativeAction(event);
      }
    };
    self.contentView = _contentView;
  }

  return self;
}

- (std::shared_ptr<const NativeNoteFooterEventEmitter>)nativeNoteFooterEventEmitter
{
  return std::static_pointer_cast<const NativeNoteFooterEventEmitter>(_eventEmitter);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldFooterProps = *std::static_pointer_cast<const NativeNoteFooterProps>(_props);
  const auto &newFooterProps = *std::static_pointer_cast<const NativeNoteFooterProps>(props);

  if (oldFooterProps.noteBytes != newFooterProps.noteBytes) {
    [_contentView updateNoteBytes:RCTNSArrayFromIntVector(newFooterProps.noteBytes)];
  }
  if (oldFooterProps.relays != newFooterProps.relays) {
    [_contentView updateRelays:RCTNSArrayFromStringVector(newFooterProps.relays)];
  }
  if (oldFooterProps.currentUserPubkey != newFooterProps.currentUserPubkey) {
    [_contentView updateCurrentUserPubkey:RCTNSStringFromString(newFooterProps.currentUserPubkey)];
  }
  if (oldFooterProps.optimisticReactionNonce != newFooterProps.optimisticReactionNonce) {
    [_contentView updateOptimisticReactionNonce:newFooterProps.optimisticReactionNonce];
  }
  if (oldFooterProps.visible != newFooterProps.visible) {
    [_contentView updateVisible:newFooterProps.visible];
  }
  if (oldFooterProps.main != newFooterProps.main) {
    [_contentView updateMain:newFooterProps.main];
  }
  if (oldFooterProps.zoom != newFooterProps.zoom) {
    [_contentView updateZoom:newFooterProps.zoom];
  }
  if (oldFooterProps.tintColor != newFooterProps.tintColor) {
    [_contentView updateTintColor:RCTNSStringFromString(newFooterProps.tintColor)];
  }
  if (oldFooterProps.primaryColor != newFooterProps.primaryColor) {
    [_contentView updatePrimaryColor:RCTNSStringFromString(newFooterProps.primaryColor)];
  }
  if (oldFooterProps.accentColor != newFooterProps.accentColor) {
    [_contentView updateAccentColor:RCTNSStringFromString(newFooterProps.accentColor)];
  }
  if (oldFooterProps.zoomBackgroundColor != newFooterProps.zoomBackgroundColor) {
    [_contentView updateZoomBackgroundColor:RCTNSStringFromString(newFooterProps.zoomBackgroundColor)];
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
  return concreteComponentDescriptorProvider<NativeNoteFooterComponentDescriptor>();
}

static NSString *RCTNSStringFromString(const std::string &value)
{
  return value.empty() ? nil : [NSString stringWithUTF8String:value.c_str()];
}

static NSArray<NSNumber *> *RCTNSArrayFromIntVector(const std::vector<int> &values)
{
  NSMutableArray<NSNumber *> *array = [NSMutableArray arrayWithCapacity:values.size()];
  for (const auto value : values) {
    [array addObject:@(value)];
  }
  return array;
}

static NSArray<NSString *> *RCTNSArrayFromStringVector(const std::vector<std::string> &values)
{
  NSMutableArray<NSString *> *array = [NSMutableArray arrayWithCapacity:values.size()];
  for (const auto &value : values) {
    [array addObject:[NSString stringWithUTF8String:value.c_str()]];
  }
  return array;
}

@end

Class<RCTComponentViewProtocol> NativeNoteFooterCls(void)
{
  return NativeNoteFooterComponentView.class;
}
