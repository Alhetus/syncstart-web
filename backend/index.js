import path from "node:path";
import fs from "node:fs";
import dgram from "node:dgram";
import { WebSocketServer, WebSocket } from "ws";
import { parseMessage } from "./parseMessage.js";
import {
  makeSortScores,
  judgedNoteCount,
  nextBroadcastFrame
} from "./scoring.js";
import { createGoogleSheets } from "./googleSheets.js";

// --- Configuration (env-driven, with sensible defaults) --------------------
// Loaded from .env via `node --env-file-if-exists=.env` (see package.json).
const num = (value, fallback) =>
  value === undefined ? fallback : Number(value);

const SYNCSTART_UDP_PORT = num(process.env.SYNCSTART_UDP_PORT, 53000);
const WEBSOCKET_PORT = num(process.env.WEBSOCKET_PORT, 8080);
const MAX_POSSIBLE_DANCE_POINTS_DIFFERENCE = num(
  process.env.MAX_POSSIBLE_DANCE_POINTS_DIFFERENCE,
  100
);
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SCORES_TAB_NAME = process.env.SCORES_TAB_NAME || "Scores";
const GOOGLE_KEY_FILE = process.env.GOOGLE_KEY_FILE || "keys.json";

// Skip broadcasting to a client that has more than this many bytes still
// buffered — it can't keep up, so queueing more would grow memory unbounded.
const MAX_CLIENT_BUFFERED_BYTES = 512 * 1024;

// Fallback: if a complete frame (all still-playing clients at the same song
// position) hasn't assembled within this window — a client paused, quit without
// a final packet, or sustained packet loss — broadcast the latest set anyway so
// the scoreboard never freezes.
const FRAME_TIMEOUT_MS = 300;

// Cap broadcasts to at most one per this window. Frame alignment decides which
// snapshots are eligible; this thins the rate so dense charts don't emit one
// message per note. Coalesced sends always carry the latest complete frame.
const CADENCE_CAP_MS = 100;

// Resolve paths relative to this module so the service runs from any CWD.
const scoresDir = path.join(import.meta.dirname, "scores");
const keyFile = path.isAbsolute(GOOGLE_KEY_FILE)
  ? GOOGLE_KEY_FILE
  : path.join(import.meta.dirname, GOOGLE_KEY_FILE);

// --- Google Sheets ---------------------------------------------------------
const googleSheets = createGoogleSheets({
  keyFile,
  spreadsheetId: SPREADSHEET_ID,
  tabName: SCORES_TAB_NAME
});

const sortScores = makeSortScores(MAX_POSSIBLE_DANCE_POINTS_DIFFERENCE);

let scoreSendingQueue = [];

// --- Servers ---------------------------------------------------------------
const udpServer = dgram.createSocket({ type: "udp4", reuseAddr: true });
// Created in start(), after config/credentials are validated (constructing it
// binds the port immediately, so we defer until we know we're going to run).
let wsServer;
let flushIntervalId;

udpServer.on("error", (err) => {
  console.error(`FATAL: UDP server error on port ${SYNCSTART_UDP_PORT}:`, err);
  process.exit(1);
});

let serverState = null;

// Frame-aligned broadcasting (see maybeBroadcastFrame). `finishedIds` holds
// players who sent a final score, so we stop waiting on them; both reset per
// song in updateServerState.
let lastBroadcastFrame = -1;
const finishedIds = new Set();

// Replaces the `sanitize-filename` dependency: strip characters that are
// illegal in file names (and control chars), and fall back to a safe default.
const sanitizeFilename = (name) =>
  // eslint-disable-next-line no-control-regex -- intentionally strip control chars
  name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, "").slice(0, 255) || "unnamed";

// A packet is only usable if its essential numeric fields parsed cleanly.
// Malformed/short packets would otherwise leak NaN into the comparator, the
// client broadcast and the sheet, so we reject them outright.
const isValidScore = (parsedMessage) =>
  Number.isFinite(parsedMessage.playerNumber) &&
  Number.isFinite(parsedMessage.actualDancePoints) &&
  Number.isFinite(parsedMessage.currentPossibleDancePoints) &&
  Number.isFinite(parsedMessage.possibleDancePoints);

function updateServerState(parsedMessage, scoreKey, scoreData) {
  if (serverState === null || serverState.currentSong !== parsedMessage.song) {
    // song changed, reset server state (and the frame-alignment bookkeeping)
    finishedIds.clear();
    lastBroadcastFrame = -1;
    serverState = {
      currentSong: parsedMessage.song,
      scores: {
        [scoreKey]: scoreData
      },
      sortedScores: [scoreData]
    };
  } else {
    // otherwise just update new scores
    serverState.scores[scoreKey] = scoreData;
    serverState.sortedScores = Object.values(serverState.scores);
    serverState.sortedScores.sort(sortScores);
  }
}

