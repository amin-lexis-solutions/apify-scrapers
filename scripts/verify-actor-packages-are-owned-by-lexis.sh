#!/bin/bash

# Fetches a list of actor names from the Apify console.
LEXIS_ACTORS=$(curl -s -H "Authorization: Bearer $APIFY_ORG_TOKEN_LEXIS" "https://api.apify.com/v2/acts?limit=1000" | jq -r '.data.items[] | select(.username == "lexis-solutions") | .name')

# Retrieves a list of directory names within the 'packages' directory.
PACKAGE_ACTORS=$(find packages -mindepth 1 -maxdepth 1 -type d ! -name 'shared' ! -path '*/api' -exec basename {} \;)

exit_code=0

# Loop iterates through each directory name in 'PACKAGE_ACTORS'.
for actor in $PACKAGE_ACTORS; do
  # check if the current actor has not been shared on Apify
    if [[ ! $LEXIS_ACTORS =~ "${actor}-scraper" ]]; then
        echo "Actor $actor has a package in the codebase but is not an actor in the Lexis Apify organization."
        # Exit with code 2
        exit_code=2
    fi
done

exit $exit_code
