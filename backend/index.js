const SYNCSTART_UDP_PORT = 53000;
const WEBSOCKET_PORT = 8080;
const MAX_POSSIBLE_DANCE_POINTS_DIFFERENCE = 100;

const _ = require("lodash");
const WebSocket = require("ws");
const dgram = require("dgram");

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
    tapNoteCheckpointHit,

    // hold note scores
    holdNoteNone,
    holdNoteLetGo,
    holdNoteHeld,
    holdNoteMissed
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
    isFailed: isFailed === "1" ? true : false,

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
      checkpointHit: parseInt(tapNoteCheckpointHit, 10)
    },

    holdNote: {
      none: parseInt(holdNoteNone, 10),
      letGo: parseInt(holdNoteLetGo, 10),
      held: parseInt(holdNoteHeld, 10),
      missed: parseInt(holdNoteMissed, 10)
    }
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

const processMessage = (address, msg) => {
  const parsedMessage = parseMessage(msg);
  const scoreKey = `${address} ${parsedMessage.playerNumber}`;
  const scoreData = Object.assign({}, parsedMessage, { id: scoreKey });

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
};

const getClientMessage = () =>
  JSON.stringify({
    song: serverState.song,
    scores: serverState.sortedScores
  });

udpServer.on("message", (buffer, rinfo) => {
  // we are interested only in score messages
  if (buffer[0] !== 0x02) {
    return;
  }

  const scoreMessage = buffer.slice(1).toString("utf-8");

  try {
    processMessage(rinfo.address, scoreMessage);
  } catch (e) {
    console.error(`ERROR: couldn't process message '${scoreMessage}'`, e);
  }

  const scoreStateForClients = getClientMessage();

  wsServer.clients.forEach(client => {
    client.send(scoreStateForClients);
  });
});

wsServer.on("connection", wsClient => {
  if (serverState) {
    wsClient.send(getClientMessage());
  }
});

console.log("Starting server!");
console.log("SYNCSTART_UDP_PORT:", SYNCSTART_UDP_PORT);
console.log("WEBSOCKET_PORT:", WEBSOCKET_PORT);
udpServer.bind(SYNCSTART_UDP_PORT);