function storeScoreForSending(scoreData) {
  if (
    scoreData.tapNote.W0 === 0 &&
    scoreData.tapNote.W1 === 0 &&
    scoreData.tapNote.W2 === 0 &&
    scoreData.tapNote.W3 === 0 &&
    scoreData.tapNote.W4 === 0
  ) {
    console.log(
      `Irrelevant score: ${scoreData.song} - player: ${scoreData.playerName}. Will not send`
    );
    return;
  }

  console.log(
    `Storing score: ${scoreData.song} - player: ${scoreData.playerName}`
  );

  const scoreItem = [
    scoreData.song.split("/")[1],
    scoreData.playerName,
    parseFloat(scoreData.formattedScore),
    scoreData.isFailed,
    scoreData.tapNote.W0,
    scoreData.tapNote.W1,
    scoreData.tapNote.W2,
    scoreData.tapNote.W3,
    scoreData.tapNote.W4,
    scoreData.tapNote.W5,
    scoreData.tapNote.miss,
    scoreData.tapNote.hitMine,
    scoreData.holdNote.held,
    scoreData.holdNote.letGo,
    scoreData.totalHoldsCount,
    scoreData.actualDancePoints,
    scoreData.possibleDancePoints,
    scoreData.id
  ];

  scoreSendingQueue.push(scoreItem);
}

const processMessage = async (
  address,
  msg,
  isFinalScore,
  isFinalMarathonScore
) => {
  const parsedMessage = parseMessage(msg);

  if (!isValidScore(parsedMessage)) {
    console.error(`WARN: ignoring malformed score message '${msg}'`);
    return;
  }

  const scoreKey = `${address} ${parsedMessage.playerNumber}`;
  const scoreData = Object.assign({}, parsedMessage, {
    id: scoreKey,
    frame: judgedNoteCount(parsedMessage)
  });

  // write json file for final score & final marathon score
  if (isFinalScore || isFinalMarathonScore) {
    const json = JSON.stringify(scoreData);
    const filename = sanitizeFilename(
      `${Date.now()}_${scoreData.song.replace("/", "_")}_${scoreData.playerName}.json`
    );
    fs.mkdirSync(scoresDir, { recursive: true });
    fs.writeFileSync(path.join(scoresDir, filename), json, "utf8");

    // Store score in queue
    storeScoreForSending(scoreData);

    // This player is done — stop gating broadcasts on them so a finished player
    // can't hold back the frame frontier for those still playing.
    finishedIds.add(scoreKey);
  }
  // Score changed
  else {
    updateServerState(parsedMessage, scoreKey, scoreData);
  }
};

const getClientMessage = () =>
  JSON.stringify({
    song: serverState.currentSong,
    scores: serverState.sortedScores
  });

// Broadcast the current scoreboard to every open client. Guards each send so a
// single misbehaving/closing socket can't throw and take down the process, and
// skips clients that are too far behind to avoid unbounded buffering.
function broadcast(message) {
  wsServer.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }
    if (client.bufferedAmount > MAX_CLIENT_BUFFERED_BYTES) {
      console.warn("WARN: skipping slow WebSocket client (send buffer full)");
      return;
    }
    try {
      client.send(message);
    } catch (e) {
      console.error("WARN: failed to send to WebSocket client", e);
    }
  });
}

let fallbackTimer = null;
let lastEmitTime = 0;
let pendingEmit = null;

function doBroadcast() {
  broadcast(getClientMessage());
}

// Rate cap on top of frame gating: send immediately if the window is clear,
// otherwise coalesce into one trailing send. getClientMessage() reads live
// serverState, so a coalesced send carries the newest complete frame.
function emit() {
  if (pendingEmit) {
    return;
  }
  const elapsed = Date.now() - lastEmitTime;
  if (elapsed >= CADENCE_CAP_MS) {
    lastEmitTime = Date.now();
    doBroadcast();
  } else {
    pendingEmit = setTimeout(() => {
      pendingEmit = null;
      lastEmitTime = Date.now();
      doBroadcast();
    }, CADENCE_CAP_MS - elapsed);
  }
}

// Players that still gate a broadcast: on the board, not failed, not finished.
const gatingScores = () =>
  serverState.sortedScores.filter((s) => !s.isFailed && !finishedIds.has(s.id));

// Arm/reset the safety timeout so a paused, quit, or lossy client can't freeze
// the board: if no complete frame assembles in time, broadcast what we have and
// resync the frontier so normal frame-gated broadcasting can resume.
function armFallback() {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
  }
  fallbackTimer = setTimeout(() => {
    emit();
    const gating = gatingScores();
    if (gating.length > 0) {
      lastBroadcastFrame = Math.max(...gating.map((s) => s.frame));
    }
  }, FRAME_TIMEOUT_MS);
}

