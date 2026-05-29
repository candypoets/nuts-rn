import {useEffect, useRef} from 'react';

const enabled = typeof __DEV__ !== 'undefined' && __DEV__;
const aggregateCounts = new Map<string, {commits: number; mounts: number; unmounts: number}>();
const changeCounts = new Map<string, Map<string, number>>();
let aggregateTimer: ReturnType<typeof setTimeout> | null = null;

function summarize(value: unknown) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === 'object') return 'object';
  return value;
}

function changedKeys(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
) {
  if (!previous) return Object.keys(next);
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(
    key => !Object.is(previous[key], next[key]),
  );
}

function flushAggregate() {
  aggregateTimer = null;
  if (!aggregateCounts.size) return;

  const rows = Array.from(aggregateCounts.entries()).map(([label, counts]) => {
    const changes = changeCounts.get(label);
    return {
      label,
      ...counts,
      changes: changes
        ? Object.fromEntries(
            Array.from(changes.entries()).sort((left, right) => right[1] - left[1]),
          )
        : undefined,
    };
  });
  aggregateCounts.clear();
  changeCounts.clear();
  console.log('[render-trace:aggregate]', rows);
}

function recordAggregate(
  label: string,
  field: keyof {commits: number; mounts: number; unmounts: number},
  changes: string[] = [],
) {
  if (!enabled) return;
  const counts = aggregateCounts.get(label) ?? {commits: 0, mounts: 0, unmounts: 0};
  counts[field] += 1;
  aggregateCounts.set(label, counts);
  if (changes.length) {
    const currentChanges = changeCounts.get(label) ?? new Map<string, number>();
    changes.forEach(change => {
      currentChanges.set(change, (currentChanges.get(change) ?? 0) + 1);
    });
    changeCounts.set(label, currentChanges);
  }
  if (!aggregateTimer) {
    aggregateTimer = setTimeout(flushAggregate, 1000);
  }
}

export function useRenderTrace(label: string, values: Record<string, unknown>) {
  const commitCountRef = useRef(0);
  const previousValuesRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    commitCountRef.current += 1;
    const previous = previousValuesRef.current;
    const changes = changedKeys(previous, values);
    previousValuesRef.current = values;

    console.log('[render-trace:commit]', {
      label,
      commits: commitCountRef.current,
      changes,
      values: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, summarize(value)]),
      ),
    });
  });

  useEffect(() => {
    if (!enabled) return undefined;
    console.log('[render-trace:mount]', {label});
    return () => {
      console.log('[render-trace:unmount]', {
        label,
        commits: commitCountRef.current,
      });
    };
  }, [label]);
}

export function useAggregateRenderTrace(label: string) {
  useEffect(() => {
    recordAggregate(label, 'commits');
  });

  useEffect(() => {
    recordAggregate(label, 'mounts');
    return () => recordAggregate(label, 'unmounts');
  }, [label]);
}

export function useAggregateRenderWhy(
  label: string,
  values: Record<string, unknown>,
) {
  const previousValuesRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    const previous = previousValuesRef.current;
    const changes = changedKeys(previous, values);
    previousValuesRef.current = values;
    recordAggregate(label, 'commits', changes);
  });

  useEffect(() => {
    recordAggregate(label, 'mounts');
    return () => recordAggregate(label, 'unmounts');
  }, [label]);
}

type ValueRenderCounts = {
  commits: number;
  mounts: number;
  unmounts: number;
  valueChanges: number;
};

const valueRenderCounts = new Map<string, ValueRenderCounts>();
let valueRenderTimer: ReturnType<typeof setTimeout> | null = null;

function flushValueRenderAggregate() {
  valueRenderTimer = null;
  if (!valueRenderCounts.size) return;

  const rows = Array.from(valueRenderCounts.entries())
    .map(([key, counts]) => ({key, ...counts}))
    .sort((left, right) => right.commits - left.commits);
  valueRenderCounts.clear();
  console.log('[render-value:aggregate]', rows);
}

function recordValueRender(
  key: string,
  field: keyof ValueRenderCounts,
) {
  if (!enabled) return;
  const counts = valueRenderCounts.get(key) ?? {
    commits: 0,
    mounts: 0,
    unmounts: 0,
    valueChanges: 0,
  };
  counts[field] += 1;
  valueRenderCounts.set(key, counts);
  if (!valueRenderTimer) {
    valueRenderTimer = setTimeout(flushValueRenderAggregate, 1000);
  }
}

export function useValueRenderTrace(
  label: string,
  id: string,
  value: unknown,
) {
  const previousValueRef = useRef<unknown>(undefined);
  const key = `${label}:${id}`;

  useEffect(() => {
    recordValueRender(key, 'commits');
    if (!Object.is(previousValueRef.current, value)) {
      previousValueRef.current = value;
      recordValueRender(key, 'valueChanges');
    }
  });

  useEffect(() => {
    recordValueRender(key, 'mounts');
    return () => recordValueRender(key, 'unmounts');
  }, [key]);
}
