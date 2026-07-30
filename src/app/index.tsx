import { Redirect } from 'expo-router';

// The dev-client opens the app at nutsrn:/// — land on the tabs' initial
// route (ExploreTab) instead of the unmatched-route screen.
export default function Index() {
  return <Redirect href="/ExploreTab" />;
}
