# Backend documentation

This document explains how the SyncStart backend works internally: its
architecture, the data flow from a UDP packet to a rendered scoreboard, the
**UDP packet format** it consumes, and the **outgoing WebSocket message format**
it produces.

For setup, configuration variables, and scripts, see [`README.md`](./README.md).

---

## 1. Overview

The backend is a stateless-ish relay that sits between the game (StepMania /
ITGmania with the SyncStart feature) and the web frontend. It does three things:

1. **Receives** UDP score packets from the game.
2. **Broadcasts** a sorted live scoreboard to all connected WebSocket clients
   (the `frontend/`).
3. **Persists** final scores: writes a JSON file into `scores/` and appends a
   row to a Google Sheet (batched every 5 seconds).

It is plain JavaScript (ESM), Node.js 24+, with no build step.

```
                 UDP :53000                    WebSocket :8080
   ┌──────────┐  score packets  ┌───────────┐  scoreboard JSON  ┌──────────┐
   │  Game    │ ───────────────▶│  backend  │ ─────────────────▶│ frontend │
   │(ITGmania)│                 │ (index.js)│                   │ (browser)│
   └──────────┘                 └─────┬─────┘                   └──────────┘
                                      │ final scores (batched, 5s)
                                      ▼
                          ┌───────────────────────┐
                          │ scores/*.json          │
                          │ Google Sheet (append)  │
                          └───────────────────────┘
```

---

## 2. Modules

| File               | Responsibility                                                                                                                      |
| ------------------ |-------------------------------------------------------------------------------------------------------------------------------------|
| `index.js`         | Entry point. Wires config, the UDP server, the WebSocket server, server state, the Google Sheets flush loop, and graceful shutdown. |
| `parseMessage.js`  | Decodes a pipe-delimited UDP score body into a structured score object.                                                             |
| `scoring.js`       | Builds the scoreboard comparator (`makeSortScores`) used to rank players.                                                           |
| `googleSheets.js`  | Thin, config-injected wrapper around the Google Sheets API (`verifyAccess`, `appendScores`).                                        |

`parseMessage.js`, `scoring.js`, and `googleSheets.js` are all pure/config-injected
(they read no environment variables of their own); `index.js` owns all
configuration and I/O.

---

## 3. Startup and lifecycle

`start()` in `index.js` validates the environment before binding any port:

1. **`SPREADSHEET_ID` is required** — the server exits with a fatal error if it
   is unset (its whole purpose is to log scores).
2. **Credentials file must exist** at `GOOGLE_KEY_FILE` (default `keys.json`,
   resolved relative to the backend directory).
3. **Access is verified** — it authenticates and calls `verifyAccess()` to
   confirm the service account can actually reach the target sheet. Any failure
   is fatal.

Only after these checks pass does it:

- start the `WebSocketServer` on `WEBSOCKET_PORT`,
- start the 5-second Google Sheets flush interval,
- register `SIGINT` / `SIGTERM` handlers, and
- bind the UDP socket on `SYNCSTART_UDP_PORT`.

The UDP socket is created up front but only **bound** at the end of `start()`,
since binding the port is the point of no return.

**Graceful shutdown** (`shutdown()`): on `SIGINT`/`SIGTERM` it clears the flush
interval, flushes any remaining queued scores to the sheet, then closes both
servers. It is guarded against running twice.

**Fatal error handling:** UDP and WebSocket server `error` events call
`process.exit(1)`. Per-client WebSocket `error` events are only logged, so one
bad client socket cannot crash the process.

---

## 4. Data flow (per packet)

Every UDP datagram triggers the `udpServer.on("message")` handler:

