#!/bin/bash

set -e

(trap 'kill 0' SIGINT; (cd frontend && npm start) & (cd backend && npm run dev))
