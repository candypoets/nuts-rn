import React from 'react';

import {ExploreFeed} from '../../feeds/ExploreFeed';
import {useMainTabContext} from './_layout';

export default function ExploreTabScreen() {
  const {nostrEnabled, scrollToTopKey, visible} =
    useMainTabContext('explore');

  return (
    <ExploreFeed
      enabled={nostrEnabled}
      scrollToTopKey={scrollToTopKey}
      visible={visible}
    />
  );
}
