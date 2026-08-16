import type {
  RequestObject,
  SubscriptionConfig,
  WorkerMessage,
} from '@candypoets/nipworker';
import {useSubscription} from '@candypoets/nipworker/hooks';

type SubscriptionCallback = (message: WorkerMessage) => void;

/**
 * Subscribe to a finite snapshot and close each relay after its EOSE.
 *
 * nipworker currently serializes every RequestObject as a separate NIP-01
 * REQ. Reusing one subscription id for overlapping requests lets the later
 * REQ replace the earlier one at the relay. Give each request its own stable
 * id so all filters can finish independently before they close.
 */
export function subscribeUntilEose(
  subscriptionId: string,
  requests: RequestObject[],
  callback: SubscriptionCallback,
  options: SubscriptionConfig = {},
): () => void {
  if (!requests.length) return () => undefined;

  const finiteOptions: SubscriptionConfig = {
    ...options,
    closeOnEose: true,
  };
  const splitRequests = requests.length > 1;
  const unsubscribes = requests.map((request, index) =>
    useSubscription(
      splitRequests ? `${subscriptionId}:eose:${index}` : subscriptionId,
      [request],
      callback,
      finiteOptions,
    ),
  );
  let active = true;

  return () => {
    if (!active) return;
    active = false;
    unsubscribes.forEach(unsubscribe => unsubscribe());
  };
}
