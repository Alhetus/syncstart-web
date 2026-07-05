# SyncStart monitor (backend)

Node service for the SyncStart feature of StepMania/ITGmania. It:

- listens for **UDP** score packets from the game (default port `53000`),
- parses them and broadcasts the sorted live scoreboard to **WebSocket** clients
  (default port `8080`) — consumed by the `frontend/`,
- on final scores, writes a JSON file into `scores/` and appends a row to a
  **Google Sheet** (batched every 5 seconds).

Plain JavaScript (ESM), no build step.

## Requirements

- Node.js 24 LTS (see `.nvmrc`)
- npm

## Setup

```bash
npm install
```

## Configuration

Configuration is read from environment variables, loaded from a local `.env`
via Node's built-in `--env-file-if-exists` (no dotenv dependency). Copy the
example and edit it:

```bash
cp .env.example .env
```

| Variable                               | Default     | Purpose                                              |
| -------------------------------------- | ----------- | ---------------------------------------------------- |
| `SYNCSTART_UDP_PORT`                   | `53000`     | UDP port the game sends score packets to             |
| `WEBSOCKET_PORT`                       | `8080`      | WebSocket port the frontend connects to              |
| `SPREADSHEET_ID`                       | _(required)_ | Target Google Sheet ID; server won't start without it |
| `SCORES_TAB_NAME`                      | `Scores`    | Sheet tab to append rows to                          |
| `GOOGLE_KEY_FILE`                      | `keys.json` | Service-account credentials path (local, gitignored) |
| `MAX_POSSIBLE_DANCE_POINTS_DIFFERENCE` | `100`       | Sort threshold (see `sortScores`)                    |

### Google credentials

Google Sheets logging needs a service-account key at `GOOGLE_KEY_FILE`
(`keys.json` by default). This file is **gitignored and must never be
committed**. The service account must have edit access to the target sheet.
On startup the server **requires** `SPREADSHEET_ID`, checks that the key file
exists, and verifies it can authenticate and reach the sheet — it exits with a
fatal error if any of these fail.

## Scripts

| Command          | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `npm start`      | Run the server                                       |
| `npm run dev`    | Run with `node --watch` (auto-restart on file edits) |
| `npm run lint`   | Run ESLint                                           |
| `npm run format` | Format with Prettier                                 |
