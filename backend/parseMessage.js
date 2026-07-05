// Decodes a SyncStart score packet: a pipe-delimited (`|`) text body (the 1-byte
// type prefix is stripped by the caller) into a structured score object.
export const parseMessage = (msg) => {
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
