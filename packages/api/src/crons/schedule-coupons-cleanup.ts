/* eslint-disable no-console */
import { prisma } from '../lib/prisma';
import dayjs from 'dayjs';

// Function to delete coupons older than 6 weeks
const deleteCoupons = async () => {
  const olderThan = dayjs().subtract(6, 'weeks').toDate();

  const deleted = await prisma.couponStats.deleteMany({
    where: {
      createdAt: {
        lt: olderThan,
      },
    },
  });

  console.log(`Deleted ${deleted.count} coupons older than 30 days`);
};

// Function to find and mark expired coupons
const markExpiredCoupons = async () => {
  try {
    // Update the isExpired field of the expired coupons
    const updatedCoupons = await prisma.coupon.updateMany({
      where: {
        expiryDateAt: {
          lt: new Date(), // Find coupons whose expiry date is before the current date/time
        },
        isExpired: false,
      },
      data: {
        isExpired: true,
      },
    });

    console.log(`Updated ${updatedCoupons.count} expired coupons.`);
  } catch (err) {
    console.log('Error updating expired coupons', err);
  }
};

export async function main() {
  await deleteCoupons();
  await markExpiredCoupons();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
