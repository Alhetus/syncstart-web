export const clampPercentage = (val) => Math.min(Math.max(val, 0), 1);

// Number of resolved notes so far. Increments by 1 per judged note, so on an
// identical chart it is the same value at the same song position for every
// client — a shared "frame" key, independent of how well anyone played. Used to
// only broadcast snapshots where all still-playing clients are at the same
// position, so async packet arrival can't reorder near-tied players.
// ponytail: the field list is a calibration detail — any fixed formula works as
// long as it's computed identically for every client. Verify against real
// packets if frames drift.
export const judgedNoteCount = (s) =>
  s.tapNote.W0 +
  s.tapNote.W1 +
  s.tapNote.W2 +
  s.tapNote.W3 +
  s.tapNote.W4 +
  s.tapNote.W5 +
  s.tapNote.miss +
  s.tapNote.hitMine +
  s.tapNote.avoidMine +
  s.tapNote.checkpointHit +
  s.tapNote.checkpointMiss +
  s.holdNote.held +
  s.holdNote.letGo +
  s.holdNote.missed;

// A player's completed-so-far percentage. Guards against possibleDancePoints
// being 0 (division would yield NaN/Infinity and poison the comparator).
const percentage = (actualDancePoints, possibleDancePoints) => {
  const ratio = actualDancePoints / possibleDancePoints;
  return clampPercentage(Number.isFinite(ratio) ? ratio : 0);
};

// Decide the frame to broadcast at, given the frames of the still-playing
// (gating) players and the last frame already broadcast. The frontier is the
// slowest player's frame — once it passes what we last sent, every gating
// player is at >= that frame, so the snapshot is aligned. Returns null to hold.
// Using min tolerates packet loss: a laggard's dropped packet just makes its
// frame jump, and the frontier advances on its next packet.
export const nextBroadcastFrame = (gatingFrames, lastBroadcastFrame) => {
  if (gatingFrames.length === 0) {
    return null;
  }
  const frontier = Math.min(...gatingFrames);
  return frontier > lastBroadcastFrame ? frontier : null;
};

// Builds the scoreboard comparator. `maxPossibleDancePointsDifference` is
// injected so this module stays free of configuration/env concerns.
export const makeSortScores =
  (maxPossibleDancePointsDifference) => (score1, score2) => {
    // if one is failed and the other not, that's all that matters
    if (score1.isFailed !== score2.isFailed) {
      return (score1.isFailed ? 1 : 0) - (score2.isFailed ? 1 : 0);
    }

    const overPossibleDancePointDifference =
      Math.abs(
        score1.currentPossibleDancePoints - score2.currentPossibleDancePoints
      ) > maxPossibleDancePointsDifference;

    if (overPossibleDancePointDifference) {
      const firstPercentage = percentage(
        score1.actualDancePoints,
        score1.possibleDancePoints
      );
      const secondPercentage = percentage(
        score2.actualDancePoints,
        score2.possibleDancePoints
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
