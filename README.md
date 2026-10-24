# 🟣 Don't Touch The Purple

**A real-time multiplayer reflex game built with Angular, Node.js, and Socket.io — supporting up to 10 concurrent players in a single room.**

![Angular](https://img.shields.io/badge/Angular-22-DD0031?logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4-010101?logo=socket.io&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![Pino](https://img.shields.io/badge/Pino-structured%20logging-687634?logo=pino&logoColor=white)

**▶ [Play it live](https://donttouchpurple-av.vercel.app/)** — backend runs on Render's free tier, so the first request after a while can take 20-30s to wake up.

A color lights up on your grid. Tap it to score — unless it's purple. Build combos, avoid the danger color, and climb a live leaderboard against up to 9 other players in real time.

<p align="center">
  <img src="docs/screenshots/home.png" width="260" alt="Home screen" />
  <img src="docs/screenshots/waiting-room.png" width="260" alt="Waiting room" />
  <img src="docs/screenshots/gameplay.png" width="260" alt="Gameplay screen" />
</p>

---

## Why this project

This isn't a tutorial clone — it's a small, complete real-time system I built end-to-end: a server-authoritative game engine, a reactive signals-based Angular frontend, and a sync protocol that keeps up to 10 independent clients in lockstep, with input validation, graceful disconnect handling, structured production logging, and a scoring model that's been load-tested with real concurrent socket clients, not just reasoned about on paper.

Below is what it does, how it's built, and the real bugs I found and fixed while building it — including a genuine production incident, diagnosed and fixed the same day with live traffic simulation against the deployed server — because the debugging is usually the more interesting part.

## Gameplay

- **Your own grid, your own pace.** Each player gets an independent 2×5 grid; one tile lights up at a time on it. Tap it before it moves.
- **7 safe colors, 1 danger color — host's choice.** Tap a safe color to score. Tap the danger color (purple by default, but the host can pick any of the 8) and you lose points and your combo.
- **Combo multipliers.** Consecutive safe taps build a combo: Bronze (3+) = 2x, Silver (6+) = 3x, Gold (10+) = 5x points.
- **Live leaderboard, with attribution.** Every player's score and combo updates in real time for everyone in the room. When someone else scores or hits the danger color, you see who it was — not just an anonymous popup.
- **Rank-based results.** The end screen tells you exactly where you placed — "YOU STOOD 1ST!", "2ND!", "3RD!" — with standard competition ranking (ties share a rank).
- **Four host-configurable speeds** (Relaxed → Very Fast) and match lengths (30–120s), tuned and re-tuned against real multiplayer sessions until the fastest tier was genuinely hard rather than unplayable.
- **Last-10-seconds tension**: the timer turns urgent with a pulsing animation and a ticking countdown sound.
- **Solo mode** for practicing alone, and **Play Again** that resets the same room for a new round instead of forcing everyone to re-share a room code — with a short forced delay so the leaderboard can't be skipped past in the heat of the moment.
- **2–10 players per room**, joined via a short shareable room code, with automatic host handoff if the host leaves mid-game.

## Technical highlights

- **Server-authoritative state.** The client never decides what it scored — it sends a tile index, and the server (the only one holding the real grid) looks up the color, computes the result, and broadcasts it. A modified client can't cheat.
- **Independent per-player game boards.** Each player's tile, relight timer, and tap-grace window are tracked separately on the server (not one grid shared by the whole room) — see the production incident below for exactly why this matters once you go past 2 players.
- **Input validation against allow-lists, not trust.** Host-chosen match settings (duration, speed, danger color) are validated against fixed allowed sets on the server; anything out of range — a stale cached value, a tampered client — silently falls back to sane defaults, and a warn-level log records when that fallback fires.
- **Correct N-player game-over logic.** An early implementation ended the *entire match* the instant *any single player's* score went negative — fine for 2 players, but with 6+ players tapping concurrently it killed matches in under a second. Found this with an automated multi-client test, then fixed it so the match only ends early if too few players remain to compete.
- **Structured, environment-aware production logging.** Every room, join, departure, host handoff, and settings mismatch gets a `roomId`-tagged `pino` log line (pretty-printed locally, JSON in production) — filtering by one room ID reconstructs its complete lifecycle for debugging after the fact.
- **Signal-based reactive frontend.** Angular 22 signals and `computed()` drive the whole UI — leaderboard sorting, rank calculation, combo tier labels — with no manual change-detection wiring.
- **Responsive at scale, not just at a breakpoint.** The UI was verified with 10 simulated players at a 320×568 mobile viewport, not just visually inspected at desktop width.

### The production incident: when "it works with 2 players" wasn't enough

The game shipped and ran fine in testing — then a real 6-player session on the live Render deployment produced a very specific, very confusing complaint: everyone saw "+50" / "+10" score popups on every tap, but only one player's score was actually climbing. Rather than guess, I reproduced it **against the live production server** with 6 real Socket.io clients simulating a real match:

| Player | Score after 30s (Relaxed mode) |
|---|---|
| Alice | 1140 |
| Frank | 60 |
| Bob | 30 |
| Carol / Dave / Eve | **0** |

The root cause: the whole room shared **one single lit tile**. With 2 players this is a fair race; with 6, whoever had the lowest latency to the server won nearly every round (Alice won ~90% of them), and the other players' score never had a real chance to move — their taps simply arrived after the tile was already claimed. The identical "+50" popup firing for everyone on every successful tap (with no attribution) is what made it look like a data bug rather than a game-design one.

**Fix:** rewrote the game loop so every player gets their **own independent tile and relight schedule** — same rules, same speed, same danger color, but no longer racing anyone else for the same cell. Verified the fix the same way the bug was found — live against production, not locally:

| Mode | Players | Score-event spread (min–max) | Players locked at zero |
|---|---|---|---|
| Relaxed | 6 | 105–111 | 0 |
| Relaxed | 10 (max capacity) | 102–111 | 0 |
| Normal | 10 | 104–116 | 0 |
| Fast | 10 | 104–114 | 0 |
| Very Fast | 10 | 104–116 | 0 |

Every tier, every player count up to the room cap, every player scores — within roughly 10% of each other, regardless of network latency.

### Other bugs I caught before they shipped

Every one of these was found by actually running the app with simulated multiple clients (Socket.io scripts and headless multi-context Playwright), not by eyeballing the code:

| Bug | How it was found | Fix |
|---|---|---|
| Purple tiles rendered as black | CSS variable name (`--deep-purple`) didn't match what the template referenced (`--purple`) | Renamed the variable to match |
| Entire page content pinned top-left instead of centered | A routed Angular component tag defaults to `display: inline`, silently breaking the flex-centering chain | Added `display: contents` on routed component tags |
| 6-player matches ending after ~1 second | Automated 6-client test showed the match dying almost instantly | Removed the "end match if any player goes negative" rule; now only ends early if too few players remain |
| `<select>` dropdowns always showing the first option, ignoring the real default | `[value]` bound on the parent `<select>` races against its `<option>` children being created | Bound `[selected]` on each `<option>` instead |
| Footer overlapping mid-page content on long 10-player screens | `html, body { height: 100% }` gave the page a *fixed* one-viewport height, so anything after the overflowing content got stretched to a false boundary | Switched to `min-height` so the page grows to fit real content |
| Socket disconnecting mid-room leaked an orphaned relight interval | Caught during the per-player-grid rewrite by tracing a room's full log history after a simulated disconnect | Each player's relight interval is explicitly cleared the moment they leave, not just when the whole room closes |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Angular 22 (standalone components, signals), TypeScript |
| Backend | Node.js, Express, Socket.io |
| Real-time transport | WebSockets via Socket.io, targeted per-socket emits for per-player game state |
| Logging | Pino (structured JSON in production, pretty-printed locally) |
| Styling | Hand-rolled neo-brutalist CSS (no framework) |
| Testing | Vitest (unit), Playwright (multi-client E2E verification), scripted Socket.io load/fairness tests run against the live production server |
| Deployment | Vercel (frontend) + Render (backend) — [live](https://donttouchpurple-av.vercel.app/) |

## Architecture

**Client (Angular)**
- `Home` — create/join a room
- `GameRoom` — waiting room, live grid + HUD, leaderboard, result screen
- `Socket` service — thin socket.io-client wrapper, normalizes server events into app state
- `GameState` service — signal-based single source of truth for the UI

**Server (Node + Socket.io)**
- `index.js` — Express + Socket.io wiring, the authoritative per-player game loop, structured logging
- `rooms.js` — room and player lifecycle, host tracking, per-player grid/interval state
- `gameSettings.js` — validates host-chosen match settings against allow-lists
- `gameLogic.js` — scoring, combo tiers, danger-color penalty
- `colors.js` — grid/tile generation
- `logger.js` — Pino setup, switches transport based on environment

**Event flow:** `createRoom` / `joinRoom` → `startGame` → the server starts an independent relight loop *per player*, sending each one their own `gameStarted` and `syncGrid` events → the client sends `tapTile` with just an index → the server resolves the outcome against that player's own grid and broadcasts `scoreUpdate` (with attribution) to everyone in the room → `gameOver` when the timer runs out.

The server is the only source of truth for scores, every player's grid, and the timer. The client never computes a score — it sends an index and renders whatever the server says happened.

## Getting started

### Prerequisites

- Node.js 20.19+ (developed and tested on Node 24)
- npm

### Run the backend

```bash
cd server
npm install
npm start          # listens on http://localhost:3000
```

### Run the frontend

```bash
cd client
npm install
npm start           # serves on http://localhost:4200
```

Open `http://localhost:4200` in two or more browser tabs/devices to play against yourself locally — create a room in one tab, join it with the room code in the others.

## Testing

```bash
cd client
npm test            # unit tests (Vitest, via Angular's test runner)
```

The multiplayer sync logic, scoring, combo tiers, fairness across concurrent players, and layout at scale were additionally verified with scripted multi-client tests (Socket.io clients and headless multi-context Playwright sessions simulating 2–10 concurrent players, some run directly against the live production server) during development — the bug tables above are a direct result of that process.

## Project structure

```
client/src/app/
├── components/
│   ├── home/              # lobby: create/join/solo
│   └── game-room/         # waiting room, live game, results
├── services/
│   ├── game-state.ts      # signal-based single source of truth
│   ├── socket.ts          # socket.io-client wrapper
│   ├── audio.ts           # synthesized tap/buzz/tick sound effects
│   └── fullscreen.ts      # Fullscreen API wrapper, iOS-aware
├── models/
│   └── game.models.ts     # shared types + constants
└── utils/
    └── ordinal.ts         # 1st/2nd/3rd formatting

server/src/
├── index.js               # Express + Socket.io wiring, per-player game loop
├── rooms.js                # room & player lifecycle, per-player grid state
├── logger.js                # Pino setup
├── colors.js                 # grid/tile generation
├── gameLogic.js                # scoring, combo tiers, penalties
└── gameSettings.js              # host-chosen settings, validated
```

## Deployment

**Backend → Render** (deploy this first, you'll need its URL for the frontend):
1. New **Web Service**, root directory `server/`.
2. Build command: `npm install`. Start command: `npm start`.
3. Once deployed, note the Render URL (e.g. `https://donttouchpurple-server.onrender.com`).

**Frontend → Vercel**:
1. Before building, set `serverUrl` in `client/src/environments/environment.prod.ts` to the Render URL from above.
2. New Vercel project, root directory `client/`. A `vercel.json` is already checked in — it points Vercel at Angular's actual build output (`dist/dont-touch-purple-client/browser`) and adds the SPA rewrite rule client-side routes like `/room/ABCDE` need to survive a page refresh.
3. Deploy, then note the Vercel URL.

**Close the loop:** back on Render, set the `CLIENT_ORIGIN` environment variable to the Vercel URL (e.g. `https://donttouchpurple.vercel.app`) and redeploy, so CORS is locked to your actual frontend instead of the `*` wildcard default.

## Roadmap

- Spectator mode for rooms that are full
- Match history / persistent stats per player
- Custom lobby themes

---

Built by **Abhinav Verma** — [LinkedIn](https://in.linkedin.com/in/abhinavverma2) · [GitHub](https://github.com/abhinavverma007/donttouchpurple)
