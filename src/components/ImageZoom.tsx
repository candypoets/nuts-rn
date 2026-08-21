import {VideoView} from 'expo-video';
import {Image} from 'expo-image';
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  Modal,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {Pause, Play, RotateCcw, Volume2, VolumeX} from 'lucide-react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {scheduleOnRN} from 'react-native-worklets';
import Animated, {
  ReduceMotion,
  cancelAnimation,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ContentData} from '@candypoets/nipworker';
import {
  asKind1,
  asKind20,
  asKind22,
  fbArray,
} from '@candypoets/nipworker/utils';

import {playExclusive, useSharedVideoPlayer} from '../media/videoPlayers';
import {useUIStore, type UIStore} from '../stores/uiStore';
import {Avatar} from './notes/Avatar';
import {Footer} from './notes/Footer';
import {User} from './notes/User';

type ZoomLink = UIStore['imageZoom']['links'][number];
const OrientationGate = NativeModules.OrientationGate as
  | {setImageZoomActive?: (active: boolean) => void}
  | undefined;
const DISMISS_DIRECTION_THRESHOLD = 10;
const DISMISS_VERTICAL_BIAS = 1.25;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.max(min, Math.min(max, value));
}

function project(velocity: number, decelerationRate = 0.998) {
  'worklet';
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  'worklet';
  return (
    (overshoot * dimension * constant) /
    (dimension + constant * Math.abs(overshoot))
  );
}

function zoomNoteText(note: NonNullable<UIStore['imageZoom']['note']>) {
  const kind20 = asKind20(note);
  const kind22 = asKind22(note);
  const mediaTitle = kind20?.title?.() || kind22?.title?.() || '';
  const mediaDescription =
    kind20?.description?.() || kind22?.description?.() || '';
  const mediaText = [mediaTitle, mediaDescription]
    .map(value => value.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (mediaText) return mediaText;

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
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const imageZoom = useUIStore(state => state.imageZoom);
  const setImageZoom = useUIStore(state => state.setImageZoom);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentImageZoomed, setCurrentImageZoomed] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const listRef = useRef<FlatList<ZoomLink>>(null);
  const visible = imageZoom.zoomed !== undefined && imageZoom.links.length > 0;
  const links = imageZoom.links;
  const isLandscape = width > height;
  const translateY = useSharedValue(0);
  const backgroundOpacity = useSharedValue(0);

  const close = useCallback(() => {
    setImageZoom({
      links: [],
      note: undefined,
      zoomed: undefined,
    });
  }, [setImageZoom]);

  useEffect(() => {
    if (!visible) return;
    const index = clampIndex(imageZoom.zoomed, links.length);
    setCurrentIndex(index);
    setCurrentImageZoomed(false);
    setChromeVisible(true);
    translateY.set(0);
    backgroundOpacity.set(withTiming(1, {duration: 160}));
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({index, animated: false});
    });
  }, [backgroundOpacity, imageZoom.zoomed, links.length, translateY, visible]);

  useEffect(() => {
    OrientationGate?.setImageZoomActive?.(visible);

    return () => {
      OrientationGate?.setImageZoomActive?.(false);
    };
  }, [visible]);

  const dismiss = useCallback(() => {
    backgroundOpacity.set(
      withTiming(0, {duration: 140}, finished => {
        if (finished) scheduleOnRN(close);
      }),
    );
  }, [backgroundOpacity, close]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backgroundOpacity.get(),
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: translateY.get()}],
  }));

  const toggleChrome = useCallback(() => {
    setChromeVisible(value => !value);
  }, []);

  const renderZoomPage = useCallback(
    ({item, index}: {item: ZoomLink; index: number}) => (
      <View style={[styles.page, {width, height}]}>
        <ZoomPage
          link={item}
          width={width}
          height={height}
          onDismiss={close}
          onToggleChrome={toggleChrome}
          onZoomStateChange={zoomed => {
            if (index === currentIndex) {
              setCurrentImageZoomed(zoomed);
            }
          }}
          overlayTranslateY={translateY}
          backgroundOpacity={backgroundOpacity}
        />
      </View>
    ),
    [
      backgroundOpacity,
      close,
      currentIndex,
      height,
      toggleChrome,
      translateY,
      width,
    ],
  );

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      statusBarTranslucent
      animationType="fade"
      onRequestClose={dismiss}
      supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
    >
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
              setChromeVisible(true);
            }}
            renderItem={renderZoomPage}
          />
        </Animated.View>
        <ZoomNoteOverlay
          bottomInset={insets.bottom}
          link={links[currentIndex]}
          visible={chromeVisible}
          compact={isLandscape}
        />
      </View>
    </Modal>
  );
}

