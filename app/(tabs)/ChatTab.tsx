import React from 'react';

import {ChatFeed} from '../../src/feeds';
import {useMainTabContext} from './_layout';

export default function ChatTabScreen() {
  const {nostrEnabled, visible} = useMainTabContext('chat');

  return <ChatFeed enabled={nostrEnabled} visible={visible} />;
}
