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
      const COST_LIMIT_USD = process.env.COST_LIMIT_USD;
      if (!COST_LIMIT_USD) {
        return new StandardResponse(`Cost limit is not set`, true);
      }

      const today = dayjs().startOf('day').toDate();

      const totalCost = await prisma.processedRun.aggregate({
        _sum: {
          costInUsdMicroCents: true,
        },
        where: {
          finishedAt: {
            gte: today,
          },
        },
      });

      const totalCostInUsdCents = Number(totalCost._sum.costInUsdMicroCents);
      const costLimitInUsdMicroCents = Number(COST_LIMIT_USD) * 100000000;

      if (totalCostInUsdCents >= costLimitInUsdMicroCents) {
        const totalCostInUsd = (totalCostInUsdCents / 100000000).toFixed(5);

        const message = `Cost limit reached for today. Total cost: ${totalCostInUsd} USD . Please try again tomorrow.`;

        Sentry.captureMessage(message);

        return new StandardResponse(message, true);
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
