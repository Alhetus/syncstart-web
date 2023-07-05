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

const lifebarColor = chroma.scale(["#172c6b", "#334da2"]).padding([0, -0.5]);

const Bar = React.memo(
  ({
    playerName,
    isFailed,
    actualDancePoints,
    possibleDancePoints,
    scoreDifference
  }) => {
    // Let's not go below 0
    const scorePercentage = Math.max(
      actualDancePoints / possibleDancePoints,
      0
    );
    const scoreString = `${actualDancePoints} / ${possibleDancePoints}`;

    const props = useSpring({
      width: scorePercentage * 100 + "%",
      backgroundColor: lifebarColor(scorePercentage).toString(),
      config: config.stiff
    });

    return (
      <BarContainer isFailed={isFailed}>
        <span>{playerName}</span>
        <RenderedScore
          formattedScore={scoreString}
          scoreDifference={scoreDifference}
        />
        <Lifebar style={props} />
      </BarContainer>
    );
  }
);

const JudgementContainer = styled.span`
  font-weight: 400;
  font-size: 18px;
  color: #cc2a5f;
`;

const JudgementScore = React.memo(({ value }) =>
  value < 0 ? <JudgementContainer>{value}</JudgementContainer> : null
);

const ScoreContainer = styled.div`
  margin-left: auto;
  font-weight: 800;
  white-space: nowrap;
  flex-shrink: 0;
`;

const RenderedScore = React.memo(({ formattedScore, scoreDifference }) => {
  return (
    <ScoreContainer>
      <JudgementScore value={scoreDifference} /> <span>{formattedScore}</span>
    </ScoreContainer>
  );
});

const App = () => {
  const [scoreState, setScoreState] = React.useState(null);

  const handleMessage = React.useCallback(
    msg => {
      const parsedScores = JSON.parse(msg);

      // Add the score difference to the player above
      parsedScores.scores.forEach((score, idx, allScores) => {
        if (idx > 0) {
          const betterPlayerScore = allScores[idx - 1];

          score.scoreDifference =
            score.actualDancePoints - betterPlayerScore.actualDancePoints;
        }
      });

      setScoreState(parsedScores);
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
