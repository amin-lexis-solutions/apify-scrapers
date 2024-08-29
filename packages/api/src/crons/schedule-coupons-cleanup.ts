/* eslint-disable no-console */
import * as Sentry from '@sentry/node';
import { prisma } from '../lib/prisma';
import env from 'dotenv';
import dayjs from 'dayjs';

env.config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});

// Function to delete coupons older than 6 weeks
const deleteCouponStats = async () => {
  try {
    const olderThan = dayjs().subtract(6, 'weeks').toDate();

    const deleted = await prisma.couponStats.deleteMany({
      where: {
        createdAt: {
          lt: olderThan,
        },
      },
    });

    console.log(`Deleted ${deleted.count} coupon stats older than 6 weeks.`);
  } catch (error: any) {
    console.error('Error deleting coupons:', error);
    Sentry.captureException(error);
  }
};

const deleteProcessedRuns = async () => {
  try {
    const olderThan = dayjs().subtract(31, 'days').toDate();

    const deleted = await prisma.processedRun.deleteMany({
      where: {
        startedAt: {
          lt: olderThan,
        },
      },
    });

    console.log(`Deleted ${deleted.count} processed runs older than 31 days.`);
  } catch (error: any) {
    console.error('Error deleting processed runs:', error);
    Sentry.captureException(error);
  }
};

// Function to find and mark expired coupons
const markExpiredCoupons = async () => {
  try {
    // Update the isExpired field of the expired coupons
    const updatedCoupons = await prisma.coupon.updateMany({
      where: {
        expiryDateAt: {
          lt: new Date(),
        },
        OR: [
          {
            isExpired: null,
          },
          {
            isExpired: false,
          },
        ],
      },
      data: {
        isExpired: true,
        archivedAt: new Date(),
        archivedReason: 'expired',
      },
    });

    console.log(`Updated ${updatedCoupons.count} expired coupons.`);
  } catch (err) {
    console.error('Error updating expired coupons', err);
    Sentry.captureException(err);
  }
};

export async function main() {
  await deleteCouponStats();
  await markExpiredCoupons();
  await deleteProcessedRuns();
}

main()
  .catch((e) => {
    console.error(e);
    Sentry.captureException(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
