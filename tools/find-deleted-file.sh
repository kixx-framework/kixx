#!/usr/bin/env bash
# find-deleted-file.sh — Search git history for deleted files matching a keyword
#
# Usage: ./find-deleted-file.sh <keyword>
# Example: ./find-deleted-file.sh "auth"

set -euo pipefail

if [ $# -eq 0 ]; then
    echo "Usage: $0 <keyword>"
    echo "Searches git history for deleted files whose path matches the keyword."
    exit 1
fi

KEYWORD="$1"

echo "Searching for deleted files matching: $KEYWORD"
echo ""

# List all files that were ever deleted, filtered by keyword
# --diff-filter=D  = only show deleted files
# --name-only      = show file paths, not diff content
# --pretty=format: = suppress commit header in favor of custom format below
git log --diff-filter=D --summary --pretty=format:"%H %ad %s" --date=short \
    | grep -E "(^[a-f0-9]{40}|delete mode)" \
    | awk '
        /^[a-f0-9]{40}/ { commit = $0; next }
        /delete mode/   { print commit " | " $NF }
    ' \
    | grep -i "$KEYWORD" \
    | while IFS='|' read -r commit_info filepath; do
        HASH=$(echo "$commit_info" | awk '{print $1}')
        DATE=$(echo "$commit_info" | awk '{print $2}')
        MSG=$(echo "$commit_info" | awk '{$1=$2=""; print substr($0,3)}')
        FILEPATH=$(echo "$filepath" | xargs)  # trim whitespace
        echo "File:    $FILEPATH"
        echo "Commit:  $HASH"
        echo "Date:    $DATE"
        echo "Message: $MSG"
        echo ""
    done
