import { VideoView, useVideoPlayer } from 'expo-video';
import { X } from 'lucide-react-native';
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

import { useUIStore, type UIStore } from '../stores/uiStore';

type ZoomLink = UIStore['imageZoom']['links'][number];

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
  const listRef = useRef<FlatList<ZoomLink>>(null);
  const visible = imageZoom.zoomed !== undefined && imageZoom.links.length > 0;
  const links = imageZoom.links;
  const translateY = useSharedValue(0);
  const backgroundOpacity = useSharedValue(0);

  const close = useCallback(() => {
    setImageZoom({ links: [], zoomed: undefined, gridId: '', videoTime: 0 });
  }, [setImageZoom]);

  useEffect(() => {
    if (!visible) return;
    const index = clampIndex(imageZoom.zoomed, links.length);
    setCurrentIndex(index);
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
            }}
            renderItem={({ item }) => (
              <View style={[styles.page, { width, height }]}>
                <ZoomPage
                  link={item}
                  width={width}
                  height={height}
                  onDismiss={dismiss}
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
            <X size={22} color="#fff" strokeWidth={2.4} />
          </Pressable>
          {links.length > 1 ? (
            <Text style={styles.counter}>
              {currentIndex + 1} / {links.length}
            </Text>
          ) : null}
          <View style={styles.closeButtonSpacer} />
        </View>
      </View>
    </Modal>
  );
}

const ZoomPage = memo(function ZoomPage({
  link,
  width,
  height,
  onDismiss,
  overlayTranslateY,
  backgroundOpacity,
}: {
  link: ZoomLink;
  width: number;
  height: number;
  onDismiss: () => void;
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
  overlayTranslateY,
  backgroundOpacity,
}: {
  link: ZoomLink;
  width: number;
  height: number;
  onDismiss: () => void;
  overlayTranslateY: SharedValue<number>;
  backgroundOpacity: SharedValue<number>;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const imageTranslateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), 4);
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
      }
    });

  const pan = Gesture.Pan()
    .onUpdate(event => {
      if (scale.value <= 1) return;
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
      overlayTranslateY.value = withSpring(0, { damping: 22, stiffness: 240 });
      backgroundOpacity.value = withTiming(1, { duration: 140 });
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const nextScale = scale.value > 1 ? 1 : 2.4;
      scale.value = withSpring(nextScale);
      savedScale.value = nextScale;
      if (nextScale === 1) {
        translateX.value = withSpring(0);
        imageTranslateY.value = withSpring(0);
        savedX.value = 0;
        savedY.value = 0;
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
  const player = useVideoPlayer(link.src, videoPlayer => {
    videoPlayer.loop = false;
    videoPlayer.muted = false;
    videoPlayer.showNowPlayingNotification = false;
    videoPlayer.staysActiveInBackground = false;
    videoPlayer.play();
  });
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
      overlayTranslateY.value = withSpring(0, { damping: 22, stiffness: 240 });
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
    height: 40,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.64)',
  },
  closeButtonSpacer: {
    height: 40,
    width: 40,
  },
  counter: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
