#import "NativeLinkPreviewComponentView.h"

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

@interface NativeLinkPreviewComponentView () <RCTNativeLinkPreviewViewProtocol>
- (std::shared_ptr<const NativeLinkPreviewEventEmitter>)nativeLinkPreviewEventEmitter;
@end

@implementation NativeLinkPreviewComponentView {
  NativeLinkPreviewContentView *_contentView;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const NativeLinkPreviewProps>();
    _props = defaultProps;
    _contentView = [NativeLinkPreviewContentView new];
    __weak NativeLinkPreviewComponentView *weakSelf = self;
    _contentView.onHeightChange = ^(CGFloat height) {
      NativeLinkPreviewComponentView *strongSelf = weakSelf;
      if (!strongSelf) {
        return;
      }
      auto eventEmitter = [strongSelf nativeLinkPreviewEventEmitter];
      if (eventEmitter) {
        NativeLinkPreviewEventEmitter::OnHeightChange event;
        event.height = (double)height;
        eventEmitter->onHeightChange(event);
      }
    };
    _contentView.onNativeRoute = ^(NSString *route) {
      NativeLinkPreviewComponentView *strongSelf = weakSelf;
      if (!strongSelf || !route) {
        return;
      }
      auto eventEmitter = [strongSelf nativeLinkPreviewEventEmitter];
      if (eventEmitter) {
        NativeLinkPreviewEventEmitter::OnNativeRoute event;
        event.route = std::string([route UTF8String]);
        eventEmitter->onNativeRoute(event);
      }
    };
    self.contentView = _contentView;
  }
  return self;
}

- (std::shared_ptr<const NativeLinkPreviewEventEmitter>)nativeLinkPreviewEventEmitter
{
  return std::static_pointer_cast<const NativeLinkPreviewEventEmitter>(_eventEmitter);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldPreviewProps = *std::static_pointer_cast<const NativeLinkPreviewProps>(_props);
  const auto &newPreviewProps = *std::static_pointer_cast<const NativeLinkPreviewProps>(props);

  if (oldPreviewProps.url != newPreviewProps.url || oldPreviewProps.text != newPreviewProps.text) {
    [_contentView updateUrl:RCTNSStringFromString(newPreviewProps.url)
                       text:RCTNSStringFromString(newPreviewProps.text)];
  }
  if (oldPreviewProps.baseContentColor != newPreviewProps.baseContentColor) {
    [_contentView updateBaseContentColor:RCTNSStringFromString(newPreviewProps.baseContentColor)];
  }
  if (oldPreviewProps.secondaryTextColor != newPreviewProps.secondaryTextColor) {
    [_contentView updateSecondaryTextColor:RCTNSStringFromString(newPreviewProps.secondaryTextColor)];
  }
  if (oldPreviewProps.cardBackgroundColor != newPreviewProps.cardBackgroundColor) {
    [_contentView updateCardBackgroundColor:RCTNSStringFromString(newPreviewProps.cardBackgroundColor)];
  }
  if (oldPreviewProps.borderColor != newPreviewProps.borderColor) {
    [_contentView updateBorderColor:RCTNSStringFromString(newPreviewProps.borderColor)];
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
  return concreteComponentDescriptorProvider<NativeLinkPreviewComponentDescriptor>();
}

static NSString *RCTNSStringFromString(const std::string &value)
{
  return value.empty() ? nil : [NSString stringWithUTF8String:value.c_str()];
}

@end

Class<RCTComponentViewProtocol> NativeLinkPreviewCls(void)
{
  return NativeLinkPreviewComponentView.class;
}
