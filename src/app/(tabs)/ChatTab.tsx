import React from 'react';

import {ChatFeed} from '../../feeds/ChatFeed';
import {useMainTabContext} from './_layout';

export default function ChatTabScreen() {
  const {isFocused, nostrEnabled, scrollToTopKey, visible} =
    useMainTabContext('chat');

  return (
    <ChatFeed
      enabled={nostrEnabled}
      scrollToTopKey={scrollToTopKey}
      visible={visible}
      screenActive={isFocused}
    />
  );
}
