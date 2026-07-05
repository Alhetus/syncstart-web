# SyncStart monitor (frontend)

A live scoreboard for ITGmania. It connects to the SyncStart
backend over a WebSocket and renders animated life bars and judgement counts for
each player.

Built with [Vite](https://vite.dev/) + [React 19](https://react.dev/), plain
JavaScript, styled with plain CSS.

## Requirements

- Node.js 24 LTS (see `.nvmrc`)
- npm

## Setup

```bash
npm install
```

## Configuration

The WebSocket URL defaults to `ws://localhost:8080/`. To override it, copy
`.env.example` to `.env.local` and set `VITE_WEBSOCKET_URL`.

## Scripts

| Command           | Description                                        |
| ----------------- | -------------------------------------------------- |
| `npm run dev`     | Start the Vite dev server on http://localhost:3000 |
| `npm run build`   | Build the production bundle into `dist/`           |
| `npm run preview` | Serve the built bundle on http://localhost:3000    |
| `npm run lint`    | Run ESLint                                         |
| `npm run format`  | Format the codebase with Prettier                  |

The app needs live data from the backend (or a mock WebSocket) to display any
bars; without a connection it renders an empty board and keeps retrying.
