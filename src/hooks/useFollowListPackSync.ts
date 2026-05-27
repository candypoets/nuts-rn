import {useEffect} from 'react';
import {useFeedBuilderStore, useNostrStore} from '../stores';

export function useFollowListPackSync() {
  const follows = useNostrStore(state => state.follows);
  const setFollowListPack = useFeedBuilderStore(state => state.setFollowListPack);

  useEffect(() => {
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
  }, [follows, setFollowListPack]);
}
