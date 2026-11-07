# Little Roads · 小城流動

An original road-planning game for phones. Draw roads between homes and matching destinations, manage traffic, and choose weekly supplies.

Play on GitHub Pages: **https://tigercosmos.github.io/mini-motor-ways/**

Pushes to `main` run the tests, build `dist/`, and deploy through GitHub Actions. Pull requests run validation without publishing.

## Run locally

Use Node.js 20 or later. No dependency installation is required.

```sh
npm run dev
```

Open `http://localhost:5173`. To play on an iPhone, connect it to the same Wi-Fi and open `http://<your-computer-LAN-IP>:5173`.

The server listens on all network interfaces. Allow local network access if your operating system prompts you.

## Play

1. Drag from a small home to a destination of the same color.
2. Connect adjacent grid points. Each segment costs one road tile.
3. Cross water with bridges. Each continuous water span costs one bridge, plus road tiles. Bridges can bend but cannot branch.
4. Use the eraser to remove roads. Busy roads turn gray until their cars return home; resources remain reserved until clearance.
5. Pause to plan. Switch to 2× speed to advance time faster.
6. Keep destination demand under control. A full stress ring ends the game.
7. Every 60 game seconds, choose 25 roads or 15 roads and two bridges.

Each home has two cars and one active driveway. Destinations request an available matching car, and that car reserves one demand pin until arrival.

The town adds buildings as weeks pass. Saved progress and your best score stay in the current browser when local storage is available.

Keyboard controls: Space pauses, R selects roads, E selects the eraser, G toggles the grid, and Command/Ctrl+Z undoes.

On iPhone, open the deployed HTTPS address in Safari and choose **Share → Add to Home Screen**. HTTPS enables the offline cache after the first successful load.

## Validate and build

```sh
npm test
npm run build
```

Serve `dist/` with a static web server. To inspect the production build locally:

```sh
SERVE_DIST=1 PORT=5174 npm start
```

Tests cover routing, deliveries, congestion failure, resources, upgrades, save validation, and pointer gestures. Browser checks cover desktop, 390×844, 375×667, and 844×390 layouts. Physical iPhone behavior and offline installation need device testing.

## Source reference

| File | Responsibility |
| --- | --- |
| `src/engine.js` | Seeded simulation, routing, traffic, growth, resources, and saves |
| `src/board.js` | Canvas rendering, pointer input, and grid coordinates |
| `src/app.js` | Game loop, controls, dialogs, sound, and browser persistence |
| `src/styles.css` | Responsive layout and visual design |
| `tests/` | Dependency-free Node regression tests |

This prototype has one town map, three building colors, and local saves. It uses original graphics and code, with no assets from Mini Motorways.

## Behavior reference audit

The November 2026 audit uses public written guides and player reports. It does not claim access to the original game's implementation.

| Mechanic | Evidence and implementation boundary |
| --- | --- |
| Demand-driven round trips | [Steam strategy guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2553726183) describes pin reservations, same-home returns, and shortest routes. These behaviors are implemented. |
| Two cars and one entrance per home | [Kierstin Jones's gameplay guide](https://www.kierstin-jones.com/mini-motorways-general-gameplay) describes both rules. Both are implemented. |
| Dispatch selection | [A player's published support exchange](https://www.reddit.com/r/MiniMotorways/comments/locmfh/the_missing_game_mechanics_help/) describes destinations requesting the quickest available car. This is an indirect developer account. Our equal-speed roads use physical route length; congestion does not change route weights. |
| Delayed removal | [The strategy guide](https://www.kierstin-jones.com/mini-motorways-strategies) describes gray roads and delayed refunds while cars return home. Busy roads now follow this lifecycle. |
| Bridge inventory | [The upgrade guide](https://www.kierstin-jones.com/mini-motorways-upgrades) describes one bridge resource per span, with additional road costs. Our span accounting follows that distinction. |
| Junction traffic | The published support exchange describes negotiated crossings. Our deterministic yielding and slowdown approximate that behavior; they do not reproduce the original priority algorithm. |

Remaining differences: fixed map size, at most 18 buildings and three destinations, no circular destination upgrades, and no motorways, traffic lights, roundabouts, or tunnels. Bridges follow horizontal or vertical grid segments. Buildings use simplified entrance geometry, without parking-lot circulation. Existing trips retain their chosen route when roads change.

Square destinations hold six pins before overload. Demand rates, driving speeds, grace periods, and weekly supply quantities are local balance settings. The original game's exact values are not verified.
