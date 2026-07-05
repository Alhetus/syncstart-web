#!/bin/bash

set -e

(trap 'kill 0' SIGINT; (cd frontend && npm run dev) & (cd backend && npm run dev))
