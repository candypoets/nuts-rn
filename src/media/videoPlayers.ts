import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { useEffect, useMemo } from 'react';

type RegistryEntry = {
  player: VideoPlayer;
  refs: number;
};

const players = new Map<string, RegistryEntry>();

function configureBasePlayer(player: VideoPlayer) {
  player.showNowPlayingNotification = false;
  player.staysActiveInBackground = false;
}

export function retainVideoPlayer(src: string) {
  let entry = players.get(src);
  if (!entry) {
    const player = createVideoPlayer(src);
    configureBasePlayer(player);
    entry = { player, refs: 0 };
    players.set(src, entry);
  }
  entry.refs += 1;
  return entry.player;
}

export function releaseVideoPlayer(src: string) {
  const entry = players.get(src);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  players.delete(src);
  entry.player.pause();
  entry.player.release();
}

export function useSharedVideoPlayer(src: string) {
  const player = useMemo(() => retainVideoPlayer(src), [src]);

  useEffect(() => () => releaseVideoPlayer(src), [src]);

  return player;
}
