#!/bin/bash
set -e
export NODE_ENV=test
for f in tests/*.js; do
  node "$f"
done
