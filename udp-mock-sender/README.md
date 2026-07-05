# UDP mock sender

A dependency-free Node script that simulates a rhythm-game song and streams
realistic SyncStart UDP score packets to the backend — so you can exercise the
whole live-scoreboard pipeline (UDP → WebSocket → frontend → JSON files →
Google Sheet) without a real StepMania/ITGmania cabinet.

It sends live **score-changed** packets on an interval while each player's score
and judgements accumulate from zero, then fires one **final-score** packet per
player when the song ends. The backend broadcasts the live packets to the
frontend and, on the final packets, writes `backend/scores/*.json` and appends a
row per player to the Google Sheet.

## Requirements

- Node.js 24+ (matches the backend/frontend).
- A **running backend** (see `../backend`). The backend refuses to start without
  `SPREADSHEET_ID` + a valid `keys.json`, and it appends the mock scores **for
  real** — point `backend/.env` at a throwaway spreadsheet/tab before running.

## Run

Usually you'll use the root orchestrators (`../mock.sh`, `../mock.ps1`,
`../mock.bat`) which start the backend + frontend, wait, then run this. To run
just the sender against an already-running backend:

```bash
npm start
```

## Configuration (`config.json`)

| Key                | Meaning                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| `target.host/port` | Where to send UDP (backend `SYNCSTART_UDP_PORT`, default `127.0.0.1:53000`).          |
| `song`             | Song name. **Must contain a `/`** (`"Group/Title"`) — the sheet stores the part after the first `/`. |
| `durationSeconds`  | Length of the simulated song.                                                        |
| `tickIntervalMs`   | How often a live (`0x02`) packet is sent per player.                                 |
| `chart.totalNotes` | Tap notes in the chart (drives point totals / judgement volume).                     |
| `chart.totalHolds` | Hold/roll notes; also sent as `totalHoldsCount`.                                     |
| `seed`             | RNG seed — the same seed reproduces the same run.                                    |
| `machines[]`       | Cosmetic grouping (a `name` + `players`). Machine names appear in logs only.         |
| `players[]`        | `playerNumber` (see below), `playerName`, `skill`, optional `forceFail`.             |

`skill` is one of `pro`, `good`, `average`, `beginner` — it sets the judgement
distribution (pros skew to W0/W1; beginners to W3/W4/miss) and how the lifebar
behaves. `forceFail: true` drains the lifebar to 0 so the player fails (useful
for testing the "failed players sink to the bottom" sort rule).

### Why `playerNumber` must be globally unique

The backend identifies a player by **source IP + `playerNumber`**. Every packet
from this one process arrives as `127.0.0.1`, so all players must use **distinct
`playerNumber`s (0, 1, 2, …)** or they'd collide into a single scoreboard entry.
The `machines` grouping is therefore labels only — it does **not** give each
machine its own source IP (Windows loopback only binds `127.0.0.1` by default,
so faking per-machine IPs isn't portable). The sender validates uniqueness and
exits with an error if two players share a number.

## What it does not do

- It doesn't write the JSON score files or talk to Google Sheets — the
  **backend** does both when it receives the final packets.
- Final scores where all of `W0..W4` are 0 are dropped by the backend for the
  sheet (they still get a JSON file). The skill profiles here always produce
  non-zero W0–W4, so every player yields a real row.

## Protocol summary

Each datagram = 1 raw type byte + a UTF-8, `|`-delimited body:

- `0x02` score changed (live, broadcast), `0x05` final score, `0x06` final marathon.
- Body field order (26 fields) matches `backend/parseMessage.js`; see
  `packet.js` and `backend/DOCUMENTATION.md` §5.
