#import "NativeNoteComponentView.h"

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

@interface NativeNoteComponentView () <RCTNativeNoteViewProtocol>
- (std::shared_ptr<const NativeNoteEventEmitter>)nativeNoteEventEmitter;
@end

@implementation NativeNoteComponentView {
  NativeNoteContentView *_contentView;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const NativeNoteProps>();
    _props = defaultProps;
    _contentView = [NativeNoteContentView new];
    __weak NativeNoteComponentView *weakSelf = self;
    _contentView.onHeightChange = ^(CGFloat height) {
      NativeNoteComponentView *strongSelf = weakSelf;
      if (!strongSelf) {
        return;
      }
      auto eventEmitter = [strongSelf nativeNoteEventEmitter];
      if (eventEmitter) {
        NativeNoteEventEmitter::OnHeightChange event;
        event.height = (double)height;
        eventEmitter->onHeightChange(event);
      }
    };
    _contentView.onNativeRoute = ^(NSString *route) {
      NativeNoteComponentView *strongSelf = weakSelf;
      if (!strongSelf || !route) {
        return;
      }
      auto eventEmitter = [strongSelf nativeNoteEventEmitter];
      if (eventEmitter) {
        NativeNoteEventEmitter::OnNativeRoute event;
        event.route = std::string([route UTF8String]);
        eventEmitter->onNativeRoute(event);
      }
    };
    self.contentView = _contentView;
  }

  return self;
}

- (std::shared_ptr<const NativeNoteEventEmitter>)nativeNoteEventEmitter
{
  return std::static_pointer_cast<const NativeNoteEventEmitter>(_eventEmitter);
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &oldNoteProps = *std::static_pointer_cast<const NativeNoteProps>(_props);
  const auto &newNoteProps = *std::static_pointer_cast<const NativeNoteProps>(props);

  if (oldNoteProps.noteId != newNoteProps.noteId) {
    [_contentView updateNoteId:RCTNSStringFromString(newNoteProps.noteId)];
  }
  if (oldNoteProps.noteBytes != newNoteProps.noteBytes) {
    [_contentView updateNoteBytes:RCTNSArrayFromIntVector(newNoteProps.noteBytes)];
  }
  if (oldNoteProps.contextBytes != newNoteProps.contextBytes) {
    [_contentView updateContextBytes:RCTNSArrayFromIntVector(newNoteProps.contextBytes)];
  }
  if (oldNoteProps.relays != newNoteProps.relays) {
    [_contentView updateRelays:RCTNSArrayFromStringVector(newNoteProps.relays)];
  }
  if (oldNoteProps.visible != newNoteProps.visible) {
    [_contentView updateVisible:newNoteProps.visible];
  }
  if (oldNoteProps.footer != newNoteProps.footer) {
    [_contentView updateFooter:newNoteProps.footer];
  }
  if (oldNoteProps.main != newNoteProps.main) {
    [_contentView updateMain:newNoteProps.main];
  }
  if (oldNoteProps.showQuote != newNoteProps.showQuote) {
    [_contentView updateShowQuote:newNoteProps.showQuote];
  }
  if (oldNoteProps.showMedia != newNoteProps.showMedia) {
    [_contentView updateShowMedia:newNoteProps.showMedia];
  }
  if (oldNoteProps.forceFullContent != newNoteProps.forceFullContent) {
    [_contentView updateForceFullContent:newNoteProps.forceFullContent];
  }
  if (oldNoteProps.showRoot != newNoteProps.showRoot) {
    [_contentView updateShowRoot:newNoteProps.showRoot];
  }
  if (oldNoteProps.threadCard != newNoteProps.threadCard) {
    [_contentView updateThreadCard:newNoteProps.threadCard];
  }
  if (oldNoteProps.disableOpen != newNoteProps.disableOpen) {
    [_contentView updateDisableOpen:newNoteProps.disableOpen];
  }
  if (oldNoteProps.depth != newNoteProps.depth) {
    [_contentView updateDepth:@(newNoteProps.depth)];
  }
  if (oldNoteProps.leading != newNoteProps.leading) {
    [_contentView updateLeading:newNoteProps.leading];
  }
  if (oldNoteProps.tailing != newNoteProps.tailing) {
    [_contentView updateTailing:newNoteProps.tailing];
  }
  if (oldNoteProps.primaryTextColor != newNoteProps.primaryTextColor) {
    [_contentView updatePrimaryTextColor:RCTNSStringFromString(newNoteProps.primaryTextColor)];
  }
  if (oldNoteProps.secondaryTextColor != newNoteProps.secondaryTextColor) {
    [_contentView updateSecondaryTextColor:RCTNSStringFromString(newNoteProps.secondaryTextColor)];
  }
  if (oldNoteProps.baseContentColor != newNoteProps.baseContentColor) {
    [_contentView updateBaseContentColor:RCTNSStringFromString(newNoteProps.baseContentColor)];
  }
  if (oldNoteProps.cardBackgroundColor != newNoteProps.cardBackgroundColor) {
    [_contentView updateCardBackgroundColor:RCTNSStringFromString(newNoteProps.cardBackgroundColor)];
  }
  if (oldNoteProps.borderColor != newNoteProps.borderColor) {
    [_contentView updateBorderColor:RCTNSStringFromString(newNoteProps.borderColor)];
  }
  if (oldNoteProps.accentColor != newNoteProps.accentColor) {
    [_contentView updateAccentColor:RCTNSStringFromString(newNoteProps.accentColor)];
  }

  [super updateProps:props oldProps:oldProps];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<NativeNoteComponentDescriptor>();
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

Class<RCTComponentViewProtocol> NativeNoteCls(void)
{
  return NativeNoteComponentView.class;
}
