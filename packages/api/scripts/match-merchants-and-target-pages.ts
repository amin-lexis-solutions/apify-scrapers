import ProgressBar from 'progress';
import dotenv from 'dotenv';
import { prisma } from '../src/lib/prisma';

dotenv.config();

const BATCH_SIZE = 100;

const args = process.argv.slice(2);

const fetchMerchants = async (match_disabled: boolean) => {
  const queryOptions = {
    include: { locale_relation: true },
    ...(match_disabled && { where: { disabledAt: null } }),
  };
  return await prisma.merchant.findMany(queryOptions);
};

const processMerchants = async () => {
  const merchants = await fetchMerchants(args[0] != '--match-all');

  const progressBar = new ProgressBar(
    'Processing :current/:total [:bar] :percent :etas',
    {
      total: merchants.length,
      width: 50,
    }
  );

  const stats: Record<string, any>[] = [];

  for (let i = 0; i < merchants.length; i += BATCH_SIZE) {
    const merchantBatch = merchants.slice(i, i + BATCH_SIZE);
    const updatePromises = merchantBatch.map(async (merchant) => {
      const locale = merchant.locale_relation.locale;
      const { count } = await prisma.targetPage.updateMany({
        where: {
          searchTerm: { startsWith: merchant.name },
          locale,
        },
        data: { merchantId: merchant.id },
      });

      stats.push({
        ID: merchant.id,
        locale: merchant.locale_relation.locale,
        merchant: merchant.name,
        count,
      });
    });

    await Promise.all(updatePromises);
    progressBar.tick(updatePromises.length);
  }

  return stats;
};

const summarizeStats = (stats: Record<string, any>[]) => {
  const summary = stats.reduce(
    (acc, { count }) => {
      if (count > 0) {
        acc.matched += 1;
      } else {
        acc.unmatched += 1;
      }
      return acc;
    },
    { matched: 0, unmatched: 0 }
  );

  console.log(`Merchants matched: ${summary.matched}`);
  console.log(`Merchants unmatched: ${summary.unmatched}`);
};

const main = async () => {
  try {
    const stats = await processMerchants();
    summarizeStats(stats);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

main();
