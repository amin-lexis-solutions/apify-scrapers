import Redis from 'ioredis';
import { logger } from 'shared/logger';

let redisClient: Redis | null = null;

export async function setupRedis(): Promise<Redis> {
  if (redisClient) {
    return redisClient;
  }
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is not set');
  }

  redisClient = new Redis(process.env.REDIS_URL, {
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000); // 2 seconds max delay
      return delay;
    },
  });

  redisClient.on('error', (error) => {
    logger.error('Redis Client Error:', error);
  });

  redisClient.on('connect', () => {
    logger.info('Connected to Redis');
  });

  return redisClient;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }
  return redisClient;
}
