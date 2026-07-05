import React from "react";
import { useWebSocket } from "./useWebSocket.js";
import { deriveRows } from "./scoreModel.js";
import Bar from "./Bar.jsx";

const websocketUrl =
  import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8080/";

const App = () => {
  const [rows, setRows] = React.useState(null);
  const showGapRef = React.useRef({}); // id -> bool, hysteresis across messages

  const handleMessage = React.useCallback((msg) => {
    let parsed;
    try {
      parsed = JSON.parse(msg);
    } catch {
      console.error("Ignoring malformed message from server:", msg);
      return;
    }
    setRows(deriveRows(parsed, showGapRef.current));
  }, []);

  useWebSocket(websocketUrl, handleMessage);

  return (
    <div className="bars">
      {rows && rows.map((row) => <Bar key={row.id} {...row} />)}
    </div>
  );
};

export default App;
