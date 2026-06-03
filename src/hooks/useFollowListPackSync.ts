import { useEffect } from 'react';
import { useFeedBuilderStore, useNostrStore } from '../stores';

export function useFollowListPackSync() {
  const follows = useNostrStore(state => state.follows);
  const kind3UpdatedAt = useNostrStore(state => state.kind3UpdatedAt);
  const setFollowListPack = useFeedBuilderStore(
    state => state.setFollowListPack,
  );

  useEffect(() => {
    if (kind3UpdatedAt === 0) return;

    setFollowListPack({
      id: 'followlist',
      kind: 39089,
      title: 'Follow List',
      description: 'People you follow',
      image: null,
      localImage: 'followlist',
      people: follows,
      dTag: 'followlist',
    });
  }, [follows, kind3UpdatedAt, setFollowListPack]);
}
