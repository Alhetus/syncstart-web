// Per-player score simulation for the SyncStart mock sender.
//
// The model is monotonic: over the song each player "hits" notes, and every hit
// is judged (W0 best .. W5/miss worst) according to a skill profile. Dance
// points accumulate from the judgement weights; the percentage, judgement
// counters, hold counts and lifebar are derived from that. Nothing here does
// I/O — index.js drives the ticks and sends the packets.

// --- Dance-point weights (ITGmania values) --------------------------------
// Max achievable per tap note is W0 = 3.5; per held hold note is 1.
const TAP_WEIGHT = { W0: 3.5, W1: 3, W2: 2, W3: 1, W4: 0, W5: 0, miss: 0 };
const HIT_MINE_WEIGHT = -1;
const HELD_WEIGHT = 1;
const MAX_TAP_WEIGHT = TAP_WEIGHT.W0;

// --- Skill profiles -------------------------------------------------------
// `dist` is the probability of each judgement, in [W0,W1,W2,W3,W4,W5,miss]
// order (need not sum to exactly 1 — it is normalised). `holdHitRate` is the
// chance a hold is successfully held (vs. let go). `life` deltas are applied
// per judgement to the lifebar.
const JUDGEMENTS = ["W0", "W1", "W2", "W3", "W4", "W5", "miss"];

const SKILL_PROFILES = {
  pro: { dist: [0.7, 0.22, 0.05, 0.02, 0.005, 0.003, 0.002], holdHitRate: 0.99 },
  good: { dist: [0.45, 0.3, 0.15, 0.06, 0.02, 0.01, 0.01], holdHitRate: 0.95 },
  average: { dist: [0.22, 0.28, 0.25, 0.15, 0.05, 0.02, 0.03], holdHitRate: 0.85 },
  beginner: { dist: [0.1, 0.18, 0.25, 0.22, 0.1, 0.05, 0.1], holdHitRate: 0.65 }
};

// Lifebar change per judgement. Good timing recovers a little, bad timing and
// misses drain it. Tuned so a beginner dips but usually survives, while a
// forceFail drain (below) reliably kills the bar.
const LIFE_DELTA = {
  W0: 0.008,
  W1: 0.008,
  W2: 0.004,
  W3: 0,
  W4: -0.02,
  W5: -0.03,
  miss: -0.05
};
const HIT_MINE_LIFE = -0.05;
const FORCE_FAIL_DRAIN_PER_TICK = 0.06; // extra drain so the bar reaches 0
const STARTING_LIFE = 0.7;

// --- Seeded RNG (mulberry32) ----------------------------------------------
// Deterministic per-player stream so a given `seed` reproduces the whole run.
const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const normalise = (dist) => {
  const sum = dist.reduce((a, b) => a + b, 0);
  return dist.map((v) => v / sum);
};

// Pick a judgement index from a normalised cumulative distribution.
const rollJudgement = (rng, cumulative) => {
  const r = rng();
  for (let i = 0; i < cumulative.length; i++) {
    if (r <= cumulative[i]) {
      return JUDGEMENTS[i];
    }
  }
  return JUDGEMENTS[JUDGEMENTS.length - 1];
};

const emptyTapNote = () => ({
  none: 0,
  hitMine: 0,
  avoidMine: 0,
  checkpointMiss: 0,
  miss: 0,
  W5: 0,
  W4: 0,
  W3: 0,
  W2: 0,
  W1: 0,
  W0: 0,
  checkpointHit: 0
});

// Build a fresh simulated player from a config entry + chart + song.
export const makePlayer = (playerConfig, machineName, chart, song, seed) => {
  const profile = SKILL_PROFILES[playerConfig.skill] || SKILL_PROFILES.average;
  const dist = normalise(profile.dist);
  const cumulative = [];
  dist.reduce((acc, v, i) => (cumulative[i] = acc + v), 0);

  const possibleDancePoints =
    chart.totalNotes * MAX_TAP_WEIGHT + chart.totalHolds * HELD_WEIGHT;

  return {
    playerNumber: playerConfig.playerNumber,
    playerName: playerConfig.playerName,
    machineName,
    skill: playerConfig.skill,
    forceFail: playerConfig.forceFail === true,

    song,
    totalHoldsCount: chart.totalHolds,
    possibleDancePoints,

    // seed the RNG per player so streams are independent but reproducible
    rng: mulberry32((seed | 0) + playerConfig.playerNumber * 0x9e3779b1),
    cumulative,
    holdHitRate: profile.holdHitRate,

    actualDancePoints: 0,
    currentPossibleDancePoints: 0,
    tapNote: emptyTapNote(),
    holdNote: { none: 0, letGo: 0, held: 0, missed: 0 },

    life: STARTING_LIFE,
    isFailed: false,
    formattedScore: "0.00"
  };
};

// Advance a player by `noteCount` taps and `holdCount` holds (this tick).
export const advancePlayer = (player, noteCount, holdCount) => {
  for (let i = 0; i < noteCount; i++) {
    const j = rollJudgement(player.rng, player.cumulative);
    player.tapNote[j] += 1;
    player.actualDancePoints += TAP_WEIGHT[j];
    player.currentPossibleDancePoints += MAX_TAP_WEIGHT;
    if (!player.isFailed) {
      player.life += LIFE_DELTA[j];
    }
  }

  for (let i = 0; i < holdCount; i++) {
    player.currentPossibleDancePoints += HELD_WEIGHT;
    if (player.rng() < player.holdHitRate) {
      player.holdNote.held += 1;
      player.actualDancePoints += HELD_WEIGHT;
    } else {
      player.holdNote.letGo += 1;
    }
  }

  // Occasional mine hit (small, skill-independent) — exercises the negative
  // dance-point path and the hitMine sheet column.
  if (player.rng() < 0.02) {
    player.tapNote.hitMine += 1;
    player.actualDancePoints += HIT_MINE_WEIGHT;
    if (!player.isFailed) {
      player.life += HIT_MINE_LIFE;
    }
  } else if (player.rng() < 0.05) {
    player.tapNote.avoidMine += 1;
  }

  if (player.forceFail && !player.isFailed) {
    player.life -= FORCE_FAIL_DRAIN_PER_TICK;
  }

  // Clamp: actual dance points can't be negative or exceed what's possible so
  // far; life stays in [0,1]; a drained bar means the player has failed.
  if (player.actualDancePoints < 0) {
    player.actualDancePoints = 0;
  }
  if (player.actualDancePoints > player.currentPossibleDancePoints) {
    player.actualDancePoints = player.currentPossibleDancePoints;
  }
  if (player.life <= 0) {
    player.life = 0;
    player.isFailed = true;
  } else if (player.life > 1) {
    player.life = 1;
  }

  const pct =
    player.possibleDancePoints > 0
      ? (player.actualDancePoints / player.possibleDancePoints) * 100
      : 0;
  player.formattedScore = pct.toFixed(2);

  return player;
};
