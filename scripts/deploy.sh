#!/bin/bash
 
# Set the maximum number of concurrent deployments (based on the Apify plan memory limit)
MAX_CONCURRENT_RUNS=${MAX_CONCURRENT_RUNS}
APIFY_GET_ALL_RUNS_URL="https://api.apify.com/v2/actor-runs?token=${APIFY_TOKEN}&status=RUNNING"

if [ -z "$MAX_CONCURRENT_RUNS" ]; then
    echo "MAX_CONCURRENT_RUNS is not set, stopping the deployment"
    exit 1
fi

# Get the list of folders that have been modified in the packages/ directory since the last commit (excluding packages/api and packages/shared)
packages=$(git diff --name-only HEAD^ packages/ | grep -v 'packages/api\|packages/shared' | cut -d/ -f2 | cut -d/ -f1 | uniq)

# Check if the packages/shared/ folder has been modified since the last commit
if git diff --name-only HEAD^ packages/shared/ | grep -q 'packages/shared'; then
    # Get the list of all packages except packages/shared and packages/api
    packages=$(ls packages | grep -v 'shared\|api')
fi

# Function to deploy a package
deploy_package() {
    local package=$1

    # Check if the package has a ./src/main.ts file
    if [ -f packages/$package/src/main.ts ]; then
        # Set the TYPE to "puppeteer" as default
        local TYPE="puppeteer"
        # Check if the file contains "prepareCheerioScraper" and update TYPE="cheerio"
        if grep -q "prepareCheerioScraper" packages/$package/src/main.ts; then
            TYPE="cheerio"
        fi
        # Deploy the package using the deploy-apify.js script
        cd packages/$package && node ../../scripts/deploy-apify.js $package $TYPE
    else
        # If the package does not have a ./src/main.ts file, skip the deployment
        echo "Skipping deployment of $package"
    fi
}

# Function to fetch and calculate maxConcurrency
fetch_max_concurrency() {
    response=$(curl -s -H "Content-Type: application/json" "$APIFY_GET_ALL_RUNS_URL")
    runningActorCount=$(echo $response | jq '[.data.items[]] | length')
    maxConcurrency=$((MAX_CONCURRENT_RUNS - runningActorCount))
    echo $maxConcurrency
}


# Deploy each package in the list in parallel
for package in $packages; do

    # Initial fetch
    maxConcurrency=$(fetch_max_concurrency)

    for i in {1..5}; do
        if [ $maxConcurrency -gt 0 ]; then
            break
        fi
        echo "Waiting for available concurrency $i/5 retries remaining..."
        sleep 120 # Sleep for 2 minutes
        maxConcurrency=$(fetch_max_concurrency)
    done

    if [ $maxConcurrency -le 0 ]; then
        echo "Max concurrency reached, skipping deployment of $package"
        continue
    fi

    # Deploy the package in the background
    deploy_package $package &
    # Wait for 2 background jobs to complete limit is set based on apify plan memory limit
    if [ $(jobs -p | wc -l) -ge $maxConcurrency ]; then
        echo "Waiting for available concurrency..."
        wait
    fi
    echo "Deployed $package successfully 🚀"
done

wait  # Wait for all background jobs to complete

echo "All deployments completed successfully! 🚀"
echo "total deployments: $(echo $packages | wc -w)"
