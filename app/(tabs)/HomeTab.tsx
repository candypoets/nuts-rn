import React from 'react';

import {HomeFeed} from '../../src/feeds';
import {useMainTabContext} from './_layout';

export default function HomeTabScreen() {
  const {nostrEnabled, visible} = useMainTabContext('home');

  return <HomeFeed enabled={nostrEnabled} visible={visible} />;
}
