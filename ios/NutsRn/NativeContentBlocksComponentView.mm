#import "NativeContentBlocksComponentView.h"

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

@interface NativeContentBlocksComponentView () <RCTNativeContentBlocksViewProtocol>
@end

@implementation NativeContentBlocksComponentView {
  NativeContentBlocksContentView *_contentView;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const NativeContentBlocksProps>();
    _props = defaultProps;
    _contentView = [NativeContentBlocksContentView new];
    self.contentView = _contentView;
  }

  return self;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldContentProps = *std::static_pointer_cast<const NativeContentBlocksProps>(_props);
  const auto &newContentProps = *std::static_pointer_cast<const NativeContentBlocksProps>(props);

  if (oldContentProps.noteId != newContentProps.noteId) {
    [_contentView updateNoteId:RCTNSStringFromString(newContentProps.noteId)];
  }
  if (oldContentProps.noteBytes != newContentProps.noteBytes) {
    [_contentView updateNoteBytes:RCTNSArrayFromIntVector(newContentProps.noteBytes)];
  }
  if (oldContentProps.relays != newContentProps.relays) {
    [_contentView updateRelays:RCTNSArrayFromStringVector(newContentProps.relays)];
  }
  if (oldContentProps.visible != newContentProps.visible) {
    [_contentView updateVisible:newContentProps.visible];
  }
  if (oldContentProps.main != newContentProps.main) {
    [_contentView updateMain:newContentProps.main];
  }
  if (oldContentProps.showQuote != newContentProps.showQuote) {
    [_contentView updateShowQuote:newContentProps.showQuote];
  }
  if (oldContentProps.showMedia != newContentProps.showMedia) {
    [_contentView updateShowMedia:newContentProps.showMedia];
  }
  if (oldContentProps.forceFullContent != newContentProps.forceFullContent) {
    [_contentView updateForceFullContent:newContentProps.forceFullContent];
  }
  if (oldContentProps.depth != newContentProps.depth) {
    [_contentView updateDepth:@(newContentProps.depth)];
  }
  if (oldContentProps.primaryTextColor != newContentProps.primaryTextColor) {
    [_contentView updatePrimaryTextColor:RCTNSStringFromString(newContentProps.primaryTextColor)];
  }
  if (oldContentProps.secondaryTextColor != newContentProps.secondaryTextColor) {
    [_contentView updateSecondaryTextColor:RCTNSStringFromString(newContentProps.secondaryTextColor)];
  }
  if (oldContentProps.baseContentColor != newContentProps.baseContentColor) {
    [_contentView updateBaseContentColor:RCTNSStringFromString(newContentProps.baseContentColor)];
  }
  if (oldContentProps.borderColor != newContentProps.borderColor) {
    [_contentView updateBorderColor:RCTNSStringFromString(newContentProps.borderColor)];
  }
  if (oldContentProps.accentColor != newContentProps.accentColor) {
    [_contentView updateAccentColor:RCTNSStringFromString(newContentProps.accentColor)];
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
  return concreteComponentDescriptorProvider<NativeContentBlocksComponentDescriptor>();
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

Class<RCTComponentViewProtocol> NativeContentBlocksCls(void)
{
  return NativeContentBlocksComponentView.class;
}
