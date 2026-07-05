const SYNCSTART_UDP_PORT = 53000;
const WEBSOCKET_PORT = 8080;
const MAX_POSSIBLE_DANCE_POINTS_DIFFERENCE = 100;

// CHANGE THESE TO MATCH THE WANTED GOOGLE SHEET
// ---------------------------------------------
const spreadsheetId = "1fa88lJihFOGGjR3yZiPHo70LOPRWlRLrFFn_I1yFJg4";
const scoresTabName = "Scores";
// ---------------------------------------------

const path = require("path");
const fs = require("fs");
const _ = require("lodash");
const WebSocket = require("ws");
const dgram = require("dgram");
const sanitize = require("sanitize-filename");
const { google } = require("googleapis");

let scoreSendingQueue = [];

console.log("Authenticating for google sheets...");

const auth = new google.auth.GoogleAuth({
  keyFile: "keys.json",
  scopes: "https://www.googleapis.com/auth/spreadsheets",
});

let authClient;

(async () => {
  authClient = await auth.getClient();
})();

const googleSheets = google.sheets({ version: "v4", auth: authClient });
console.log("Done.");

const udpServer = dgram.createSocket({ type: "udp4", reuseAddr: true });

const wsServer = new WebSocket.Server({
  port: WEBSOCKET_PORT
});

let serverState = null;

const parseMessage = msg => {
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

const clampPercentage = val => _.clamp(val, 0, 1);

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
    scoreData.tapNote.W4 === 0) {
    console.log(`Irrelevant score: ${scoreData.song} - player: ${scoreData.playerName}. Will not send`);
    return;
  }

  console.log(`Storing score: ${scoreData.song} - player: ${scoreData.playerName}`);

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
    auth,
    spreadsheetId,
    range: `${scoresTabName}!A:O`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: scoreValues,
    },
  });
}

const processMessage = async (address, msg, isFinalScore, isFinalMarathonScore) => {
  const parsedMessage = parseMessage(msg);
  const scoreKey = `${address} ${parsedMessage.playerNumber}`;
  const scoreData = Object.assign({}, parsedMessage, { id: scoreKey });

  // write json file for final score & final marathon score
  if (isFinalScore || isFinalMarathonScore) {
    const json = JSON.stringify(scoreData);
    const filename = sanitize(
      `${Date.now()}_${scoreData.song.replace("/", "_")}_${
        scoreData.playerName
      }.json`
    );
    const filePath = path.join(".", "scores", filename);
    fs.writeFileSync(filePath, json, "utf8");

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
    song: serverState.song,
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

    wsServer.clients.forEach(client => {
      client.send(scoreStateForClients);
    });
  }
});

wsServer.on("connection", wsClient => {
  if (serverState) {
    wsClient.send(getClientMessage());
  }
});

// Poll in 5 second intervals and send scores
async function waitAndSendScoresToSheet() {
  setTimeout(async function() {
    const queueLength = scoreSendingQueue.length;

    // Send accumulated scores to google sheets
    if (queueLength > 0) {
      try {
        await sendScoresToGoogleSheets(scoreSendingQueue, false);

        // Clear sent amount from queue
        for (let i = 0; i < queueLength; i++) {
          scoreSendingQueue.shift();
        }
      } catch (e) {
        console.log("Error: could not send score", e);
      }
    }

    // Run again after 5 seconds
    await waitAndSendScoresToSheet();
  }, 5000);
}

waitAndSendScoresToSheet();

console.log("Starting server!");
console.log("SYNCSTART_UDP_PORT:", SYNCSTART_UDP_PORT);
console.log("WEBSOCKET_PORT:", WEBSOCKET_PORT);
udpServer.bind(SYNCSTART_UDP_PORT);
