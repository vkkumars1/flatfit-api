import NodeCache from 'node-cache';

// why: tiny in-memory cache keeps the hot discover list fast without Redis.
export const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

export function cacheKey(...parts: (string | number)[]): string {
  return parts.join(':');
}
