// Import the Prisma client
import { prisma } from '../../src/lib/prisma';


async function migrateDomains() {
  // Get all sources
  const sources = await prisma.source.findMany();

  for (const source of sources) {
    // Split the domain field by comma if it contains multiple domains
    const domains = source.domain.split(',');

    for (const domain of domains) {
      // Create a new row in the SourceDomain table for each domain
      await prisma.sourceDomain.create({
        data: {
          domain: domain.trim(),
          sourceId: source.id,
        },
      });
    }
  }
}

migrateDomains()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });