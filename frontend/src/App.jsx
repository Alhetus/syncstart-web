import React from "react";
import { useWebSocket } from "./useWebSocket.js";

const websocketUrl =
  import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8080/";

// Linear RGB interpolation from red (life 0) to dark blue (life 1). Replaces
// the previous chroma-js LAB scale; the mid-curve hue differs slightly but is
// indistinguishable for a life bar.
const LIFE_EMPTY = [255, 0, 0]; // #FF0000
const LIFE_FULL = [14, 19, 35]; // #0E1323

const lifebarColor = (life) => {
  const t = Math.min(Math.max(life, 0), 1);
  const [r, g, b] = LIFE_EMPTY.map((from, i) =>
    Math.round(from + (LIFE_FULL[i] - from) * t)
  );
  return `rgb(${r}, ${g}, ${b})`;
};

// Below this dance-point gap to the player above we show which judgements the
// player is behind in; at/above it we show the score-percentage gap instead.
const DP_GAP_THRESHOLD = 15;

// Hysteresis dead-band: once in one mode, the gap must move this far past the
// threshold to switch back. Stops the display flipping when dpGap jitters
// around DP_GAP_THRESHOLD on quick updates.
const DP_GAP_HYSTERESIS = 5;

// Completed-so-far percentage; guards possibleDancePoints being 0.
const pctScore = (actual, possible) => (possible > 0 ? actual / possible : 0);

const missCount = (n) =>
  n.tapNote.miss + n.tapNote.hitMine + n.tapNote.checkpointMiss + n.holdNote.missed;

// A visible judgement chip, or null when the value is <= 0 (nothing to show).
const chip = (value, color, label, plus) =>
  value > 0 ? { value, color, label, plus } : null;

// Precompute one fully-rendered view model per score. Pure except for
// `prevShowGap`, the per-id hysteresis map, which it rebuilds from the current
// ids (pruning players who left) and mutates in place for the next message.
const deriveRows = (scoreState, prevShowGap) => {
  const scores = scoreState.scores;
  const nextShowGap = {};

  const rows = scores.map((score, i) => {
    const {
      id,
      playerName,
      life,
      formattedScore,
      tapNote,
      isFailed,
      actualDancePoints,
      possibleDancePoints
    } = score;
    const above = scores[i - 1];

    const base = {
      id,
      playerName,
      isFailed,
      lifeWidth: life * 100 + "%",
      lifeColor: lifebarColor(life),
      formattedScore
    };

    // Leader (no one above): full breakdown of the player's own judgements.
    if (!above) {
      return {
        ...base,
        chips: [
          chip(missCount(score), "#ff0000", "m"),
          chip(tapNote.W5, "#632b08", "wo"),
          chip(tapNote.W4, "#5b2b8e", "d"),
          chip(tapNote.W3, "#66c955", "g"),
          chip(tapNote.W2, "#e29c18", "e"),
          chip(tapNote.W1, "#f2f2f2", "w")
        ].filter(Boolean)
      };
    }

    const dpGap = above.actualDancePoints - actualDancePoints; // >0 = behind

    // Apply hysteresis: flip to % only at/above the threshold, back to
    // judgements only once clearly below it. In between, keep the last mode.
    const showGap =
      dpGap >= DP_GAP_THRESHOLD
        ? true
        : dpGap < DP_GAP_THRESHOLD - DP_GAP_HYSTERESIS
          ? false
          : !!prevShowGap[id];
    nextShowGap[id] = showGap;

    // Far behind: show the score-percentage gap (computed from dance points).
    if (showGap) {
      const pct =
        (pctScore(above.actualDancePoints, above.possibleDancePoints) -
          pctScore(actualDancePoints, possibleDancePoints)) *
        100;
      return { ...base, chips: [{ text: `+${pct.toFixed(1)}%` }] };
    }

    // Close: judgements the player is behind in vs the player above. Good tiers
    // (W1-W4) count "behind" as fewer; bad tiers (W5, misses) as more. Chips
    // with value <= 0 are dropped, so only deficits render.
    return {
      ...base,
      chips: [
        chip(missCount(score) - missCount(above), "#ff0000", "m", true),
        chip(tapNote.W5 - above.tapNote.W5, "#632b08", "wo", true),
        chip(above.tapNote.W4 - tapNote.W4, "#5b2b8e", "d", true),
        chip(above.tapNote.W3 - tapNote.W3, "#66c955", "g", true),
        chip(above.tapNote.W2 - tapNote.W2, "#e29c18", "e", true),
        chip(above.tapNote.W1 - tapNote.W1, "#f2f2f2", "w", true)
      ].filter(Boolean)
    };
  });

  // Swap the map in place so the caller's ref carries forward (and prunes).
  for (const k of Object.keys(prevShowGap)) delete prevShowGap[k];
  Object.assign(prevShowGap, nextShowGap);

  return rows;
};

// Shrinks the player name's font to fit the space left over on its row (after
// the right-pinned score block), instead of truncating. CSS has no shrink-to-fit,
// so we measure the text's natural width against the box width and apply a scale.
const PlayerName = React.memo(({ name }) => {
  const boxRef = React.useRef(null); // the flex item (available width)
  const textRef = React.useRef(null); // the text (natural width)
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    const fit = () => {
      const avail = box.clientWidth;
      const natural = text.scrollWidth; // layout metric — unaffected by transform
      setScale(avail > 0 && natural > 0 ? Math.min(1, avail / natural) : 1);
    };
    fit();
    const ro = new ResizeObserver(fit); // re-fit when the score block widens/shrinks
    ro.observe(box);
    return () => ro.disconnect();
  }, [name]);

  return (
    <span className="player-name" ref={boxRef}>
      <span
        ref={textRef}
        className="player-name-text"
        style={{ transform: `scale(${scale})` }}
      >
        {name}
      </span>
    </span>
  );
});

const Bar = React.memo(
  ({ playerName, lifeWidth, lifeColor, formattedScore, chips, isFailed }) => (
    <div className={isFailed ? "bar-container failed" : "bar-container"}>
      <PlayerName name={playerName} />
      <div className="score">
        {chips.map((c, i) => (
          <React.Fragment key={i}>
            {c.text ? (
              <span className="judgement gap">{c.text}</span>
            ) : (
              <span className="judgement">
                {c.plus ? "+" : ""}
                {c.value}
                <span style={{ color: c.color }}>{c.label}</span>
              </span>
            )}{" "}
          </React.Fragment>
        ))}
        <span className="percent">{formattedScore}</span>
      </div>
      <div
        className="lifebar"
        style={{ width: lifeWidth, backgroundColor: lifeColor }}
      />
    </div>
  )
);

const App = () => {
  const [rows, setRows] = React.useState(null);
  const showGapRef = React.useRef({}); // id -> bool, hysteresis across messages

  const handleMessage = React.useCallback((msg) => {
    setRows(deriveRows(JSON.parse(msg), showGapRef.current));
  }, []);

  useWebSocket(websocketUrl, handleMessage);

  return (
    <div className="bars">
      {rows && rows.map((row) => <Bar key={row.id} {...row} />)}
    </div>
  );
};

export default App;
