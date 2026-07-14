#import "NativeNoteHeaderComponentView.h"

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

@interface NativeNoteHeaderComponentView () <RCTNativeNoteHeaderViewProtocol>
- (std::shared_ptr<const NativeNoteHeaderEventEmitter>)nativeNoteHeaderEventEmitter;
@end

@implementation NativeNoteHeaderComponentView {
  NativeNoteHeaderContentView *_contentView;
}

+ (void)load
{
  [super load];
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const NativeNoteHeaderProps>();
    _props = defaultProps;
    _contentView = [NativeNoteHeaderContentView new];
    __weak NativeNoteHeaderComponentView *weakSelf = self;
    _contentView.onNativeRoute = ^(NSString *route) {
      NativeNoteHeaderComponentView *strongSelf = weakSelf;
      if (!strongSelf || !route) {
        return;
      }
      auto eventEmitter = [strongSelf nativeNoteHeaderEventEmitter];
      if (eventEmitter) {
        NativeNoteHeaderEventEmitter::OnNativeRoute event;
        event.route = std::string([route UTF8String]);
        eventEmitter->onNativeRoute(event);
      }
    };
    self.contentView = _contentView;
  }

  return self;
}

- (std::shared_ptr<const NativeNoteHeaderEventEmitter>)nativeNoteHeaderEventEmitter
{
  return std::static_pointer_cast<const NativeNoteHeaderEventEmitter>(_eventEmitter);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldHeaderProps = *std::static_pointer_cast<const NativeNoteHeaderProps>(_props);
  const auto &newHeaderProps = *std::static_pointer_cast<const NativeNoteHeaderProps>(props);

  if (oldHeaderProps.noteBytes != newHeaderProps.noteBytes) {
    [_contentView updateNoteBytes:RCTNSArrayFromIntVector(newHeaderProps.noteBytes)];
  }
  if (oldHeaderProps.relays != newHeaderProps.relays) {
    [_contentView updateRelays:RCTNSArrayFromStringVector(newHeaderProps.relays)];
  }
  if (oldHeaderProps.visible != newHeaderProps.visible) {
    [_contentView updateVisible:newHeaderProps.visible];
  }
  if (oldHeaderProps.depth != newHeaderProps.depth) {
    [_contentView updateDepth:@(newHeaderProps.depth)];
  }
  if (oldHeaderProps.main != newHeaderProps.main) {
    [_contentView updateMain:newHeaderProps.main];
  }
  if (oldHeaderProps.showRelays != newHeaderProps.showRelays) {
    [_contentView updateShowRelays:newHeaderProps.showRelays];
  }
  if (oldHeaderProps.relayCount != newHeaderProps.relayCount) {
    [_contentView updateRelayCount:@(newHeaderProps.relayCount)];
  }
  if (oldHeaderProps.authorPubkey != newHeaderProps.authorPubkey) {
    [_contentView updateAuthorPubkey:RCTNSStringFromString(newHeaderProps.authorPubkey)];
  }
  if (oldHeaderProps.reposterPubkey != newHeaderProps.reposterPubkey) {
    [_contentView updateReposterPubkey:RCTNSStringFromString(newHeaderProps.reposterPubkey)];
  }
  if (oldHeaderProps.fallbackSubId != newHeaderProps.fallbackSubId) {
    [_contentView updateFallbackSubId:RCTNSStringFromString(newHeaderProps.fallbackSubId)];
  }
  if (oldHeaderProps.primaryTextColor != newHeaderProps.primaryTextColor) {
    [_contentView updatePrimaryTextColor:RCTNSStringFromString(newHeaderProps.primaryTextColor)];
  }
  if (oldHeaderProps.secondaryTextColor != newHeaderProps.secondaryTextColor) {
    [_contentView updateSecondaryTextColor:RCTNSStringFromString(newHeaderProps.secondaryTextColor)];
  }
  if (oldHeaderProps.avatarBackgroundColor != newHeaderProps.avatarBackgroundColor) {
    [_contentView updateAvatarBackgroundColor:RCTNSStringFromString(newHeaderProps.avatarBackgroundColor)];
  }
  if (oldHeaderProps.accentColor != newHeaderProps.accentColor) {
    [_contentView updateAccentColor:RCTNSStringFromString(newHeaderProps.accentColor)];
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
  return concreteComponentDescriptorProvider<NativeNoteHeaderComponentDescriptor>();
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

static NSString *RCTNSStringFromString(const std::string &value)
{
  return value.empty() ? nil : [NSString stringWithUTF8String:value.c_str()];
}

@end

Class<RCTComponentViewProtocol> NativeNoteHeaderCls(void)
{
  return NativeNoteHeaderComponentView.class;
}
