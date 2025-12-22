const CACHE_PREFIX = 'new-api-cache:';
const DEFAULT_TTL = 300;

export async function cacheGet<T>(key: string): Promise<T | null> {
  const cache = await caches.open('new-api');
  const cacheKey = new Request(`https://cache.local/${CACHE_PREFIX}${key}`);
  const response = await cache.match(cacheKey);

  if (!response) {
    return null;
  }

  try {
    return response.json<T>();
  } catch {
    return null;
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL
): Promise<void> {
  const cache = await caches.open('new-api');
  const cacheKey = new Request(`https://cache.local/${CACHE_PREFIX}${key}`);

  const response = new Response(JSON.stringify(value), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `max-age=${ttlSeconds}`,
    },
  });

  await cache.put(cacheKey, response);
}

export async function cacheDelete(key: string): Promise<void> {
  const cache = await caches.open('new-api');
  const cacheKey = new Request(`https://cache.local/${CACHE_PREFIX}${key}`);
  await cache.delete(cacheKey);
}

export async function cacheGetOrSet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  const value = await fetcher();
  await cacheSet(key, value, ttlSeconds);
  return value;
}
