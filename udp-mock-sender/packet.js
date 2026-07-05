// Encodes a SyncStart score packet: a single raw type byte followed by a UTF-8,
// pipe-delimited (`|`) body. The field order below MUST match the backend's
// decoder in `backend/parseMessage.js` (26 fields, in order).
//
// Type bytes (see `backend/index.js` udpServer "message" handler):
//   0x02 = score changed (backend updates state + broadcasts to the frontend)
//   0x05 = final score        (backend writes scores/*.json + queues a Sheets row)
//   0x06 = final marathon     (same as 0x05)

export const PACKET_TYPE = {
  SCORE_CHANGED: 0x02,
  FINAL_SCORE: 0x05,
  FINAL_MARATHON_SCORE: 0x06
};

// `score` is the shape produced by simulate.js: named fields matching the
// parsed object in the backend. Numeric dance-point fields are emitted as
// integers because the backend runs them through parseInt.
export const buildPacket = (typeByte, score) => {
  const { tapNote, holdNote } = score;

  const fields = [
    score.song,
    score.playerNumber,
    score.playerName,
    Math.round(score.actualDancePoints),
    Math.round(score.currentPossibleDancePoints),
    Math.round(score.possibleDancePoints),
    score.formattedScore,
    score.life,
    score.isFailed ? "1" : "0",

    // tap note scores (worst -> best window order, matching the game enum)
    tapNote.none,
    tapNote.hitMine,
    tapNote.avoidMine,
    tapNote.checkpointMiss,
    tapNote.miss,
    tapNote.W5,
    tapNote.W4,
    tapNote.W3,
    tapNote.W2,
    tapNote.W1,
    tapNote.W0,
    tapNote.checkpointHit,

    // hold note scores
    holdNote.none,
    holdNote.letGo,
    holdNote.held,
    holdNote.missed,
    score.totalHoldsCount
  ];

  const body = fields.join("|");
  return Buffer.concat([Buffer.from([typeByte]), Buffer.from(body, "utf-8")]);
};
