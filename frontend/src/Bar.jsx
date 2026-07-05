import React from "react";

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

export default Bar;
