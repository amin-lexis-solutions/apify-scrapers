#!/bin/bash

# Get the list of folders that have been modified in the packages/ directory since the last commit
packages=$(git diff --name-only HEAD^ packages/ | cut -d/ -f2 | cut -d/ -f1 | uniq)

# Function to run tests for a package
run_test() {
    local package=$1

    echo "Running tests for $package"
    # Check if the package has a jest.config.js file
    if [ -f packages/$package/jest.config.js ]; then
        # Run the test using the npm run test command
        cd packages/$package && npm install && npm run test
        # Check if the test failed
        if [ $? -ne 0 ]; then
            echo "Tests failed for $package"
            return 1
        fi
    else
        # If the package does not have a test file
        echo "Skipping test of $package as no test file found"
    fi
    return 0
}

# Run tests for each package in the list and track failures
failed=false
for package in $packages; do
    run_test $package
    status=$?
    if [ $status -ne 0 ]; then
        failed=true
    fi
done

# Wait for all background jobs to complete
wait

# Check if any test failed
if [ "$failed" = true ]; then
    echo "Some tests failed!"
    exit 1
else
    echo "All tests passed successfully!"
fi
