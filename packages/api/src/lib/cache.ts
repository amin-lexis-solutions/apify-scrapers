import { LRUCache } from 'lru-cache';

export const couponMatchCache = new LRUCache<string, boolean>({
  max: 100000,
});
