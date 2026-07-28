import React from 'react';

import {ChatFeed} from '../../src/feeds/ChatFeed';
import {useMainTabContext} from './_layout';

export default function ChatTabScreen() {
  const {nostrEnabled, scrollToTopKey, visible} = useMainTabContext('chat');

  return (
    <ChatFeed
      enabled={nostrEnabled}
      scrollToTopKey={scrollToTopKey}
      visible={visible}
    />
  );
}
