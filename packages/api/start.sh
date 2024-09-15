#!/bin/bash

# Export environment variables to ensure availability for cron jobs
printenv > /app/packages/api/.env

# load environment variables to ensure availability for cron jobs
grep -E "^($(cut -d= -f1 /app/packages/api/.env.cron.example | paste -sd '|' -))=" /app/packages/api/.env > /etc/cron.d/cronjobs

# Add cron jobs to the cron service
cat /app/packages/api/src/crons/cronjobs >> /etc/cron.d/cronjobs
chmod 0644 /etc/cron.d/cronjobs
crontab /etc/cron.d/cronjobs # Load cron jobs into the cron service

# Start the cron service
service cron start

# Ensure the cron service is running
if ! service cron status; then
    echo "Failed to start the cron service."
    exit 1
fi

# Perform database migrations and handle potential failures
if ! DATABASE_URL=$DATABASE_URL_NON_POOLED yarn prisma:migrate; then
    echo "Failed to migrate the database."
    exit 1
fi
# Seed database ensuring the operation is idempotent
if ! DATABASE_URL=$DATABASE_URL_NON_POOLED yarn prisma:seed:target-locales; then
    echo "Failed to seed the database."
    exit 1
fi

# Seed database ensuring the operation is idempotent
if ! DATABASE_URL=$DATABASE_URL_NON_POOLED yarn prisma:seed:migrate-domains; then
    echo "Failed to seed the database."
    exit 1
fi

# Start the application server
node dist/api/src/server.js
