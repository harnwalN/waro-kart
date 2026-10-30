# Peabody AGV Rally — module contract

This is the shared interface between the four JS files. Every file attaches to one global, `window.AGV`, and starts with
`window.AGV = window.AGV || {};`. The files are classic `<script>` tags, not ES modules, so the game works from
`file://` and from a GitHub Pages subpath. Load order: `map.js`, `gfx.js`, `audio.js`, `game.js`.
Don't make network requests, don't load external fonts or images, don't use build tools. The code must run in current
Chrome, Safari and Firefox.

`map.js` and `game.js` must also load in **Node** with no DOM: wrap any `window` use as
`var AGV = (typeof window !== 'undefined' ? window : globalThis).AGV = ...`, and touch `document` or `canvas`
only inside functions that are called at runtime, never at load time. The headless simulator `tools/sim.js` needs this.

## Coordinates and units
- `AGV.TILE = 16`, the size of one tile in world pixels. One tile is about 2 ft of the real building.
- World coordinates are pixels with the origin at the top-left. +x is east, +y is south (screen down).
  North is up, which matches the floor plan.
- Angles are radians: 0 faces east (+x), PI/2 faces south (+y).
- Internal render size: `AGV.VIEW_W = 320`, `AGV.VIEW_H = 180`. The canvas is scaled up with integer scaling and
  `image-rendering: pixelated`. In 2P split-screen each player gets a 160x180 viewport (left = P1, right = P2).
- An AGV's collision body is a circle of radius 9 px. It is drawn about 24 px long and 16 px wide.

## map.js → `AGV.map`, `AGV.T`, helpers (owner: MAP agent)
```js
AGV.T = { FLOOR:0, SCUFF:1, VINYL:2, WALL:3, RACK:4, ROOM:5, DOCKDOOR:6, WINDOW:7, OUTSIDE:8, TAPE:9, DOCKPLATE:10, CURB:11 };
// FLOOR/SCUFF/TAPE/DOCKPLATE = concrete-grip drivable floor; VINYL = drivable low-grip floor (Decon zone)
// WALL, RACK, ROOM (inside of a walled-off room, drawn as a "roof" block), DOCKDOOR, WINDOW, OUTSIDE, CURB = solid
// CURB = the yellow kick-curb; place it as a 1-tile solid strip along corridor walls where it fits the photos (optional)
AGV.isSolid(tileId) -> bool
AGV.map = {
  W, H,                        // size in tiles (aim for roughly 140-180 x 120-160)
  tiles,                       // Uint8Array(W*H), row-major: tiles[ty*W+tx]
  at(tx, ty) -> tileId,        // OUTSIDE when out of bounds
  rooms:  [{ name:'QI PROCESSING', num:'119', x, y, w, h }],                 // tiles; for gfx labels + minimap
  areas:  [{ name:'MAIN HALL', x, y, w, h }],                                // tiles; drivable zones, for HUD "location" text
  props:  [{ type, x, y, w, h, solid }],   // world px, x/y = CENTER. type in:
          // 'bollard' (8x8 solid), 'column' (10x10 solid), 'palletjack' (solid), 'bins' (blue bin stack, solid),
          // 'crates' (red crate stack, solid), 'cart' (laundry/canvas cart, solid), 'extinguisher' (wall decal, not solid),
          // 'stairs' (not solid, drawn over ROOM/WALL tiles), 'panel' (rack control box, wall decal, not solid),
          // 'exitsign' (decal), 'cornerguard' (steel guard, decal)
  doors:  [{ id, x, y, len, axis, period, phase }],
          // x,y = tile coords of the opening's top-left; len = opening width in tiles
          // axis 'h': opening runs horizontally (cars pass north/south); 'v': opening runs vertically (cars pass east/west)
  movers: [{ id, x, y, w, h, dx, dy, period, phase }],
          // mobile rack: rect in tiles at rest; slides by (dx,dy) tiles and back over `period` seconds
  pickups:[{ x, y }],                                                        // world px centers of "?" pallets
  runs: {
    stockroom: RUN, decon: RUN, double: RUN
  }
};
RUN = {
  key, name:'STOCKROOM RUN', color:'#e04040' (red) | '#3a7bff' (blue) | '#c060ff' (double),
  grid: [{x, y, angle}] x4,     // world px start slots, inside the Dock, slot 0 = pole position
  waypoints: [{x, y, r, label?}],   // world px, in order; a racer must come within r px of each one, in order.
                                    // The LAST waypoint is the finish. label is optional (e.g. 'STOCKROOM DROP-OFF').
                                    // Space them 3-8 tiles apart, with straight unobstructed segments between
                                    // consecutive waypoints (the CPU steers straight at them). r is about 40-64 px.
  finish: { x, y, w, h }          // world px rect for drawing the checkered finish line around the last waypoint
};
// Geometry helpers (shared so drawing and collision always agree):
AGV.doorOpen(door, t) -> 0..1     // 1 = fully open. Smooth cycle: mostly open, ~1.2 s closed per period
AGV.doorLeaves(door, openFrac) -> [{x,y,w,h}]   // world-px solid rects of the two leaves. They grow from the jambs
                                   // toward the center but NEVER close fully: at openFrac 0 a 2-tile gap stays in the middle.
                                   // At openFrac 1 they are flat against the jambs (length 0 into the opening).
AGV.moverRect(mover, t) -> {x,y,w,h}   // current world-px rect of a mobile rack at time t (seconds)
AGV.areaAt(x, y) -> area name or ''    // world px
```
Map requirements: these come from the floor plan and route slide.
- Real layout, simplified: the **Dock / Inbound-Outbound (121)** big bay on the west side, with dock doors on the west wall.
  The route goes north from the Dock past **Chemical Storage (122)** through a doorway into the west end of the **Main Hall**,
  then runs east along the Main Hall (the long 137 ft corridor; windows into **QI Processing 119** and **Parts Cleaning 117**
  on its south wall, the stair landing near the west end) to the **Corner** at the east end.
  - From the Corner, going north through double doors leads into the **Stockroom (126)**: a huge space with long N-S racking
    rows and aisles. The red route runs up the main aisle to the north end.
  - From the Corner, going south leads down the narrow **Decon Hallway** (alongside **Decon 116**) to the **Decon Doors**,
    where the floor turns to VINYL.
  - The rest of the building (Pick-to-Order 127, Finished Goods 128, QI Staging 120, MRB 114, Field Service 115, Breakroom,
    Lobby, etc.) is ROOM blocks with labels, so the plan reads correctly.
