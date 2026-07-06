#import "NativeAvatarComponentView.h"

#import <React/RCTFabricComponentsPlugins.h>
#import <Expo/Expo.h>
#import "Expo-Swift.h"
#import "ExpoModulesCore-Swift.h"
#import <React-RCTAppDelegate/RCTReactNativeFactory.h>
#import <react/renderer/components/NutsRnAppSpec/ComponentDescriptors.h>
#import <react/renderer/components/NutsRnAppSpec/Props.h>
#import <react/renderer/components/NutsRnAppSpec/RCTComponentViewHelpers.h>

#if __has_include("NutsRn-Swift.h")
#import "NutsRn-Swift.h"
#else
#import "NutsRn/NutsRn-Swift.h"
#endif

using namespace facebook::react;

@interface NativeAvatarComponentView () <RCTNativeAvatarViewProtocol>
@end

@implementation NativeAvatarComponentView {
  NativeAvatarContentView *_contentView;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const NativeAvatarProps>();
    _props = defaultProps;
    _contentView = [NativeAvatarContentView new];
    self.contentView = _contentView;
  }
  return self;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldAvatarProps = *std::static_pointer_cast<const NativeAvatarProps>(_props);
  const auto &newAvatarProps = *std::static_pointer_cast<const NativeAvatarProps>(props);
  if (oldAvatarProps.pubkey != newAvatarProps.pubkey) {
    [_contentView updatePubkey:RCTNSStringFromString(newAvatarProps.pubkey)];
  }
  if (oldAvatarProps.query != newAvatarProps.query) {
    [_contentView updateQuery:newAvatarProps.query];
  }
  if (oldAvatarProps.backgroundColor != newAvatarProps.backgroundColor) {
    [_contentView updateBackgroundColor:RCTNSStringFromString(newAvatarProps.backgroundColor)];
  }
  if (oldAvatarProps.borderColor != newAvatarProps.borderColor) {
    [_contentView updateBorderColor:RCTNSStringFromString(newAvatarProps.borderColor)];
  }
  [super updateProps:props oldProps:oldProps];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<NativeAvatarComponentDescriptor>();
}

static NSString *RCTNSStringFromString(const std::string &value)
{
  return value.empty() ? nil : [NSString stringWithUTF8String:value.c_str()];
}

@end

Class<RCTComponentViewProtocol> NativeAvatarCls(void)
{
  return NativeAvatarComponentView.class;
}
