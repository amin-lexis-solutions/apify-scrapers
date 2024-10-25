import { PrismaClient } from '@prisma/client';
import { Client } from 'pg'; // PostgreSQL client for remote connection
import { parse } from 'pg-connection-string';
import progress from 'progress';

const prisma = new PrismaClient();

async function updateCoupons() {
  // Connect to the remote PostgreSQL database
  const connectionString = process.env.DATABASE_BACKUP_URL;
  // parse the connection string
  const parsed = parse(connectionString || '');
  const remoteClient = new Client({
    host: parsed.host || '',
    port: parsed.port ? parseInt(parsed.port) : undefined,
    user: parsed.user || '',
    password: parsed.password,
    database: 'api',
    ssl: {
      rejectUnauthorized: false,
    },
  });

  await remoteClient.connect();

  try {
    // Fetch data from the remote database for the last 24 hours
    const res = await remoteClient.query(`
      SELECT id, "archivedReason", "archivedAt"
      FROM "Coupon"
      WHERE "archivedAt" BETWEEN (CURRENT_DATE - INTERVAL '1 day')
      AND (CURRENT_DATE - INTERVAL '1 second')
      AND "archivedReason" = 'manual';
    `);

    const remoteData = res.rows;

    console.log(`Found ${remoteData.length} coupons to restore`);
    const progressBar = new progress(
      'restoring coupons [:bar] :percent :etas',
      {
        total: remoteData.length,
        width: 50,
      }
    );

    const stats = {
      updated: 0,
      failed: 0,
    };

    // Update local database with the fetched data
    for (const row of remoteData) {
      try {
        await prisma.coupon.update({
          where: { id: row.id },
          data: {
            archivedAt: row.archivedAt,
            archivedReason: row.archivedReason,
          },
        });
        stats.updated++;
      } catch (error) {
        stats.failed++;
      }
      progressBar.tick();
    }

    console.log('Coupons updated successfully.');
    console.log(stats);
  } catch (error) {
    console.error('Error updating coupons:', error);
  } finally {
    await remoteClient.end(); // Close the remote connection
    await prisma.$disconnect(); // Disconnect Prisma client
  }
}

// Execute the update function
updateCoupons().catch((e) => {
  console.error(e);
  process.exit(1);
});
