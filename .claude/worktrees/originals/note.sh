#!/bin/bash
# Quick helper to add a note for Lisa and Ralph
# Usage: ./note.sh "Your message here"
#        ./note.sh            # Opens NOTES.md in $EDITOR

if [ -z "$1" ]; then
    ${EDITOR:-vim} NOTES.md
else
    DATE=$(date +%Y-%m-%d)
    # Insert note after "## Latest" line
    sed -i '' "/^## Latest$/a\\
\\
> **$DATE**: $1
" NOTES.md
    echo "✓ Added note to NOTES.md"
fi
