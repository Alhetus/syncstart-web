import path from "node:path";
import fs from "node:fs";
import dgram from "node:dgram";
import { WebSocketServer } from "ws";
import { sheets, auth } from "@googleapis/sheets";

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

// Resolve paths relative to this module so the service runs from any CWD.
const scoresDir = path.join(import.meta.dirname, "scores");
const keyFile = path.isAbsolute(GOOGLE_KEY_FILE)
  ? GOOGLE_KEY_FILE
  : path.join(import.meta.dirname, GOOGLE_KEY_FILE);

// --- Google Sheets ---------------------------------------------------------
// GoogleAuth resolves the underlying client lazily on the first request, so no
// startup await/race is needed.
const googleAuth = new auth.GoogleAuth({
  keyFile,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const googleSheets = sheets({ version: "v4", auth: googleAuth });

let scoreSendingQueue = [];

// --- Servers ---------------------------------------------------------------
const udpServer = dgram.createSocket({ type: "udp4", reuseAddr: true });
// Created in start(), after config/credentials are validated (constructing it
// binds the port immediately, so we defer until we know we're going to run).
let wsServer;

udpServer.on("error", (err) => {
  console.error(`FATAL: UDP server error on port ${SYNCSTART_UDP_PORT}:`, err);
  process.exit(1);
});

let serverState = null;

// Replaces the `sanitize-filename` dependency: strip characters that are
// illegal in file names (and control chars), and fall back to a safe default.
const sanitizeFilename = (name) =>
  // eslint-disable-next-line no-control-regex -- intentionally strip control chars
  name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, "").slice(0, 255) || "unnamed";

const parseMessage = (msg) => {
  const [
    // "misc" information
    song,
    playerNumber,
    playerName,
    actualDancePoints,
    currentPossibleDancePoints,
    possibleDancePoints,
    formattedScore,
    life,
    isFailed,

    // tap note scores
    tapNoteNone,
    tapNoteHitMine,
    tapNoteAvoidMine,
    tapNoteCheckpointMiss,
    tapNoteMiss,
    tapNoteW5,
    tapNoteW4,
    tapNoteW3,
    tapNoteW2,
    tapNoteW1,
    tapNoteW0,
    tapNoteCheckpointHit,

    // hold note scores
    holdNoteNone,
    holdNoteLetGo,
    holdNoteHeld,
    holdNoteMissed,
    totalHoldsCount
  ] = msg.split("|");

  return {
    song,
    playerNumber: parseInt(playerNumber, 10),
    playerName,
    actualDancePoints: parseInt(actualDancePoints, 10),
    currentPossibleDancePoints: parseInt(currentPossibleDancePoints, 10),
    possibleDancePoints: parseInt(possibleDancePoints, 10),
    formattedScore,
    life: parseFloat(life),
    isFailed: isFailed === "1",

    tapNote: {
      none: parseInt(tapNoteNone, 10),
      hitMine: parseInt(tapNoteHitMine, 10),
      avoidMine: parseInt(tapNoteAvoidMine, 10),
      checkpointMiss: parseInt(tapNoteCheckpointMiss, 10),
      miss: parseInt(tapNoteMiss, 10),
      W5: parseInt(tapNoteW5, 10),
      W4: parseInt(tapNoteW4, 10),
      W3: parseInt(tapNoteW3, 10),
      W2: parseInt(tapNoteW2, 10),
      W1: parseInt(tapNoteW1, 10),
      W0: parseInt(tapNoteW0, 10),
      checkpointHit: parseInt(tapNoteCheckpointHit, 10)
    },

    holdNote: {
      none: parseInt(holdNoteNone, 10),
      letGo: parseInt(holdNoteLetGo, 10),
      held: parseInt(holdNoteHeld, 10),
      missed: parseInt(holdNoteMissed, 10)
    },

    totalHoldsCount: parseInt(totalHoldsCount, 10)
  };
};

const clampPercentage = (val) => Math.min(Math.max(val, 0), 1);

const sortScores = (score1, score2) => {
  // if other is one is failed and other not, that's all that matters
  if (score1.isFailed !== score2.isFailed) {
    return (score1.isFailed ? 1 : 0) - (score2.isFailed ? 1 : 0);
  }

  const overPossibleDancePointDifference =
    Math.abs(
      score1.currentPossibleDancePoints - score2.currentPossibleDancePoints
    ) > MAX_POSSIBLE_DANCE_POINTS_DIFFERENCE;

  if (overPossibleDancePointDifference) {
    const firstPercentage = clampPercentage(
      score1.actualDancePoints / score1.possibleDancePoints
    );
    const secondPercentage = clampPercentage(
      score2.actualDancePoints / score2.possibleDancePoints
    );

    return secondPercentage - firstPercentage;
  } else {
    const firstLostDancePoints =
      score1.currentPossibleDancePoints - score1.actualDancePoints;
    const secondLostDancePoints =
      score2.currentPossibleDancePoints - score2.actualDancePoints;

    return firstLostDancePoints - secondLostDancePoints;
  }
};

function updateServerState(parsedMessage, scoreKey, scoreData) {
  if (serverState === null || serverState.currentSong !== parsedMessage.song) {
    // song changed, reset server state
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

async function sendScoresToGoogleSheets(scoreValues) {
  console.log(`Sending ${scoreValues.length} scores to google sheets`);

  await googleSheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SCORES_TAB_NAME}!A:O`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: scoreValues
    }
  });
}

const processMessage = async (
  address,
  msg,
  isFinalScore,
  isFinalMarathonScore
) => {
  const parsedMessage = parseMessage(msg);
  const scoreKey = `${address} ${parsedMessage.playerNumber}`;
  const scoreData = Object.assign({}, parsedMessage, { id: scoreKey });

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

  // Send client messages only for score changed messages
  if (isScoreChangedMessage) {
    const scoreStateForClients = getClientMessage();

    wsServer.clients.forEach((client) => {
      client.send(scoreStateForClients);
    });
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
    await sendScoresToGoogleSheets(batch);
  } catch (e) {
    console.log("Error: could not send score, will retry", e);
    // put the batch back at the front to retry on the next tick
    scoreSendingQueue.unshift(...batch);
  } finally {
    flushing = false;
  }
}

// Confirm the credentials authenticate and the service account can actually
// reach the target spreadsheet. Returns the spreadsheet title on success.
async function verifyGoogleAccess() {
  const res = await googleSheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "properties.title"
  });
  return res.data.properties.title;
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
    const title = await verifyGoogleAccess();
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
    if (serverState) {
      wsClient.send(getClientMessage());
    }
  });

  setInterval(flushScoresToSheet, 5000);

  console.log("Starting server!");
  console.log("SYNCSTART_UDP_PORT:", SYNCSTART_UDP_PORT);
  console.log("WEBSOCKET_PORT:", WEBSOCKET_PORT);
  udpServer.bind(SYNCSTART_UDP_PORT);
}

start();
