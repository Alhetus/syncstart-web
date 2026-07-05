export const clampPercentage = (val) => Math.min(Math.max(val, 0), 1);

// A player's completed-so-far percentage. Guards against possibleDancePoints
// being 0 (division would yield NaN/Infinity and poison the comparator).
const percentage = (actualDancePoints, possibleDancePoints) => {
  const ratio = actualDancePoints / possibleDancePoints;
  return clampPercentage(Number.isFinite(ratio) ? ratio : 0);
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
