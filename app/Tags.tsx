import {Stack, useLocalSearchParams, useRouter} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {TagsSub} from '../src/subs';

export default function TagsScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  // Pushed with object params this arrives as string[]; a plain string is
  // handled defensively (e.g. deep-link query params).
  const {tags} = useLocalSearchParams<{tags: string | string[]}>();

  const tagList = Array.isArray(tags) ? tags : tags ? [tags] : [];

  return (
    <>
      <Stack.Screen options={{animation: 'simple_push'}} />
      <TagsSub
        tags={tagList}
        visible={isFocused}
        onClose={() => router.back()}
      />
    </>
  );
}
