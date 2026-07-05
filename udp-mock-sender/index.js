// SyncStart UDP mock sender.
//
// Simulates a song for a configurable set of players: sends live "score
// changed" (0x02) packets on an interval while scores accumulate from zero,
// then fires one "final score" (0x05) packet per player at the end. The backend
// (backend/index.js) broadcasts the live packets to the frontend and, on the
// final packets, writes scores/*.json and appends rows to the Google Sheet.
//
// Config-driven (config.json). No dependencies — uses node:dgram like the
// backend. See README.md.

import fs from "node:fs";
import path from "node:path";
import dgram from "node:dgram";
import { makePlayer, advancePlayer } from "./simulate.js";
import { buildPacket, PACKET_TYPE } from "./packet.js";

const configPath = path.join(
  import.meta.dirname,
  process.env.MOCK_CONFIG_FILE || "config.json"
);

// --- Load & validate config ------------------------------------------------
const loadConfig = () => {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    console.error(`FATAL: could not read/parse ${configPath}:`, e.message);
    process.exit(1);
  }

  const errors = [];
  if (!config.song || !String(config.song).includes("/")) {
    errors.push(
      'song must be "Group/Title" (contain a "/") — the sheet stores the part after the first "/"'
    );
  }
  if (!(config.durationSeconds > 0)) {
    errors.push("durationSeconds must be a positive number");
  }
  if (!(config.tickIntervalMs > 0)) {
    errors.push("tickIntervalMs must be a positive number");
  }
  if (!config.chart || !(config.chart.totalNotes > 0)) {
    errors.push("chart.totalNotes must be a positive number");
  }
  if (!Array.isArray(config.machines) || config.machines.length === 0) {
    errors.push("machines must be a non-empty array");
  }

  const players = (config.machines || []).flatMap((m) =>
    (m.players || []).map((p) => ({ ...p, machineName: m.name }))
  );
  if (players.length === 0) {
    errors.push("no players configured");
  }
  const numbers = players.map((p) => p.playerNumber);
  if (new Set(numbers).size !== numbers.length) {
    errors.push(
      `playerNumbers must be globally unique (all packets share source IP 127.0.0.1); got [${numbers.join(", ")}]`
    );
  }

  if (errors.length > 0) {
    console.error("FATAL: invalid config.json:");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  return { config, players };
};

// --- Note/hold scheduling --------------------------------------------------
// Spread the chart's notes and holds evenly across ticks, using cumulative
// rounding so the totals land exactly by the final tick (which makes each
// player's currentPossibleDancePoints reach possibleDancePoints).
const scheduleFor = (total, tick, totalTicks) =>
  Math.round((total * tick) / totalTicks) -
  Math.round((total * (tick - 1)) / totalTicks);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const send = (socket, buf, host, port) =>
  new Promise((resolve) => {
    socket.send(buf, port, host, (err) => {
      if (err) {
        console.error("WARN: UDP send failed:", err.message);
      }
      resolve();
    });
  });

const run = async () => {
  const { config, players: playerConfigs } = loadConfig();
  const { host, port } = config.target || { host: "127.0.0.1", port: 53000 };

  const players = playerConfigs.map((pc) =>
    makePlayer(pc, pc.machineName, config.chart, config.song, config.seed ?? 0)
  );

  const totalTicks = Math.max(
    1,
    Math.ceil((config.durationSeconds * 1000) / config.tickIntervalMs)
  );

  const socket = dgram.createSocket("udp4");
  let stopped = false;
  const shutdown = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    console.log("\nInterrupted — closing socket.");
    socket.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(
    `Mock sender → ${host}:${port} | song "${config.song}" | ${players.length} players | ` +
      `${config.durationSeconds}s @ ${config.tickIntervalMs}ms (${totalTicks} ticks)`
  );

  // --- Live phase: accumulate + broadcast every tick -----------------------
  for (let tick = 1; tick <= totalTicks && !stopped; tick++) {
    const notes = scheduleFor(config.chart.totalNotes, tick, totalTicks);
    const holds = scheduleFor(config.chart.totalHolds || 0, tick, totalTicks);

    for (const player of players) {
      advancePlayer(player, notes, holds);
      await send(
        socket,
        buildPacket(PACKET_TYPE.SCORE_CHANGED, player),
        host,
        port
      );
    }

    const leader = [...players].sort(
      (a, b) => Number(b.formattedScore) - Number(a.formattedScore)
    )[0];
    const elapsed = ((tick * config.tickIntervalMs) / 1000).toFixed(0);
    process.stdout.write(
      `\r[${elapsed}s / ${config.durationSeconds}s] leader: ${leader.playerName} ${leader.formattedScore}%   `
    );

    if (tick < totalTicks) {
      await sleep(config.tickIntervalMs);
    }
  }

  if (stopped) {
    return;
  }

  // --- Final phase: one final-score packet per player ----------------------
  console.log("\nSong over — sending final scores.");
  for (const player of players) {
    await send(
      socket,
      buildPacket(PACKET_TYPE.FINAL_SCORE, player),
      host,
      port
    );
  }

  // --- Summary -------------------------------------------------------------
  printSummary(players);

  socket.close(() => process.exit(0));
};

const printSummary = (players) => {
  const ranked = [...players].sort((a, b) => {
    if (a.isFailed !== b.isFailed) {
      return a.isFailed ? 1 : -1; // failed players sink, like the backend sort
    }
    return Number(b.formattedScore) - Number(a.formattedScore);
  });

  console.log("\nFinal ranking:");
  ranked.forEach((p, i) => {
    const tag = p.isFailed ? "  [FAILED]" : "";
    console.log(
      `  ${i + 1}. ${p.playerName} (${p.machineName}, P${p.playerNumber}, ${p.skill}) — ` +
        `${p.formattedScore}%  ` +
        `W0:${p.tapNote.W0} W1:${p.tapNote.W1} W2:${p.tapNote.W2} ` +
        `W3:${p.tapNote.W3} W4:${p.tapNote.W4} miss:${p.tapNote.miss}${tag}`
    );
  });
};

run().catch((e) => {
  console.error("FATAL: mock sender crashed:", e);
  process.exit(1);
});
