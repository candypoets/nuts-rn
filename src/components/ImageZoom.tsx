import { VideoView } from 'expo-video';
import { ChevronLeft, MoreHorizontal } from 'lucide-react-native';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentData } from '@candypoets/nipworker';
import { asKind1, fbArray } from '@candypoets/nipworker/utils';

import { useSharedVideoPlayer } from '../media/videoPlayers';
import { useUIStore, type UIStore } from '../stores/uiStore';
import { Avatar } from './notes/Avatar';
import { Footer } from './notes/Footer';
import { User } from './notes/User';

type ZoomLink = UIStore['imageZoom']['links'][number];

function zoomNoteText(note: NonNullable<UIStore['imageZoom']['note']>) {
  const kind1 = asKind1(note);
  if (!kind1) return '';

  return fbArray(kind1, 'parsedContent')
    .filter(block => {
      const dataType = block.dataType();
      return (
        dataType !== ContentData.ImageData &&
        dataType !== ContentData.VideoData &&
        dataType !== ContentData.MediaGroupData
      );
    })
    .map(block => block.text() || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampIndex(index: number | undefined, count: number) {
  if (!count) return 0;
  return Math.min(Math.max(index ?? 0, 0), count - 1);
}

export function ImageZoom() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const imageZoom = useUIStore(state => state.imageZoom);
  const setImageZoom = useUIStore(state => state.setImageZoom);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentImageZoomed, setCurrentImageZoomed] = useState(false);
  const listRef = useRef<FlatList<ZoomLink>>(null);
  const visible = imageZoom.zoomed !== undefined && imageZoom.links.length > 0;
  const links = imageZoom.links;
  const translateY = useSharedValue(0);
  const backgroundOpacity = useSharedValue(0);

  const close = useCallback(() => {
    setImageZoom({
      links: [],
      note: undefined,
      zoomed: undefined,
      gridId: '',
      videoTime: 0,
    });
  }, [setImageZoom]);

  useEffect(() => {
    if (!visible) return;
    const index = clampIndex(imageZoom.zoomed, links.length);
    setCurrentIndex(index);
    setCurrentImageZoomed(false);
    translateY.value = 0;
    backgroundOpacity.value = withTiming(1, { duration: 160 });
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: false });
    });
  }, [backgroundOpacity, imageZoom.zoomed, links.length, translateY, visible]);

  const dismiss = useCallback(() => {
    backgroundOpacity.value = withTiming(0, { duration: 140 });
    close();
  }, [backgroundOpacity, close]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backgroundOpacity.value,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} statusBarTranslucent animationType="fade">
      <View style={styles.modal}>
        <Animated.View style={[styles.backdrop, backdropStyle]} />
        <Animated.View style={[styles.content, contentStyle]}>
          <FlatList
            ref={listRef}
            data={links}
            keyExtractor={(item, index) => `${item.src}-${index}`}
            horizontal
            pagingEnabled
            scrollEnabled={!currentImageZoomed}
            bounces={false}
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, index) => ({
              length: width,
              offset: width * index,
              index,
            })}
            onMomentumScrollEnd={event => {
              setCurrentIndex(
                Math.round(event.nativeEvent.contentOffset.x / width),
              );
              setCurrentImageZoomed(false);
            }}
            renderItem={({ item, index }) => (
              <View style={[styles.page, { width, height }]}>
                <ZoomPage
                  link={item}
                  width={width}
                  height={height}
                  onDismiss={dismiss}
                  onZoomStateChange={zoomed => {
                    if (index === currentIndex) {
                      setCurrentImageZoomed(zoomed);
                    }
                  }}
                  overlayTranslateY={translateY}
                  backgroundOpacity={backgroundOpacity}
                />
              </View>
            )}
          />
        </Animated.View>
        <View
          pointerEvents="box-none"
          style={[styles.chrome, { paddingTop: insets.top + 12 }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close media"
            hitSlop={12}
            onPress={close}
            style={styles.closeButton}
          >
            <ChevronLeft size={28} color="#fff" strokeWidth={2.4} />
          </Pressable>
          {links.length > 1 ? (
            <Text style={styles.counter}>
              {currentIndex + 1} / {links.length}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More"
            hitSlop={12}
            style={styles.closeButton}
          >
            <MoreHorizontal size={25} color="#fff" strokeWidth={2.4} />
          </Pressable>
        </View>
        <ZoomNoteOverlay bottomInset={insets.bottom} />
      </View>
    </Modal>
  );
}

function ZoomNoteOverlay({ bottomInset }: { bottomInset: number }) {
  const note = useUIStore(state => state.imageZoom.note);
  const visible = useUIStore(state => state.imageZoom.zoomed !== undefined);

  if (!note) return null;

  const content = zoomNoteText(note);
  const pubkey = note.pubkey?.() || '';

  return (
    <View
      style={[
        styles.noteOverlay,
        { paddingBottom: Math.max(12, bottomInset + 8) },
      ]}
    >
      <View style={styles.noteCard}>
        <View style={styles.noteHeader}>
          {pubkey ? (
            <>
              <Avatar pubkey={pubkey} size="sm" link />
              <User
                pubkey={pubkey}
                link
                className="text-sm font-semibold text-white"
              />
            </>
          ) : null}
        </View>
        {content ? (
          <Text
            numberOfLines={3}
            style={styles.noteText}
          >
            {content}
          </Text>
        ) : null}
        <Footer note={note} visible={visible} mode="zoom" />
      </View>
    </View>
  );
}

const ZoomPage = memo(function ZoomPage({
  link,
  width,
  height,
  onDismiss,
  onZoomStateChange,
  overlayTranslateY,
  backgroundOpacity,
}: {
  link: ZoomLink;
  width: number;
  height: number;
  onDismiss: () => void;
  onZoomStateChange: (zoomed: boolean) => void;
  overlayTranslateY: SharedValue<number>;
  backgroundOpacity: SharedValue<number>;
}) {
  if (link.type === 'video') {
    return (
      <ZoomVideo
        link={link}
        height={height}
        onDismiss={onDismiss}
        overlayTranslateY={overlayTranslateY}
        backgroundOpacity={backgroundOpacity}
      />
    );
  }

  return (
    <ZoomImage
      link={link}
      width={width}
      height={height}
      onDismiss={onDismiss}
      onZoomStateChange={onZoomStateChange}
      overlayTranslateY={overlayTranslateY}
      backgroundOpacity={backgroundOpacity}
    />
  );
});

function ZoomImage({
  link,
  width,
  height,
  onDismiss,
  onZoomStateChange,
  overlayTranslateY,
  backgroundOpacity,
}: {
  link: ZoomLink;
  width: number;
  height: number;
  onDismiss: () => void;
  onZoomStateChange: (zoomed: boolean) => void;
  overlayTranslateY: SharedValue<number>;
  backgroundOpacity: SharedValue<number>;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const imageTranslateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const zoomState = useSharedValue(false);

  const syncZoomState = useCallback(
    (zoomed: boolean) => {
      onZoomStateChange(zoomed);
    },
    [onZoomStateChange],
  );

  const updateZoomState = (zoomed: boolean) => {
    'worklet';
    if (zoomState.value === zoomed) return;
    zoomState.value = zoomed;
    runOnJS(syncZoomState)(zoomed);
  };

  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), 4);
      updateZoomState(scale.value > 1.02);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        imageTranslateY.value = withSpring(0);
        savedX.value = 0;
        savedY.value = 0;
        updateZoomState(false);
      }
    });

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown(event => {
      const touch = event.allTouches[0];
      if (!touch) return;
      touchStartX.value = touch.absoluteX;
      touchStartY.value = touch.absoluteY;
    })
    .onTouchesMove((event, state) => {
      const touch = event.allTouches[0];
      if (!touch) return;
      if (scale.value <= 1.02) {
        state.fail();
        return;
      }
      const movedX = Math.abs(touch.absoluteX - touchStartX.value);
      const movedY = Math.abs(touch.absoluteY - touchStartY.value);
      if (Math.max(movedX, movedY) > 6) {
        state.activate();
      }
    })
    .onUpdate(event => {
      if (scale.value <= 1.02) return;
      translateX.value = savedX.value + event.translationX;
      imageTranslateY.value = savedY.value + event.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = imageTranslateY.value;
    });

  const dismissPan = Gesture.Pan()
    .activeOffsetY([-14, 14])
    .failOffsetX([-26, 26])
    .onUpdate(event => {
      if (scale.value > 1.02) return;
      overlayTranslateY.value = event.translationY;
      backgroundOpacity.value = Math.max(
        0.18,
        1 - Math.abs(event.translationY) / Math.max(280, height * 0.45),
      );
    })
    .onEnd(event => {
      if (scale.value > 1.02) return;
      const shouldClose =
        Math.abs(event.translationY) > 110 || Math.abs(event.velocityY) > 850;
      if (shouldClose) {
        overlayTranslateY.value = withTiming(
          event.translationY > 0 ? height : -height,
          { duration: 180 },
          () => runOnJS(onDismiss)(),
        );
        return;
      }
      overlayTranslateY.value = withTiming(0, { duration: 160 });
      backgroundOpacity.value = withTiming(1, { duration: 140 });
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(event => {
      const nextScale = scale.value > 1 ? 1 : 2.4;
      scale.value = withTiming(nextScale, { duration: 180 });
      savedScale.value = nextScale;
      updateZoomState(nextScale > 1.02);
      if (nextScale === 1) {
        translateX.value = withTiming(0, { duration: 180 });
        imageTranslateY.value = withTiming(0, { duration: 180 });
        savedX.value = 0;
        savedY.value = 0;
      } else {
        const offsetX = event.x - width / 2;
        const offsetY = event.y - height / 2;
        const nextX = -offsetX * (nextScale - 1);
        const nextY = -offsetY * (nextScale - 1);
        translateX.value = withTiming(nextX, { duration: 180 });
        imageTranslateY.value = withTiming(nextY, { duration: 180 });
        savedX.value = nextX;
        savedY.value = nextY;
      }
    });

  const gesture = Gesture.Simultaneous(doubleTap, pinch, pan, dismissPan);
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: imageTranslateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={styles.zoomImageWrap}>
        <Animated.Image
          source={{ uri: link.src }}
          resizeMode="contain"
          style={[styles.zoomImage, { width, height }, imageStyle]}
        />
      </Animated.View>
    </GestureDetector>
  );
}

