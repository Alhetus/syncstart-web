import React from "react";
import Websocket from "react-websocket";
import styled, { css, createGlobalStyle } from "styled-components";
import chroma from "chroma-js";
import { useSpring, animated, config } from "react-spring";
import "reset-css";

const websocketUrl =
  process.env.REACT_APP_WEBSOCKET_URL || "ws://localhost:8080/";

const GlobalStyles = createGlobalStyle`
  @import url('https://fonts.googleapis.com/css?family=Exo:300,400,500,600,700,800');

  body {
    font-family: "Exo";
    background-color: black;
  }
  
  *, *:before, *:after {
    box-sizing: border-box;
  }
`;

const Bars = styled.div`
  display: flex;
  flex-direction: column;
  align-content: stretch;
  align-items: flex-start;
  height: 100%;
  width: 100%;
  max-width: 400px;
`;

const BarContainer = styled.div`
  width: 100%; /* will get overridden */
  font-weight: 500;
  color: white;
  display: flex;
  align-items: center;
  position: relative;
  padding: 8px;
  font-size: 25px;
  text-shadow: rgba(0, 0, 0, 0.5) 1px 1px 2px;
  background-color: black;
  z-index: -2;

  &:not(:last-child) {
    margin-bottom: 2px;
  }

  ${props =>
    props.isFailed &&
    css`
      & > * {
        opacity: 0.5;
        color: rgb(255, 50, 50) !important;
      }
    `}
`;

const Lifebar = styled(animated.div)`
  z-index: -1;
  bottom: 0;
  left: 0;
  position: absolute;
  top: 0;
  width: 100%;
  background-color: black;
`;

const lifebarColor = chroma.scale(["#FF0000", "#0E1323"]).padding([0, -0.5]);

const Bar = React.memo(
  ({ playerName, life, formattedScore, tapNote, holdNote, isFailed }) => {
    const props = useSpring({
      width: life * 100 + "%",
      backgroundColor: lifebarColor(life).toString(),
      config: config.stiff
    });

    return (
      <BarContainer isFailed={isFailed}>
        <span>{playerName}</span>
        <RenderedScore
          formattedScore={formattedScore}
          tapNote={tapNote}
          holdNote={holdNote}
        />
        <Lifebar style={props} />
      </BarContainer>
    );
  }
);

const JudgementContainer = styled.span`
  font-weight: 400;
  font-size: 18px;
`;

const JudgementScore = React.memo(({ color, label, value }) =>
  value > 0 ? (
    <JudgementContainer>
      {value}
      <span style={{ color: color }}>{label}</span>
    </JudgementContainer>
  ) : null
);

const ScoreContainer = styled.div`
  margin-left: auto;
  font-weight: 800;
  white-space: nowrap;
  flex-shrink: 0;
`;

const RenderedScore = React.memo(({ formattedScore, tapNote, holdNote }) => {
  const misses =
    tapNote.miss + tapNote.hitMine + tapNote.checkpointMiss + holdNote.missed;

  return (
    <ScoreContainer>
      <JudgementScore color="#f2f2f2" label="w" value={tapNote.W1} />{" "}
      <JudgementScore color="#e29c18" label="e" value={tapNote.W2} />{" "}
      <JudgementScore color="#66c955" label="g" value={tapNote.W3} />{" "}
      <JudgementScore color="#5b2b8e" label="d" value={tapNote.W4} />{" "}
      <JudgementScore color="#632b08" label="wo" value={tapNote.W5} />{" "}
      <JudgementScore color="#ff0000" label="m" value={misses} />{" "}
      <span>{formattedScore}</span>
    </ScoreContainer>
  );
});

const App = () => {
  const [scoreState, setScoreState] = React.useState(null);

  const handleMessage = React.useCallback(
    msg => {
      setScoreState(JSON.parse(msg));
    },
    [setScoreState]
  );

  return (
    <>
      <GlobalStyles />
      <Websocket url={websocketUrl} onMessage={handleMessage} />
      <Bars>
        {scoreState &&
          scoreState.scores.map(score => <Bar key={score.id} {...score} />)}
      </Bars>
    </>
  );
};

export default App;
