#!/bin/sh
set -e
node node_modules/.bin/node-pg-migrate up --dir dist/migrations
exec node dist/src/index.js