function ZoomNoteOverlay({
  bottomInset,
  link,
  visible: chromeVisible,
  compact,
}: {
  bottomInset: number;
  link?: ZoomLink;
  visible: boolean;
  compact: boolean;
}) {
  const note = useUIStore(state => state.imageZoom.note);
  const zoomVisible = useUIStore(state => state.imageZoom.zoomed !== undefined);

  if (!note || !chromeVisible) return null;

  const content = zoomNoteText(note);
  const pubkey = note.pubkey?.() || '';

  return (
    <View
      style={[
        styles.noteOverlay,
        compact ? styles.noteOverlayCompact : null,
        {
          paddingBottom: compact
            ? Math.max(8, bottomInset)
            : Math.max(12, bottomInset + 8),
        },
      ]}
    >
      <View style={styles.noteCard}>
        <View style={styles.notePreviewPad}>
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
            <Text numberOfLines={compact ? 1 : 3} style={styles.noteText}>
              {content}
            </Text>
          ) : null}
          <Footer note={note} visible={zoomVisible} mode="zoom" />
        </View>
        {link?.type === 'video' ? <ZoomVideoControls src={link.src} /> : null}
      </View>
    </View>
  );
}

const ZoomPage = memo(function ZoomPage({
  link,
  width,
  height,
  onDismiss,
  onToggleChrome,
  onZoomStateChange,
  overlayTranslateY,
  backgroundOpacity,
}: {
  link: ZoomLink;
  width: number;
  height: number;
  onDismiss: () => void;
  onToggleChrome: () => void;
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
        onToggleChrome={onToggleChrome}
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

  const updateZoomState = useCallback(
    (zoomed: boolean) => {
      'worklet';
      if (zoomState.get() === zoomed) return;
      zoomState.set(zoomed);
      scheduleOnRN(syncZoomState, zoomed);
    },
    [syncZoomState, zoomState],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate(event => {
          const rawScale = savedScale.get() * event.scale;
          const nextScale =
            rawScale < 1
              ? 1 + rubberband(rawScale - 1, 1)
              : rawScale > 4
              ? 4 + rubberband(rawScale - 4, 1)
              : rawScale;
          scale.set(nextScale);
          updateZoomState(nextScale > 1.02);
        })
        .onEnd(event => {
          const settledScale = clamp(scale.get(), 1, 4);
          savedScale.set(settledScale);
          scale.set(
            withSpring(settledScale, {
              duration: 400,
              dampingRatio: 0.8,
              velocity: event.velocity,
              reduceMotion: ReduceMotion.System,
            }),
          );
          if (settledScale <= 1.02) {
            savedScale.set(1);
            scale.set(
              withSpring(1, {
                duration: 400,
                dampingRatio: 1,
                reduceMotion: ReduceMotion.System,
              }),
            );
            translateX.set(
              withSpring(0, {
                duration: 400,
                dampingRatio: 0.8,
                reduceMotion: ReduceMotion.System,
              }),
            );
            imageTranslateY.set(
              withSpring(0, {
                duration: 400,
                dampingRatio: 0.8,
                reduceMotion: ReduceMotion.System,
              }),
            );
            savedX.set(0);
            savedY.set(0);
            updateZoomState(false);
          }
        }),
    [
      imageTranslateY,
      savedScale,
      savedX,
      savedY,
      scale,
      translateX,
      updateZoomState,
    ],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .manualActivation(true)
        .onTouchesDown(event => {
          const touch = event.allTouches[0];
          if (!touch) return;
          touchStartX.set(touch.absoluteX);
          touchStartY.set(touch.absoluteY);
        })
        .onTouchesMove((event, state) => {
          const touch = event.allTouches[0];
          if (!touch) return;
          if (scale.get() <= 1.02) {
            state.fail();
            return;
          }
          const movedX = Math.abs(touch.absoluteX - touchStartX.get());
          const movedY = Math.abs(touch.absoluteY - touchStartY.get());
          if (Math.max(movedX, movedY) > 6) state.activate();
        })
        .onStart(() => {
          const currentX = translateX.get();
          const currentY = imageTranslateY.get();
          cancelAnimation(translateX);
          cancelAnimation(imageTranslateY);
          savedX.set(currentX);
          savedY.set(currentY);
        })
        .onUpdate(event => {
          const currentScale = scale.get();
          if (currentScale <= 1.02) return;
          const maxX = (width * (currentScale - 1)) / 2;
          const maxY = (height * (currentScale - 1)) / 2;
          const rawX = savedX.get() + event.translationX;
          const rawY = savedY.get() + event.translationY;
          translateX.set(
            rawX > maxX
              ? maxX + rubberband(rawX - maxX, width)
              : rawX < -maxX
              ? -maxX + rubberband(rawX + maxX, width)
              : rawX,
          );
          imageTranslateY.set(
            rawY > maxY
              ? maxY + rubberband(rawY - maxY, height)
              : rawY < -maxY
              ? -maxY + rubberband(rawY + maxY, height)
              : rawY,
          );
        })
        .onEnd(event => {
          const currentScale = scale.get();
          const maxX = (width * (currentScale - 1)) / 2;
          const maxY = (height * (currentScale - 1)) / 2;
          const targetX = clamp(translateX.get(), -maxX, maxX);
          const targetY = clamp(imageTranslateY.get(), -maxY, maxY);
          savedX.set(targetX);
          savedY.set(targetY);
          translateX.set(
            withSpring(targetX, {
              duration: 400,
              dampingRatio: 0.8,
              velocity: event.velocityX,
              reduceMotion: ReduceMotion.System,
            }),
          );
          imageTranslateY.set(
            withSpring(targetY, {
              duration: 400,
              dampingRatio: 0.8,
              velocity: event.velocityY,
              reduceMotion: ReduceMotion.System,
            }),
          );
        }),
    [
      height,
      imageTranslateY,
      savedX,
      savedY,
      scale,
      touchStartX,
      touchStartY,
      translateX,
      width,
    ],
  );

  const dismissPan = useDismissPan({
    blocked: zoomState,
    height,
    onDismiss,
    overlayTranslateY,
    backgroundOpacity,
  });

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(event => {
          const nextScale = scale.get() > 1 ? 1 : 2.4;
          savedScale.set(nextScale);
          updateZoomState(nextScale > 1);
          if (nextScale === 1) {
            savedX.set(0);
            savedY.set(0);
            scale.set(
              withSpring(1, {
                duration: 400,
                dampingRatio: 1,
                reduceMotion: ReduceMotion.System,
              }),
            );
            translateX.set(
              withSpring(0, {
                duration: 400,
                dampingRatio: 1,
                reduceMotion: ReduceMotion.System,
              }),
            );
            imageTranslateY.set(
              withSpring(0, {
                duration: 400,
                dampingRatio: 1,
                reduceMotion: ReduceMotion.System,
              }),
            );
            return;
          }

          const maxX = (width * (nextScale - 1)) / 2;
          const maxY = (height * (nextScale - 1)) / 2;
          const nextX = clamp(
            -(event.x - width / 2) * (nextScale - 1),
            -maxX,
            maxX,
          );
          const nextY = clamp(
            -(event.y - height / 2) * (nextScale - 1),
            -maxY,
            maxY,
          );
          savedX.set(nextX);
          savedY.set(nextY);
          scale.set(
            withSpring(nextScale, {
              duration: 400,
              dampingRatio: 1,
              reduceMotion: ReduceMotion.System,
            }),
          );
          translateX.set(
            withSpring(nextX, {
              duration: 400,
              dampingRatio: 1,
              reduceMotion: ReduceMotion.System,
            }),
          );
          imageTranslateY.set(
            withSpring(nextY, {
              duration: 400,
              dampingRatio: 1,
              reduceMotion: ReduceMotion.System,
            }),
          );
        }),
    [
      height,
      imageTranslateY,
      savedScale,
      savedX,
      savedY,
      scale,
      translateX,
      updateZoomState,
      width,
    ],
  );

  const gesture = useMemo(
    () => Gesture.Simultaneous(doubleTap, pinch, pan, dismissPan),
    [dismissPan, doubleTap, pan, pinch],
  );
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      {translateX: translateX.get()},
      {translateY: imageTranslateY.get()},
      {scale: scale.get()},
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={styles.zoomImageWrap}>
        <Animated.View style={[{width, height}, imageStyle]}>
          <Image
            source={{uri: link.src}}
            contentFit="contain"
            cachePolicy="memory-disk"
            style={styles.zoomImage}
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

function useDismissPan({
  height,
  onDismiss,
  overlayTranslateY,
  backgroundOpacity,
  blocked,
}: {
  height: number;
  onDismiss: () => void;
  overlayTranslateY: SharedValue<number>;
  backgroundOpacity: SharedValue<number>;
  blocked?: SharedValue<boolean>;
}) {
  const dismissStartX = useSharedValue(0);
  const dismissStartY = useSharedValue(0);
  const dismissContextY = useSharedValue(0);

  return useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .manualActivation(true)
        .onTouchesDown(event => {
          const touch = event.allTouches[0];
          if (!touch) return;
          dismissStartX.set(touch.absoluteX);
          dismissStartY.set(touch.absoluteY);
        })
        .onTouchesMove((event, state) => {
          const touch = event.allTouches[0];
          if (!touch) return;
          if (blocked?.get()) {
            state.fail();
            return;
          }

          const movedX = Math.abs(touch.absoluteX - dismissStartX.get());
          const movedY = Math.abs(touch.absoluteY - dismissStartY.get());
          if (
            movedY > DISMISS_DIRECTION_THRESHOLD &&
            movedY > movedX * DISMISS_VERTICAL_BIAS
          ) {
            state.activate();
            return;
          }
          if (movedX > DISMISS_DIRECTION_THRESHOLD && movedX > movedY) {
            state.fail();
          }
        })
        .onStart(() => {
          const currentY = overlayTranslateY.get();
          cancelAnimation(overlayTranslateY);
          cancelAnimation(backgroundOpacity);
          dismissContextY.set(currentY);
        })
        .onUpdate(event => {
          if (blocked?.get()) return;
          const nextY = dismissContextY.get() + event.translationY;
          overlayTranslateY.set(nextY);
          backgroundOpacity.set(
            Math.max(0.18, 1 - Math.abs(nextY) / Math.max(280, height * 0.45)),
          );
        })
        .onEnd(event => {
          if (blocked?.get()) return;
          const currentY = overlayTranslateY.get();
          const projectedY = currentY + project(event.velocityY);
          const shouldClose =
            Math.abs(currentY) > 110 || Math.abs(projectedY) > height * 0.32;
          if (shouldClose) {
            const direction =
              projectedY === 0
                ? Math.sign(currentY) || 1
                : Math.sign(projectedY);
            overlayTranslateY.set(
              withSpring(
                direction * height,
                {
                  duration: 300,
                  dampingRatio: 0.8,
                  velocity: event.velocityY,
                  overshootClamping: true,
                  reduceMotion: ReduceMotion.System,
                },
                finished => {
                  if (finished) scheduleOnRN(onDismiss);
                },
              ),
            );
            backgroundOpacity.set(withTiming(0, {duration: 180}));
            return;
          }
          overlayTranslateY.set(
            withSpring(0, {
              duration: 400,
              dampingRatio: 0.8,
              velocity: event.velocityY,
              reduceMotion: ReduceMotion.System,
            }),
          );
          backgroundOpacity.set(withTiming(1, {duration: 140}));
        }),
    [
      backgroundOpacity,
      blocked,
      dismissContextY,
      dismissStartX,
      dismissStartY,
      height,
      onDismiss,
      overlayTranslateY,
    ],
  );
}

function ZoomVideo({
  link,
  height,
  onDismiss,
  onToggleChrome,
  overlayTranslateY,
  backgroundOpacity,
}: {
  link: ZoomLink;
  height: number;
  onDismiss: () => void;
  onToggleChrome: () => void;
  overlayTranslateY: SharedValue<number>;
  backgroundOpacity: SharedValue<number>;
}) {
  return (
    <ExpoZoomVideo
      link={link}
      height={height}
      onDismiss={onDismiss}
      onToggleChrome={onToggleChrome}
      overlayTranslateY={overlayTranslateY}
      backgroundOpacity={backgroundOpacity}
    />
  );
}

function ExpoZoomVideo({
  link,
  height,
  onDismiss,
  onToggleChrome,
  overlayTranslateY,
  backgroundOpacity,
}: {
  link: ZoomLink;
  height: number;
  onDismiss: () => void;
  onToggleChrome: () => void;
  overlayTranslateY: SharedValue<number>;
  backgroundOpacity: SharedValue<number>;
}) {
  const player = useSharedVideoPlayer(link.src);

  useEffect(() => {
    player.loop = false;
    player.muted = false;
    player.volume = 1;
    player.timeUpdateEventInterval = 0.25;
    player.showNowPlayingNotification = false;
    player.staysActiveInBackground = false;
    playExclusive(player);
  }, [player]);

  const dismissPan = useDismissPan({
    height,
    onDismiss,
    overlayTranslateY,
    backgroundOpacity,
  });

  return (
    <GestureDetector gesture={dismissPan}>
      <View style={styles.videoWrap}>
        <VideoView
          player={player}
          nativeControls={false}
          contentFit="contain"
          allowsPictureInPicture={false}
          startsPictureInPictureAutomatically={false}
          style={styles.video}
        />
        {link.blurhash ? (
          <Image
            source={{uri: link.blurhash}}
            contentFit="contain"
            cachePolicy="memory-disk"
            style={styles.videoPoster}
          />
        ) : null}
        <Pressable
          accessibilityLabel="Toggle video focus mode"
          onPress={onToggleChrome}
          style={styles.videoTouch}
        />
      </View>
    </GestureDetector>
  );
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

function ZoomVideoControls({src}: {src: string}) {
  const player = useSharedVideoPlayer(src);
  const [playing, setPlaying] = useState(player.playing);
  const [muted, setMuted] = useState(player.muted);
  const [rate, setRate] = useState(player.playbackRate || 1);
  const [currentTime, setCurrentTime] = useState(player.currentTime || 0);
  const [duration, setDuration] = useState(player.duration || 0);
  const [ended, setEnded] = useState(false);
  const [trackWidth, setTrackWidth] = useState(1);

  useEffect(() => {
    const subscriptions = [
      player.addListener('playingChange', event => setPlaying(event.isPlaying)),
      player.addListener('mutedChange', event => setMuted(event.muted)),
      player.addListener('playbackRateChange', event =>
        setRate(event.playbackRate),
      ),
      player.addListener('timeUpdate', event => {
        setCurrentTime(event.currentTime);
        setDuration(player.duration || 0);
        if (player.duration > 0 && event.currentTime < player.duration - 0.25) {
          setEnded(false);
        }
      }),
      player.addListener('sourceLoad', event => {
        setDuration(event.duration || player.duration || 0);
        setEnded(false);
      }),
      player.addListener('playToEnd', () => setEnded(true)),
    ];

    setPlaying(player.playing);
    setMuted(player.muted);
    setRate(player.playbackRate || 1);
    setCurrentTime(player.currentTime || 0);
    setDuration(player.duration || 0);

    return () => {
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, [player]);

  const progress =
    duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  const togglePlayback = () => {
    if (playing) player.pause();
    else {
      if (ended) {
        player.currentTime = 0;
        setCurrentTime(0);
        setEnded(false);
      }
      player.play();
    }
  };

  const toggleRate = () => {
    const nextRate = rate >= 2 ? 1 : rate >= 1.5 ? 2 : 1.5;
    player.playbackRate = nextRate;
    setRate(nextRate);
  };

  return (
    <View style={styles.videoControls}>
      <Pressable
        accessibilityLabel="Seek video"
        hitSlop={{top: 8, bottom: 8}}
        onLayout={event =>
          setTrackWidth(Math.max(1, event.nativeEvent.layout.width))
        }
        onPress={event => {
          if (duration <= 0) return;
          const nextTime =
            duration *
            Math.min(1, Math.max(0, event.nativeEvent.locationX / trackWidth));
          player.currentTime = nextTime;
          setCurrentTime(nextTime);
          setEnded(nextTime >= duration - 0.25);
        }}
        style={styles.videoTrack}
      >
        <View style={styles.videoTrackRail}>
          <View
            style={[styles.videoTrackFill, {width: `${progress * 100}%`}]}
          />
        </View>
      </Pressable>
      <View style={[styles.videoControlsRow, styles.notePreviewPad]}>
        <Pressable
          accessibilityLabel={playing ? 'Pause video' : 'Play video'}
          onPress={togglePlayback}
          style={styles.videoControlButton}
        >
          {playing ? (
            <Pause color="#fff" size={24} />
          ) : (
            <Play color="#fff" size={24} />
          )}
        </Pressable>
        <Text style={styles.videoTime}>
          -{formatDuration(duration - currentTime)}
        </Text>
        <Pressable
          accessibilityLabel="Change playback speed"
          onPress={toggleRate}
          style={styles.videoSpeedButton}
        >
          <Text style={styles.videoSpeedText}>
            {rate.toFixed(rate % 1 ? 1 : 0)}x
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
          onPress={() => {
            player.muted = !muted;
            setMuted(!muted);
          }}
          style={styles.videoControlButton}
        >
          {muted ? (
            <VolumeX color="#fff" size={24} />
          ) : (
            <Volume2 color="#fff" size={24} />
          )}
        </Pressable>
        <Pressable
          accessibilityLabel="Replay video"
          onPress={() => {
            player.currentTime = 0;
            setCurrentTime(0);
            setEnded(false);
            player.play();
          }}
          style={styles.videoControlButton}
        >
          <RotateCcw color="#fff" size={24} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  modal: {
    backgroundColor: '#020617',
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
    height: '100%',
    width: '100%',
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
  videoTouch: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 2,
  },
  videoPoster: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: -1,
  },
  noteCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 16,
    gap: 8,
    marginHorizontal: 16,
    paddingVertical: 12,
  },
  notePreviewPad: {
    paddingHorizontal: 16,
  },
  noteOverlay: {
    bottom: 0,
    left: 0,
    paddingHorizontal: 0,
    position: 'absolute',
    right: 0,
    zIndex: 3,
  },
  noteOverlayCompact: {
    paddingHorizontal: 0,
  },
  noteText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
  },
  noteHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  videoControls: {
    gap: 6,
    width: '100%',
  },
  videoControlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 34,
    justifyContent: 'space-between',
    width: '100%',
  },
  videoControlButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 36,
  },
  videoSpeedButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    minWidth: 44,
  },
  videoSpeedText: {
    color: '#fff',
    fontSize: 21,
    fontWeight: '700',
    includeFontPadding: false,
  },
  videoTime: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
    includeFontPadding: false,
    minWidth: 54,
  },
  videoTrack: {
    height: 10,
    justifyContent: 'center',
  },
  videoTrackRail: {
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 999,
    height: 3,
    overflow: 'hidden',
    width: '100%',
  },
  videoTrackFill: {
    backgroundColor: '#fff',
    height: '100%',
  },
});
