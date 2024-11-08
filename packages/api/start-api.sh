#!/bin/bash

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
node dist/api/src/api-service.js