- Widen corridors for play: drivable width at least 6 tiles everywhere along the routes (the Main Hall about 8, the Decon
  Hallway about 6, the Stockroom main aisle about 8).
- Path lengths: Stockroom run about 170-210 tiles of travel, Decon run about 150-180, Double about 330-400 (Stockroom drop-off,
  then back south to the Corner, then down to the Decon Doors).
- Doors: one set at the Corner → Stockroom entrance and one at the Decon Doors (period 5-7 s, phases staggered).
- Movers: 2-4 mobile racks in the Stockroom that slide sideways into the main aisle but always leave at least 4 tiles clear.
- Pickups: about 10-16 placed along the routes (Dock exit, Main Hall, Corner, Stockroom aisle, Decon Hallway).
- Props: dock clutter matching the dock photo (blue bins, red crates, white column, pallet jack, cart, yellow bollards near
  the dock doors), yellow bollards at Stockroom rack ends, extinguisher/exit decals. Keep solid props out of
  the straight lines between consecutive waypoints.

## gfx.js → `AGV.gfx` (owner: ART agent)
All drawing goes onto a 2D context of the internal-resolution canvas (`imageSmoothingEnabled = false`).
`camX, camY` = world px of the viewport's top-left. `vw, vh` = viewport size in px. The engine sets a clip rect and
translates the context so (0,0) is the viewport's top-left, so gfx functions draw at `worldX - camX`.
```js
AGV.gfx = {
  PAL: { ... },                          // named colors (concrete, scuff, wall, yellow, black, steel, rackTeal, rackOrange, vinyl, ...)
  init(),                                // pre-render tile/prop sprites into offscreen canvases; called once after the map loads
  drawWorld(ctx, camX, camY, vw, vh, t), // floor tiles, walls, ROOM blocks with name plates, static props, decals
  drawGuide(ctx, run, camX, camY, t),    // faint dashed guide line along run.waypoints in run.color (the slide arrows)
  drawFinish(ctx, run, camX, camY, t),   // checkered finish line at run.finish
  drawDoor(ctx, door, openFrac, camX, camY, t),     // white double door leaves (use AGV.doorLeaves for geometry), steel kick plates
  drawMover(ctx, mover, rect, camX, camY, t),       // mobile rack: grey end panel + teal/orange racking, yellow/black stripes
  drawPickup(ctx, x, y, t),              // glowing "?" pallet (world px)
  drawDrop(ctx, kind, x, y, t),          // floor hazards: 'wrap' (shrink-wrap patch), 'peanuts' (packing peanut spill), 'box' (dropped white box)
  drawAGV(ctx, x, y, angle, o),          // world px center; o = { color, boxes:0..4, wobble:-1..1, estop:bool, boost:bool, t, tag:'P1'|'P2'|'' }
                                         // low charcoal platform, 4 small corner wheels, lidar puck at the FRONT,
                                         // LED strip in o.color, status light (green, red flashing when estop),
                                         // 2x2 plain white boxes with a navy side stripe on top (o.boxes visible; offset by wobble).
                                         // Boost: little exhaust sparks / speed lines. Draw tag above it if given.
  drawParticles(ctx, parts, camX, camY), // parts: [{x,y,vx,vy,life,color,size}]
  // Screen-space UI (not camera-relative):
  text(ctx, str, x, y, color, scale=1, align='left'),   // built-in bitmap pixel font (uppercase A-Z, 0-9, punctuation . : - ! ? / ' + x , ( ) # %)
  textWidth(str, scale=1) -> px,
  itemIcon(ctx, item, x, y),             // 16x16 icon; item in 'boost'|'wrap'|'peanuts'|'box'|'ping'
  minimap(ctx, x, y, w, h, run, dots),   // whole-map overview (pre-rendered once), route line, dots: [{x,y,color}] world px
  panel(ctx, x, y, w, h),                // 8-bit framed UI box (dark fill, light border)
  title(ctx, t),                         // full-screen 320x180 title-screen art: "PEABODY AGV RALLY" logo + animated AGV
};
```

