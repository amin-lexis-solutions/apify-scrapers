import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { getRedisClient } from '../lib/redis';

export async function healthCheck(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.path === '/health') {
    try {
      // Check database connection
      await prisma.$queryRaw`SELECT 1`;

      // Check Redis connection
      const redis = getRedisClient();
      await redis.ping();

      res.json({
        status: 'healthy',
        database: 'connected',
        queue: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      });
    }
  } else {
    next();
  }
}
