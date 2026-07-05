import { useEffect, useRef } from "react";

const RECONNECT_DELAY = 1000;

/**
 * Subscribe to a WebSocket and forward each message's raw data to `onMessage`.
 * Reconnects automatically after the socket closes. Safe under React
 * StrictMode: the effect cleanup closes the socket and cancels any pending
 * reconnect, so the dev-mode double-mount does not leak sockets or timers.
 */
export function useWebSocket(url, onMessage) {
  // Keep the latest callback in a ref so the socket subscription does not
  // depend on the caller memoizing `onMessage`.
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let socket;
    let reconnectTimer;
    let closedByCleanup = false;

    const connect = () => {
      socket = new WebSocket(url);

      socket.onmessage = (event) => {
        onMessageRef.current(event.data);
      };

      socket.onclose = () => {
        if (closedByCleanup) return;
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      clearTimeout(reconnectTimer);
      socket.close();
    };
  }, [url]);
}
