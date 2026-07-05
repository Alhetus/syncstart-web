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

const Bar = React.memo(
  ({ playerName, life, formattedScore, tapNote, holdNote, isFailed }) => (
    <div className={isFailed ? "bar-container failed" : "bar-container"}>
      <span>{playerName}</span>
      <RenderedScore
        formattedScore={formattedScore}
        tapNote={tapNote}
        holdNote={holdNote}
      />
      <div
        className="lifebar"
        style={{
          width: life * 100 + "%",
          backgroundColor: lifebarColor(life)
        }}
      />
    </div>
  )
);

const JudgementScore = React.memo(({ color, label, value }) =>
  value > 0 ? (
    <span className="judgement">
      {value}
      <span style={{ color }}>{label}</span>
    </span>
  ) : null
);

const RenderedScore = React.memo(({ formattedScore, tapNote, holdNote }) => {
  const misses =
    tapNote.miss + tapNote.hitMine + tapNote.checkpointMiss + holdNote.missed;

  return (
    <div className="score">
      <JudgementScore color="#f2f2f2" label="w" value={tapNote.W1} />{" "}
      <JudgementScore color="#e29c18" label="e" value={tapNote.W2} />{" "}
      <JudgementScore color="#66c955" label="g" value={tapNote.W3} />{" "}
      <JudgementScore color="#5b2b8e" label="d" value={tapNote.W4} />{" "}
      <JudgementScore color="#632b08" label="wo" value={tapNote.W5} />{" "}
      <JudgementScore color="#ff0000" label="m" value={misses} />{" "}
      <span className="percent">{formattedScore}</span>
    </div>
  );
});

const App = () => {
  const [scoreState, setScoreState] = React.useState(null);

  const handleMessage = React.useCallback((msg) => {
    setScoreState(JSON.parse(msg));
  }, []);

  useWebSocket(websocketUrl, handleMessage);

  return (
    <div className="bars">
      {scoreState &&
        scoreState.scores.map((score) => <Bar key={score.id} {...score} />)}
    </div>
  );
};

export default App;
