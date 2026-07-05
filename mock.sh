#!/bin/bash

# Boots the backend + frontend, waits a few seconds, then runs the UDP mock
# sender against them. Ctrl+C tears everything down. The backend runs with
# `npm start` (not `npm run dev`) so writing score files can't trigger a
# --watch restart mid-run.
#
# Requires backend/.env (SPREADSHEET_ID) + backend/keys.json — point them at a
# throwaway sheet, since final scores are appended for real.

set -e

(
  trap 'kill 0' SIGINT

  (cd backend && npm start) &
  (cd frontend && npm run dev) &

  echo "Waiting 6s for backend + frontend to start..."
  sleep 6

  (cd udp-mock-sender && npm start)

  echo ""
  echo "Tester finished. Final scores flush to the sheet within ~5s."
  echo "Backend + frontend are still running — press Ctrl+C to stop everything."
  wait
)