function ZoomVideo({
  link,
  height,
  onDismiss,
  overlayTranslateY,
  backgroundOpacity,
}: {
  link: ZoomLink;
  height: number;
  onDismiss: () => void;
  overlayTranslateY: SharedValue<number>;
  backgroundOpacity: SharedValue<number>;
}) {
  const player = useSharedVideoPlayer(link.src);

  useEffect(() => {
    player.loop = false;
    player.muted = false;
    player.volume = 1;
    player.showNowPlayingNotification = false;
    player.staysActiveInBackground = false;
    player.play();
  }, [player]);

  const dismissPan = Gesture.Pan()
    .activeOffsetY([-14, 14])
    .failOffsetX([-26, 26])
    .onUpdate(event => {
      overlayTranslateY.value = event.translationY;
      backgroundOpacity.value = Math.max(
        0.18,
        1 - Math.abs(event.translationY) / Math.max(280, height * 0.45),
      );
    })
    .onEnd(event => {
      const shouldClose =
        Math.abs(event.translationY) > 110 || Math.abs(event.velocityY) > 850;
      if (shouldClose) {
        overlayTranslateY.value = withTiming(
          event.translationY > 0 ? height : -height,
          { duration: 180 },
          () => runOnJS(onDismiss)(),
        );
        return;
      }
      overlayTranslateY.value = withTiming(0, { duration: 160 });
      backgroundOpacity.value = withTiming(1, { duration: 140 });
    });

  return (
    <GestureDetector gesture={dismissPan}>
      <View style={styles.videoWrap}>
        <VideoView
          player={player}
          nativeControls
          contentFit="contain"
          allowsPictureInPicture={false}
          startsPictureInPictureAutomatically={false}
          style={styles.video}
        />
        {link.blurhash ? (
          <Image
            source={{ uri: link.blurhash }}
            resizeMode="contain"
            style={styles.videoPoster}
          />
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  modal: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1000,
  },
  backdrop: {
    bottom: 0,
    backgroundColor: '#020617',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  content: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomImageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  zoomImage: {
    maxWidth: '100%',
    maxHeight: '100%',
  },
  videoWrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    height: '100%',
    width: '100%',
  },
  videoPoster: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: -1,
  },
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  closeButton: {
    height: 56,
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
  },
  counter: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  noteCard: {
    gap: 8,
  },
  noteOverlay: {
    bottom: 0,
    left: 0,
    paddingHorizontal: 32,
    position: 'absolute',
    right: 0,
    zIndex: 3,
  },
  noteText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  noteHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
});
