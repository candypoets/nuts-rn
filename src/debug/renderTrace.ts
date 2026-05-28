import {useEffect, useRef} from 'react';

const enabled = typeof __DEV__ !== 'undefined' && __DEV__;
const aggregateCounts = new Map<string, {commits: number; mounts: number; unmounts: number}>();
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

  const rows = Array.from(aggregateCounts.entries()).map(([label, counts]) => ({
    label,
    ...counts,
  }));
  aggregateCounts.clear();
  console.log('[render-trace:aggregate]', rows);
}

function recordAggregate(label: string, field: keyof {commits: number; mounts: number; unmounts: number}) {
  if (!enabled) return;
  const counts = aggregateCounts.get(label) ?? {commits: 0, mounts: 0, unmounts: 0};
  counts[field] += 1;
  aggregateCounts.set(label, counts);
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
