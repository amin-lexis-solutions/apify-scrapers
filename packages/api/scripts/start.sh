DATABASE_URL=$DATABASE_URL_NON_POOLED
yarn prisma:migrate

node ../dist/server.js