1. **Classify by the first byte** (see [§5](#5-udp-packet-format)). Non-score
   packets are ignored.
2. **Strip the type byte** and decode the rest as a UTF-8 string
   (`buffer.slice(1).toString("utf-8")`).
3. **`processMessage()`**:
   - `parseMessage()` decodes the pipe-delimited body into a score object.
   - **Validation** (`isValidScore`): the packet is dropped unless
     `playerNumber`, `actualDancePoints`, `currentPossibleDancePoints`, and
     `possibleDancePoints` all parsed to finite numbers. This keeps `NaN` out of
     the comparator, the broadcast, and the sheet.
   - A **score key** is derived as `` `${address} ${playerNumber}` `` — this
     uniquely identifies a player on a machine (the sender IP plus the in-game
     player slot). It becomes the score's `id`.
   - **Branch on packet type:**
     - **Final** score / final marathon score (`0x05` / `0x06`): write a JSON
       file to `scores/` and push a row onto the Google Sheets send queue
       (`storeScoreForSending`).
     - **Score changed** (`0x02`): update in-memory `serverState`
       (`updateServerState`).
4. **Broadcast:** for *score changed* messages only, if `serverState` exists,
   the current scoreboard JSON is sent to all connected clients.

### Server state

`serverState` holds the currently-playing song and its scores:

```js
{
  currentSong: "<song>",              // the song from the latest packet
  scores: { [scoreKey]: scoreData },  // latest score per player
  sortedScores: [scoreData, ...]      // scores sorted by the comparator
}
```

When a packet arrives with a **different `song`** than `currentSong`, the state
is **reset** — a new song wipes the previous scoreboard. Otherwise the player's
entry is updated in place and `sortedScores` is re-sorted.

### Scoreboard sorting (`scoring.js`)

`makeSortScores(MAX_POSSIBLE_DANCE_POINTS_DIFFERENCE)` returns a comparator with
these rules:

1. **Failed players sink** — a non-failed score always ranks above a failed one.
2. If the two players are at very different points in the song (their
   `currentPossibleDancePoints` differ by more than
   `MAX_POSSIBLE_DANCE_POINTS_DIFFERENCE`, default `100`), rank by **percentage
   completed** (`actualDancePoints / possibleDancePoints`, clamped to `[0,1]`,
   0 if the divisor is 0).
3. Otherwise (players roughly in sync), rank by **fewest dance points lost so
   far** (`currentPossibleDancePoints - actualDancePoints`).

### Final-score persistence

For final and final-marathon scores:

- A JSON file is written to `scores/` named
  `` `${Date.now()}_${song-with-/-replaced-by-_}_${playerName}.json` ``, run
  through `sanitizeFilename` (strips filesystem-illegal and control characters,
  caps length at 255, falls back to `"unnamed"`).
- The score is queued for Google Sheets. **Scores where every judgment window
  `W0`–`W4` is 0 are treated as irrelevant and skipped** (they represent a
  non-played / empty result).

### Google Sheets flush loop

`flushScoresToSheet()` runs every 5 seconds:

- A `flushing` guard prevents overlapping flushes.
- The queued batch is spliced off the queue up front, then appended via
  `googleSheets.appendScores()`.
- On failure the batch is **unshifted back to the front** of the queue and
  retried on the next tick — so scores are never double-sent or dropped.

Rows are appended to `` `${SCORES_TAB_NAME}!A:R` `` with
`valueInputOption: "USER_ENTERED"`.

### Backpressure

`broadcast()` skips any client whose `bufferedAmount` exceeds
`MAX_CLIENT_BUFFERED_BYTES` (512 KiB) — a slow client can't stall the server or
grow memory without bound. Each `send` is wrapped in try/catch so a closing
socket can't throw.

---

## 5. UDP packet format

The game sends one UDP datagram per score event to `SYNCSTART_UDP_PORT`
(default `53000`).

### Framing

```
┌────────────┬─────────────────────────────────────────────┐
│ byte 0     │ bytes 1..n                                    │
│ type       │ UTF-8, pipe-delimited (`|`) score body        │
└────────────┴─────────────────────────────────────────────┘
```

- **Byte 0 — packet type:**

  | Byte   | Meaning                | Handling                                              |
  | ------ | ---------------------- | ----------------------------------------------------- |
  | `0x02` | Score changed (live)   | Update `serverState`, broadcast to WebSocket clients. |
  | `0x05` | Final score            | Write JSON file + queue for Google Sheets.            |
  | `0x06` | Final marathon score   | Write JSON file + queue for Google Sheets.            |
  | other  | —                      | Ignored.                                              |

- **Bytes 1..n — body:** the type byte is stripped, the remainder decoded as
  UTF-8 and split on `|`.

### Body fields (in order)

The body is exactly the fields below, in this order, `|`-separated. Numeric
fields are parsed with `parseInt`/`parseFloat`; `isFailed` is the string `"1"`
for failed.

| # | Field                     | Type    | Notes                                                                         |
| - | ------------------------- | ------- |-------------------------------------------------------------------------------|
| 0 | `song`                    | string  | e.g. `"<group>/<title>"`. The Sheet stores only the part after the first `/`. |
| 1 | `playerNumber`            | int     | In-game player slot.                                                          |
| 2 | `playerName`              | string  |                                                                               |
| 3 | `actualDancePoints`       | int     | Dance points earned so far.                                                   |
| 4 | `currentPossibleDancePoints` | int  | Max points achievable up to the current point in the song.                    |
| 5 | `possibleDancePoints`     | int     | Max points achievable for the whole chart.                                    |
| 6 | `formattedScore`          | string  | Pre-formatted percentage/score string from the game.                          |
| 7 | `life`                    | float   | Lifebar value.                                                                |
| 8 | `isFailed`                | bool    | `"1"` → `true`, anything else → `false`.                                      |
| 9 | `tapNote.none`            | int     | TapNoteScore counts follow (ITGmania judgment windows).                       |
| 10 | `tapNote.hitMine`        | int     |                                                                               |
| 11 | `tapNote.avoidMine`      | int     |                                                                               |
| 12 | `tapNote.checkpointMiss` | int     |                                                                               |
| 13 | `tapNote.miss`           | int     |                                                                               |
| 14 | `tapNote.W5`             | int     | Widest window … (worst timing)                                                |
| 15 | `tapNote.W4`             | int     |                                                                               |
| 16 | `tapNote.W3`             | int     |                                                                               |
| 17 | `tapNote.W2`             | int     |                                                                               |
| 18 | `tapNote.W1`             | int     |                                                                               |
| 19 | `tapNote.W0`             | int     | Tightest window (best timing).                                                |
| 20 | `tapNote.checkpointHit`  | int     |                                                                               |
| 21 | `holdNote.none`          | int     | HoldNoteScore counts follow.                                                  |
| 22 | `holdNote.letGo`         | int     |                                                                               |
| 23 | `holdNote.held`          | int     |                                                                               |
| 24 | `holdNote.missed`        | int     |                                                                               |
| 25 | `totalHoldsCount`        | int     | Total holds/rolls in the chart.                                               |

> **Judgment windows:** `W0` is the tightest (Blue Fantastic) and
> `W5` the widest (WayOff); the exact labels depend on the game/theme (e.g. ITGmania vs.
> StepMania). The backend does not interpret them beyond the "all of W0–W4 are
> zero ⇒ irrelevant" rule for the Sheet.

### Parsed object shape

`parseMessage()` returns:

```js
{
  song,
  playerNumber,
  playerName,
  actualDancePoints,
  currentPossibleDancePoints,
  possibleDancePoints,
  formattedScore,
  life,
  isFailed,
  tapNote: {
    none,
    hitMine,
    avoidMine,
    checkpointMiss,
    miss,
    W5,
    W4,
    W3,
    W2,
    W1,
    W0,
    checkpointHit
  },
  holdNote: {
    none,
    letGo,
    held,
    missed
  },
  totalHoldsCount
}
```

Before storage/broadcast, `index.js` adds an `id` field (the score key,
`` `${senderIP} ${playerNumber}` ``).

---

## 6. Outgoing WebSocket message format

The frontend connects to `WEBSOCKET_PORT` (default `8080`). The server sends a
single JSON message shape, as a **text frame**, in two situations:

- **On connect:** if a `serverState` already exists, the newly-connected client
  immediately receives the current scoreboard (so it isn't blank until the next
  packet).
- **On every *score changed* (`0x02`) packet:** the updated scoreboard is
  broadcast to all connected clients.

> Final-score (`0x05` / `0x06`) packets do **not** trigger a broadcast — they go
> to disk and the Sheet only.

### Shape

```json
{
  "song": "<group>/<title>",
  "scores": [ /* score objects, already sorted best→worst */ ]
}
```

- `song` — the current song (`serverState.currentSong`).
- `scores` — the ranked array (`sortedScores`), already ordered by the
  comparator in [§4](#scoreboard-sorting-scoringjs). The frontend renders them
  in array order.

Each entry in `scores` is the full parsed score object plus `id`:

```json
{
  "id": "192.168.1.42 0",
  "song": "MyGroup/My Song",
  "playerNumber": 1,
  "playerName": "Alice",
  "actualDancePoints": 12345,
  "currentPossibleDancePoints": 12800,
  "possibleDancePoints": 25000,
  "formattedScore": "96.44",
  "life": 0.87,
  "isFailed": false,
  "tapNote": {
    "none": 0,
    "hitMine": 0,
    "avoidMine": 0,
    "checkpointMiss": 0,
    "miss": 2,
    "W5": 1,
    "W4": 3,
    "W3": 10,
    "W2": 40,
    "W1": 120,
    "W0": 300,
    "checkpointHit": 0
  },
  "holdNote": {
    "none": 0,
    "letGo": 1,
    "held": 20,
    "missed": 0
  },
  "totalHoldsCount": 21
}
```

- `id` uniquely identifies a player on a machine (sender IP + player slot); the
  frontend can use it as a stable React key.
- The message is JSON serialized once per broadcast and sent to every eligible
  client.

### Client contract

The frontend (`frontend/src/useWebSocket.js`) simply forwards each message's
raw `event.data` to a handler and **auto-reconnects** 1 second after any close.
There is no server-side ping/keepalive or acknowledgement protocol; the message
above is the entire wire contract.

---

## 7. Google Sheets row format

For reference, `storeScoreForSending()` builds each appended row in this column
order (appended to range `A:R` of `SCORES_TAB_NAME`):

| Col | Value                             |
| --- | --------------------------------- |
| A   | song title (`song.split("/")[1]`) |
| B   | `playerName`                      |
| C   | `parseFloat(formattedScore)`      |
| D   | `isFailed`                        |
| E   | `tapNote.W0`                      |
| F   | `tapNote.W1`                      |
| G   | `tapNote.W2`                      |
| H   | `tapNote.W3`                      |
| I   | `tapNote.W4`                      |
| J   | `tapNote.W5`                      |
| K   | `tapNote.miss`                    |
| L   | `tapNote.hitMine`                 |
| M   | `holdNote.held`                   |
| N   | `holdNote.letGo`                  |
| O   | `totalHoldsCount`                 |
| P   | `actualDancePoints`               |
| Q   | `possibleDancePoints`             |
| R   | `id`                              |
