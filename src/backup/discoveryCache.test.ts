import { createDiscoveryCache } from './discoveryCache';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

export async function testDiscoveryCacheReusesSuccessfulLoad() {
  let loads = 0;
  const cache = createDiscoveryCache('initial', async () => {
    loads += 1;
    await Promise.resolve();
    return `value-${loads}`;
  });

  const first = await cache.ensure();
  const second = await cache.ensure();
  assert(first.value === 'value-1' && second.value === 'value-1', 'cache did not reuse its value');
  assert(loads === 1, 'cache repeated a successful load');
}

export async function testDiscoveryCacheDeduplicatesInFlightLoad() {
  let loads = 0;
  let release: (() => void) | null = null;
  const cache = createDiscoveryCache('initial', () => {
    loads += 1;
    return new Promise<string>((resolve) => { release = () => resolve('loaded'); });
  });

  const first = cache.ensure();
  const second = cache.refresh();
  assert(loads === 1, 'cache started duplicate in-flight loads');
  const unblock = release as (() => void) | null;
  if (!unblock) throw new Error('in-flight loader did not expose a release function');
  unblock();
  const [left, right] = await Promise.all([first, second]);
  assert(left.value === 'loaded' && right.value === 'loaded', 'in-flight callers saw different values');
}

export async function testDiscoveryCacheInvalidationKeepsStaleValueDuringRefresh() {
  let loads = 0;
  let release: (() => void) | null = null;
  const cache = createDiscoveryCache('initial', () => {
    loads += 1;
    if (loads === 1) return Promise.resolve('loaded');
    return new Promise<string>((resolve) => {
    release = () => resolve('refreshed');
    });
  });

  await cache.ensure();
  cache.invalidate();
  const pending = cache.ensure();
  assert(cache.getSnapshot().phase === 'loading', 'invalidated cache did not enter loading state');
  assert(cache.getSnapshot().value === 'loaded', 'cache discarded its last known value');
  const unblock = release as (() => void) | null;
  if (!unblock) throw new Error('refresh loader did not expose a release function');
  unblock();
  const result = await pending;
  assert(result.phase === 'ready' && result.value === 'refreshed', 'cache refresh did not publish the new value');
}

export async function testDiscoveryCacheUpdatePublishesWithoutReloading() {
  let loads = 0;
  const cache = createDiscoveryCache({ items: ['a', 'b'] }, async () => {
    loads += 1;
    return { items: ['a', 'b'] };
  });
  await cache.ensure();
  cache.update((value) => ({ items: value.items.filter((item) => item !== 'a') }));
  assert(cache.getSnapshot().value.items.join(',') === 'b', 'cache update did not publish the transformed value');
  assert(loads === 1, 'cache update unexpectedly reloaded the provider');
}

export async function runDiscoveryCacheTests() {
  await testDiscoveryCacheReusesSuccessfulLoad();
  await testDiscoveryCacheDeduplicatesInFlightLoad();
  await testDiscoveryCacheInvalidationKeepsStaleValueDuringRefresh();
  await testDiscoveryCacheUpdatePublishesWithoutReloading();
}

void runDiscoveryCacheTests().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
