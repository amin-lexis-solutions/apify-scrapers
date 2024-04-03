echo "*/5 * * * * root cd /app/packages/api && yarn schedule:actors" >> /etc/crontab
printenv >> /app/packages/api/src/.env.cron
service cron start

DATABASE_URL=$DATABASE_URL_NON_POOLED yarn prisma:migrate

node dist/src/server.js
