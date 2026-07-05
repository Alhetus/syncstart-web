#!/bin/bash

set -e

(trap 'kill 0' SIGINT; (cd frontend && npm run build && npm run preview) & (cd backend && npm start))
