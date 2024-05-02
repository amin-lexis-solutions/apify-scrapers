#!/bin/bash


# Get the list of folders that have been modified in the packages/ directory since the last commit (excluding packages/api and packages/shared)
packages=$(git diff --name-only HEAD~1 packages/ | grep -v 'packages/api\|packages/shared' | cut -d/ -f2 | cut -d/ -f1 | uniq)

# Check if the packages/shared/ folder has been modified since the last commit
if git diff --name-only HEAD~1 packages/shared/ | grep -q 'packages/shared'; then
    # Get the list of all packages except packages/shared and packages/api
    packages=$(ls packages | grep -v 'shared\|api')
fi 


# Loop through the list of folders and deploy each package
for package in $packages
do
    # Check if the package has a ./src/main.ts file
    if [ -f packages/$package/src/main.ts ]; then
        # set the TYPE to "puppeteer" as default
        TYPE="puppeteer"
        # check if the file contain "prepareCheerioScraper" the update TYPE="cheerio" 
        if grep -q "prepareCheerioScraper" packages/$package/src/main.ts; then
            TYPE="cheerio"
        fi
        # the run this deploy-apify.js script with the package name and the type
        node scripts/deploy-apify.js $package $TYPE
        
    else
        # if the package does not have a ./src/main.ts file, skip the deployment
        echo "Skipping deployment of $package"
    fi
done