// Broadcast only complete frames: a snapshot where every still-playing client
// has reported the same song position. Gating on the slowest player (the frame
// "frontier") means no client is stale relative to another, so async packet
// arrival can't reorder near-tied players — the source of the scoreboard
// flicker. Using min (not exact equality) tolerates packet loss: a dropped
// packet just makes that player's frame jump, and the frontier advances on
// their next packet.
// ponytail: a client that joins mid-song sits below the frontier; the fallback
// timeout keeps the board live until it catches up — no special-case needed for
// a lockstep-start competition.
function maybeBroadcastFrame() {
  const gating = gatingScores();
  // Everyone failed/finished — nothing left to wait for, so emit the latest.
  if (gating.length === 0) {
    emit();
    return;
  }
  const frontier = nextBroadcastFrame(
    gating.map((s) => s.frame),
    lastBroadcastFrame
  );
  if (frontier !== null) {
    lastBroadcastFrame = frontier;
    emit();
    armFallback();
  }
}

udpServer.on("message", async (buffer, rinfo) => {
  // we are interested only in score messages
  const isScoreChangedMessage = buffer[0] === 0x02;
  const isFinalScoreMessage = buffer[0] === 0x05;
  const isFinalMarathonScoreMessage = buffer[0] === 0x06;

  if (
    !isScoreChangedMessage &&
    !isFinalScoreMessage &&
    !isFinalMarathonScoreMessage
  ) {
    return;
  }

  const scoreMessage = buffer.slice(1).toString("utf-8");

  try {
    await processMessage(
      rinfo.address,
      scoreMessage,
      isFinalScoreMessage,
      isFinalMarathonScoreMessage
    );
  } catch (e) {
    console.error(`ERROR: couldn't process message '${scoreMessage}'`, e);
  }

  // Re-evaluate the frame after any score message: a score change may complete
  // a frame, and a final score removes a player from the gating set (which can
  // let the frontier advance for those still playing).
  if (serverState) {
    maybeBroadcastFrame();
  }
});

// Poll in 5 second intervals and flush queued scores to the sheet. The
// `flushing` guard prevents overlapping flushes; the batch is removed from the
// queue up front and re-queued on failure so scores are never double-sent or
// dropped.
let flushing = false;
async function flushScoresToSheet() {
  if (flushing || scoreSendingQueue.length === 0) {
    return;
  }
  flushing = true;

  const batch = scoreSendingQueue.splice(0, scoreSendingQueue.length);
  try {
    await googleSheets.appendScores(batch);
  } catch (e) {
    console.log("Error: could not send score, will retry", e);
    // put the batch back at the front to retry on the next tick
    scoreSendingQueue.unshift(...batch);
  } finally {
    flushing = false;
  }
}

// Clear the flush interval, flush anything still queued, and close the servers.
// Runs on SIGINT/SIGTERM so queued scores aren't lost on shutdown.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);

  clearInterval(flushIntervalId);
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
  }
  if (pendingEmit) {
    clearTimeout(pendingEmit);
  }
  try {
    await flushScoresToSheet();
  } catch (e) {
    console.error("Error flushing scores during shutdown", e);
  }

  wsServer?.close();
  udpServer.close();
  process.exit(0);
}

async function start() {
  // SPREADSHEET_ID is mandatory — the server exists to log scores, so refuse
  // to run without a target sheet.
  if (!SPREADSHEET_ID) {
    console.error(
      "FATAL: SPREADSHEET_ID is required but not set. Set it in .env (see .env.example)."
    );
    process.exit(1);
  }

  // The credentials file must exist before we try to authenticate.
  if (!fs.existsSync(keyFile)) {
    console.error(
      `FATAL: Google credentials file not found at "${keyFile}". ` +
        "Set GOOGLE_KEY_FILE or add keys.json (see README)."
    );
    process.exit(1);
  }

  // Verify we can authenticate with keys.json AND access the target sheet.
  try {
    const title = await googleSheets.verifyAccess();
    console.log(
      `Google Sheets: authenticated and able to access "${title}" (${SPREADSHEET_ID}).`
    );
  } catch (e) {
    console.error(
      `FATAL: could not access spreadsheet ${SPREADSHEET_ID} using ${path.basename(keyFile)}. ` +
        "Check the credentials and that the service account has access to the sheet."
    );
    console.error(e.message || e);
    process.exit(1);
  }

  // Config validated — start the servers.
  wsServer = new WebSocketServer({ port: WEBSOCKET_PORT });
  wsServer.on("error", (err) => {
    console.error(
      `FATAL: WebSocket server error on port ${WEBSOCKET_PORT}:`,
      err
    );
    process.exit(1);
  });
  wsServer.on("connection", (wsClient) => {
    // Without a listener, an 'error' on an individual client socket is fatal to
    // the whole process; log and let the socket close instead.
    wsClient.on("error", (err) => {
      console.error("WARN: WebSocket client error", err);
    });
    if (serverState) {
      wsClient.send(getClientMessage());
    }
  });

  flushIntervalId = setInterval(flushScoresToSheet, 5000);
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("Starting server!");
  console.log("SYNCSTART_UDP_PORT:", SYNCSTART_UDP_PORT);
  console.log("WEBSOCKET_PORT:", WEBSOCKET_PORT);
  udpServer.bind(SYNCSTART_UDP_PORT);
}

start();
