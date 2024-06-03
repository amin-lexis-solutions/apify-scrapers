#!/bin/bash

# Setup for handling cron jobs within Docker
# echo "*/5 * * * * root cd /app/packages/api && yarn schedule:actors" >> /etc/crontab
echo "*/10 0-8 * * 1,4 root cd /app/packages/api && yarn schedule:find-serp" >> /etc/crontab

# run once a week 
echo "0 0 * * 1 root cd /app/packages/api && yarn schedule:find-serp-for-custom-malaysian-domains" >> /etc/crontab

# Run tests every monday
echo "*/10 * * * 1 root cd /app/packages/api && yarn schedule:tests" >> /etc/crontab

# Cron job to cleanup old data every day at 4:30 AM
echo "30 4 * * * root cd /app/packages/api && yarn schedule:periodic-coupons-cleanup" >> /etc/crontab

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
