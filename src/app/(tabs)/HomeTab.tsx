import React from 'react';

import {HomeFeed} from '../../feeds/HomeFeed';
import {useMainTabContext} from './_layout';

export default function HomeTabScreen() {
  const {nostrEnabled, scrollToTopKey, visible} = useMainTabContext('home');

  return (
    <HomeFeed
      enabled={nostrEnabled}
      scrollToTopKey={scrollToTopKey}
      visible={visible}
    />
  );
}
