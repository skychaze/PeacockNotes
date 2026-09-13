export type DiscoveryCachePhase = 'idle' | 'loading' | 'ready' | 'failed';

export type DiscoveryCacheSnapshot<T> = Readonly<{
  phase: DiscoveryCachePhase;
  value: T;
  error: unknown | null;
  updatedAt: number | null;
}>;

export type DiscoveryCache<T> = Readonly<{
  getSnapshot: () => DiscoveryCacheSnapshot<T>;
  subscribe: (listener: (snapshot: DiscoveryCacheSnapshot<T>) => void) => () => void;
  ensure: () => Promise<DiscoveryCacheSnapshot<T>>;
  refresh: () => Promise<DiscoveryCacheSnapshot<T>>;
  update: (updater: (value: T) => T) => void;
  invalidate: () => void;
}>;

/**
 * A process-lifetime async cache for expensive discovery work.
 *
 * `ensure` reuses a successful value, while `refresh` starts one new load when
 * no load is already in flight. An invalidated cache keeps its last value so
 * consumers can render stale-but-known data while the refresh is running.
 */
export const createDiscoveryCache = <T>(
  initialValue: T,
  loader: () => Promise<T>,
): DiscoveryCache<T> => {
  let snapshot: DiscoveryCacheSnapshot<T> = {
    phase: 'idle',
    value: initialValue,
    error: null,
    updatedAt: null,
  };
  let inFlight: Promise<DiscoveryCacheSnapshot<T>> | null = null;
  const listeners = new Set<(next: DiscoveryCacheSnapshot<T>) => void>();

  const emit = () => {
    listeners.forEach((listener) => listener(snapshot));
  };

  const refresh = (): Promise<DiscoveryCacheSnapshot<T>> => {
    if (inFlight) return inFlight;
    snapshot = { ...snapshot, phase: 'loading', error: null };
    emit();
    inFlight = (async () => {
      try {
        snapshot = {
          phase: 'ready',
          value: await loader(),
          error: null,
          updatedAt: Date.now(),
        };
      } catch (error: unknown) {
        snapshot = { ...snapshot, phase: 'failed', error };
      }
      emit();
      return snapshot;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensure: () => snapshot.phase === 'ready' ? Promise.resolve(snapshot) : refresh(),
    update: (updater) => {
      snapshot = { ...snapshot, value: updater(snapshot.value), error: null };
      emit();
    },
    refresh,
    invalidate: () => {
      if (snapshot.phase === 'idle') return;
      snapshot = { ...snapshot, phase: 'idle', error: null };
      emit();
    },
  };
};
