#!/bin/bash

set -e

(trap 'kill 0' SIGINT; (cd frontend && npm run build-and-serve) & (cd backend && npm start))
