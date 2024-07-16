#!/bin/bash

# Setup for handling cron jobs within Docker
cp /app/packages/api/src/crons/cronjobs /etc/cron.d/
chmod 0644 /etc/cron.d/cronjobs
crontab /etc/cron.d/cronjobs

# Export environment variables to ensure availability for cron jobs
printenv >> /app/packages/api/.env

# Start the cron service
service cron start

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
