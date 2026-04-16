#!/bin/bash

# Script to count total RequestCreated events using The Graph pagination
# This version works without jq by using basic string parsing

ENDPOINT="https://api.studio.thegraph.com/query/116914/kaleido-finance/v1.0.1"
total_count=0
skip=0
batch_size=1000

echo "Counting total RequestCreated events..."
echo "======================================"

while true; do
    echo "Fetching batch starting at $skip..."
    
    # Make the GraphQL query
    result=$(curl -s -X POST \
      -H "Content-Type: application/json" \
      -d "{\"query\": \"{ requestCreateds(first: $batch_size, skip: $skip) { id } }\"}" \
      $ENDPOINT)
    
    # Check for basic errors
    if [[ "$result" == *"errors"* ]]; then
        echo "Error occurred in API response"
        echo "$result"
        break
    fi
    
    # Count occurrences of "id": in the response (each represents one record)
    batch_count=$(echo "$result" | grep -o '"id":' | wc -l)
    
    # Handle case where wc -l might return spaces
    batch_count=$(echo $batch_count | tr -d ' ')
    
    if [ -z "$batch_count" ] || [ "$batch_count" -eq 0 ]; then
        echo "No more results found."
        break
    fi
    
    total_count=$((total_count + batch_count))
    
    echo "  → Found $batch_count requests in this batch"
    echo "  → Running total: $total_count"
    
    # If we got less than the batch size, we've reached the end
    if [ "$batch_count" -lt "$batch_size" ]; then
        echo "Reached end of results (batch smaller than $batch_size)"
        break
    fi
    
    # Move to next batch
    skip=$((skip + batch_size))
    
    # Add a longer delay and safety check
    sleep 0.5
    
    # Safety check to prevent infinite loops
    if [ "$skip" -gt 100000 ]; then
        echo "Safety limit reached (100k+). Stopping to prevent infinite loop."
        echo "Current count: $total_count"
        break
    fi
done

echo "======================================"
echo "FINAL TOTAL: $total_count RequestCreated events"
echo "======================================"