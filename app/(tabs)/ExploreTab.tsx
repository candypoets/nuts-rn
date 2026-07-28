import React from 'react';

import {ExploreFeed} from '../../src/feeds';
import {useMainTabContext} from './_layout';

export default function ExploreTabScreen() {
  const {nostrEnabled, visible} = useMainTabContext('explore');

  return <ExploreFeed enabled={nostrEnabled} visible={visible} />;
}
