#!/bin/bash

# Setup for handling cron jobs within Docker
# echo "*/5 * * * * root cd /app/packages/api && yarn schedule:actors" >> /etc/crontab
echo "*/10 0-8 * * 1,4 root cd /app/packages/api && yarn schedule:find-serp" >> /etc/crontab

# Export environment variables to ensure availability for cron jobs
printenv >> /app/packages/api/src/.env.cron

# Start the cron service
service cron start

# Perform database migrations and handle potential failures
if ! DATABASE_URL=$DATABASE_URL_NON_POOLED yarn prisma:migrate; then
    echo "Failed to migrate the database."
    exit 1
fi

# Seed database ensuring the operation is idempotent
if ! DATABASE_URL=$DATABASE_URL_NON_POOLED yarn prisma:seed:migrate-domains; then
    echo "Failed to seed the database."
    exit 1
fi

# Start the application server
node dist/api/src/server.js
