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

1. Drag from a small home to the P parking cell of a matching destination. The default line mode previews the route and builds it when you release. You can also tap the start and end cells. Tap the selected start again or press Escape to cancel.
2. Use the line-mode button below the map to switch to freehand drawing when you want a winding route.
3. Connect adjacent grid points. Horizontal, vertical, and diagonal segments each cost one road tile. Diagonal crossings do not connect unless they share a grid point.
4. Cross water with bridges. Each continuous water span costs one bridge, plus road tiles. Bridges can bend but cannot branch. A diagonal that only touches one water corner stays on land; a dry-to-dry diagonal between two water corners crosses a river seam and uses its own bridge. Crossing bridges do not share a span unless their water endpoints connect.
5. Use the eraser to remove roads. Busy roads turn gray until their cars return home; resources remain reserved until clearance.
6. Pause to plan. Switch to 2× speed to advance time faster.
7. Keep destination demand under control. A full stress ring ends the game.
8. Every 60 game seconds, choose exactly one supply package. The first two offers contain 12 roads or 8 roads and one bridge. Starting with the offer for week 4, you can also choose one motorway and 12 roads, two traffic lights and 10 roads, or one roundabout and 10 roads.

From week 4, the facility buttons show available inventory. Select the motorway tool and tap two nonadjacent land cells to connect them. Motorways cross roads and water without ground-level junctions or bridge costs, and cars travel at twice the normal speed. Route selection accounts for that speed. Select traffic lights or a roundabout and tap a land junction with at least three connections. Lights switch the preferred approach every three game seconds, but an empty junction does not stop a lone car. Roundabouts carry cars around a circular lane and give circulating traffic priority. Use the eraser to tap a facility or motorway endpoint to reclaim it. Busy motorways wait for reserved trips to return home; roundabouts cannot be removed while occupied. Facility edits clear road undo history.

New destinations play a short three-note chime. Sound starts enabled and is unlocked when you start playing. The sound button mutes effects and saves that preference in this browser. Existing destinations do not replay their chime when you resume a save.

Each home has two cars and can connect in all eight directions. New games have 18 road tiles and one bridge available after the starter route. Destinations request an available matching car, and that car reserves one demand pin until arrival.

Every 12 game seconds, the town checks housing supply and can add one home independently of shop openings. It prioritizes colors and land regions below three homes per destination, placing the home near an under-served shop on the same bank. Existing roads, buildings, water, and facilities remain clear. If no suitable cell is available, growth waits for a later check. Every 35 game seconds, the town also attempts to add a home and a destination. Colors unlock every 105 seconds, up to five colors; each color can have multiple destinations. Every destination occupies a shop cell and an adjacent P parking cell. Connect roads to the parking cell from the side or the open frontage. Shop cells reject roads, and unrelated parking lots cannot act as shortcuts. Two adjacent destinations of different colors can share a connected parking area; roads can enter either parking cell from an adjacent road. The map grows by two rows and columns every 70 seconds, from 13×17 to at most 29×33. The camera waits until all fingers lift before fitting the larger map. Growth stops adding buildings at 100 buildings. Saved progress and your best score stay in the current browser when local storage is available. Older saves refund incorrect shoreline bridge charges once. Saves that cannot be restored show recovery controls and keep the original data until the player chooses to start again. Older saves move shops to a clear side of their parking lots where possible. If an old road obstructs the remaining shop location, migration refunds that road and returns affected cars home without awarding a delivery.

Spread or pinch two fingers to zoom between 100% and 300%. Drag with two fingers to move the map.
Select **移動** to pan with one finger. Select **鋪路** or **拆除** to edit again.
The controls below the map include + and − buttons to change zoom. Tap the percentage to return to the full map.
Lift all fingers after a two-finger gesture before you start a new road edit.

Keyboard controls: Space pauses, R selects roads, E selects the eraser, H selects pan, G toggles the grid, 0 resets the view, and Command/Ctrl+Z undoes.

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

This prototype has one town map, five building colors, and local saves. It uses original graphics and code, with no assets from Mini Motorways.

## Behavior reference audit

The November 2026 audit uses public written guides and player reports. It does not claim access to the original game's implementation.

| Mechanic | Evidence and implementation boundary |
| --- | --- |
| Demand-driven round trips | [Steam strategy guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2553726183) describes pin reservations, same-home returns, and shortest routes. These behaviors are implemented. |
| Home cars and entrances | [Kierstin Jones's gameplay guide](https://www.kierstin-jones.com/mini-motorways-general-gameplay) describes two cars and one entrance. This game keeps two cars but permits roads in all eight directions. |
| Dispatch selection | [A player's published support exchange](https://www.reddit.com/r/MiniMotorways/comments/locmfh/the_missing_game_mechanics_help/) describes destinations requesting the quickest available car. This is an indirect developer account. Our equal-speed roads use physical route length; congestion does not change route weights. |
| Delayed removal | [The strategy guide](https://www.kierstin-jones.com/mini-motorways-strategies) describes gray roads and delayed refunds while cars return home. Busy roads now follow this lifecycle. |
| Bridge inventory | [The upgrade guide](https://www.kierstin-jones.com/mini-motorways-upgrades) describes one bridge resource per span, with additional road costs. Our span accounting follows that distinction. |
| Junction traffic | The published support exchange describes negotiated crossings. Our deterministic yielding and slowdown approximate that behavior; they do not reproduce the original priority algorithm. |

Remaining differences: no circular destination upgrades, motorways, traffic lights, roundabouts, or tunnels. Bridges can follow diagonal grid segments. Parking areas provide shared access but do not simulate individual parking bays or circulation lanes. Existing trips retain their chosen route when roads change.

Square destinations hold six pins before overload. Demand rates, driving speeds, grace periods, and weekly supply quantities are local balance settings. The original game's exact values are not verified.
