import { prisma } from '../lib/prisma'; // Adjust the path according to your project structure
import dayjs from 'dayjs';
import { StandardResponse } from '../utils/validators';
import * as Sentry from '@sentry/node';

// CostLimit decorator to limit the cost of the API calls
export function CostLimit() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const costLimit = process.env.COST_LIMIT_USD;
      if (!costLimit) {
        return new StandardResponse(`Cost limit is not set`, true);
      }

      const today = dayjs().startOf('day').toDate();

      const totalCost = await prisma.processedRun.aggregate({
        _sum: {
          costInUsdCents: true,
        },
        where: {
          finishedAt: {
            gte: today,
          },
        },
      });

      const totalCostInUsdCents = Number(totalCost._sum.costInUsdCents);
      const costLimitInUsdCents = Number(costLimit) * 1000;

      if (totalCostInUsdCents >= costLimitInUsdCents) {
        const totalCostInUsd = (totalCostInUsdCents / 1000).toFixed(2);

        const message = `Cost limit reached for today. Total cost: ${totalCostInUsd} USD . Please try again tomorrow.`;

        Sentry.captureMessage(message);

        return new StandardResponse(message, true);
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