## audio.js → `AGV.sfx` (owner: ART agent)
WebAudio only, synthesized square/triangle/noise. Every call must be a no-op that never throws when audio is
unavailable or not yet unlocked.
```js
AGV.sfx = {
  unlock(),               // call on the first keydown; creates/resumes the AudioContext
  play(name),             // 'menu','select','count','go','bump','estop','pickup','boost','drop','ping','boxlost','finish','checkpoint'
  engine(i, speedFrac),   // continuous engine hum for human player i (0 or 1), speedFrac 0..1; engine(i,-1) silences it
  music(on),              // short looping chiptune for menus and races, on/off
  muted, toggleMute()     // M key
};
```

## game.js → `AGV.game` (owner: ENGINE agent)
Everything else: boot, input, menus, race simulation, AI, items, hazards, cameras, split-screen, HUD, results,
best times. The simulation is **separated from rendering** so it runs headless:
```js
AGV.game = {
  boot(canvas),                                 // called by index.html on DOMContentLoaded
  createRace(runKey, mode, opts) -> race,       // mode: '1p' | '2p' | 'tt'; opts.humans: number of humans (0 for headless CPU-only), opts.seed
  step(race, dt, inputs),                       // fixed-step simulation (dt = 1/60). inputs: [{up,down,left,right,drift,item}] per human
  // race.racers: [{ x, y, angle, speed, boxes, finished, finishTime, wp (next waypoint index), human, color, name, ... }]
  // race.t, race.done
};
```
Key bindings: P1 = WASD + Space (item) + Left Shift (drift). P2 = Arrow keys + Enter (item) + Right Shift (drift).
Menus: arrows/WASD + Enter/Space. Esc = pause/back. M = mute. Use `KeyboardEvent.code` and `preventDefault` on game keys.
