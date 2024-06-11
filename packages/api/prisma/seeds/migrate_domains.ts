import { prisma } from '../../src/lib/prisma';

import { SOURCES_DATA } from '../../config/actors';

async function seedSources() {
  const activeSources = SOURCES_DATA.filter(
    (source) => source.apifyActorId !== null
  ) as any;

  for (const { apifyActorId, domains, name } of activeSources) {
    const existingSource = await prisma.source.findUnique({
      where: { apifyActorId: apifyActorId },
      include: { domains: true },
    });

    const existingDomains =
      existingSource?.domains.map((domain) => domain.domain) || [];
    const domainsToCreate: string[] = domains.filter(
      (d: any) => !existingDomains.includes(d.domain)
    );
    const domainsToDelete = existingDomains.filter(
      (domain) => !domains.map((d: any) => d.domain).includes(domain)
    );
    await prisma.source.upsert({
      where: { apifyActorId: apifyActorId },
      update: {
        name,
        domains: {
          create: domainsToCreate.map((d: any) => ({ domain: d.domain })),
          deleteMany: { domain: { in: domainsToDelete } },
        },
      },
      create: {
        name,
        apifyActorId,
        domains: {
          create: domains.map((d: any) => ({ domain: d.domain })),
        },
      },
    });

    console.log(
      `🌱 Seeded source ${name} with ${domains.length} domain(s):
    ${existingDomains.length} domain(s) already present
    ${domainsToCreate.length} domain(s) created
    ${domainsToDelete.length} domain(s) deleted`
    );
  }
}

seedSources()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
