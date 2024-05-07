#!/bin/bash

# Runs every day at 1 AM
echo "0 1 * * * root cd /app/test && yarn schedule:test" >> /etc/crontab

# Start the cron service
service cron start