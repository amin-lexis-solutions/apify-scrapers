/* eslint-disable no-console */
import ProgressBar from 'progress';
import dotenv from 'dotenv';
import { prisma } from '../src/lib/prisma';
import { getMerchantsForLocale } from '../src/lib/oberst-api';

dotenv.config();

export const main = async () => {
  let totalMerchant = 0;
  const data: any = [];
  const locales = await prisma.targetLocale.findMany({
    select: {
      locale: true,
    },
  });

  const progressBar = new ProgressBar(
    'Processing :current/:total [:bar] :percent :etas',
    {
      total: locales.length,
    }
  );

  for (const locale of locales) {
    const merchants = await getMerchantsForLocale(locale.locale);
    totalMerchant = totalMerchant + merchants.length;
    data.push({ locale: locale.locale, merchants: merchants.length });
    progressBar.tick();
  }

  console.table(data);
  console.log(`Total locales: ${locales.length}`);
  console.log(`Total merchants: ${totalMerchant}`);
  const RunningCost = (totalMerchant / 1000) * 3.5;
  console.log(`Total SERP cost: ${RunningCost} USD`);
};

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
