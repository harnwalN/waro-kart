# WaRo Kart — module contract

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
  title(ctx, t),                         // full-screen 320x180 title-screen art: "WARO KART" logo + animated AGV
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

---

# v2: chase-cam pseudo-3D view (replaces the top-down race view)

The race view is now a **raycast pseudo-3D view from just behind the player's AGV**, in the style of early-90s
"2.5D" games. The world stays the same 2D tile map with the same physics, AI and collision; only race rendering changes.
The top-down `gfx.js` is still used for the title screen, menus, font, panels, item icons and the HUD minimap.
`gfx.drawWorld`/`drawAGV` etc. are no longer used in races.

New load order: `map.js`, `gfx.js`, `tex.js`, `view3d.js`, `audio.js`, `game.js`.

## World-space 3D conventions
- x,y are the same world px as before. z is height in world px, with z=0 at the floor.
- `AGV.WALL_H = 96`: every solid tile is a wall column of this height, and the ceiling is a flat plane at z = WALL_H.
  (CURB tiles are solid for physics but rendered as a yellow **floor** texture, i.e. as a low curb strip.)
- `AGV.DOOR_H = 56`: door leaves (from `AGV.doorLeaves`) are thin boxes of this height.
- Movers (`AGV.moverRect`) are boxes of height WALL_H.
- AGV model size: platform 24 long x 16 wide x 6 tall (z 1..7, with wheels below); four white boxes, each about 11 x 7.5 x 9
  (z 7..16), arranged 2x2 on top. A lidar puck sits at the front.
- Chase camera (computed by game.js): about 44 px behind the racer, eye height `cam.z` about 30, looking along `cam.angle`.
  Horizon row = `vh * 0.40` (+ `cam.pitch` px), so the camera looks slightly down at the AGV. Horizontal FOV about 66°.
  game.js keeps the camera out of walls.

## tex.js → `AGV.tex` (owner: TEX agent)
Procedural pixel-art textures for the 3D view. A texture is `{ w, h, data }`, where `data` is a `Uint32Array(w*h)` of
**ABGR little-endian pixels** (the same layout as `new Uint32Array(imageData.data.buffer)`), row-major. Alpha 0 means
transparent (for sprites). Everything is built procedurally in code in `init()` (and cached lazily). Colors are taken from
`AGV.gfx.PAL` / the photos.
```js
AGV.tex = {
  init(),                                   // build everything; safe to call more than once
  wall(tileId, tx, ty, face) -> texture,    // face: 0 = a face looking north or south (hit on a horizontal grid line), 1 = east or west.
                                            // Size 32 x 96 (u across one tile face, v from top z=WALL_H down to the floor).
                                            // WALL: white with a black base and yellow kick-curb at the bottom, the odd fire extinguisher,
                                            //   a light strip near the top. WINDOW: wall with a dark glass window. DOCKDOOR: roll-up white
                                            //   door with ribs and small windows. RACK: tall pallet racking with teal uprights, orange beams,
                                            //   wire decks and brown/white cartons on 4-5 shelf levels (vary by tx,ty). ROOM/OUTSIDE: plain wall.
  floorIndex: Uint16Array(W*H),             // per map tile: index into floorTextures (built in init from AGV.map)
  floorTextures: [texture 16x16, ...],      // concrete variants, scuff, vinyl, tape, dockplate, curb (yellow top), ...
  ceiling: texture 64x64,                   // dark ceiling with fluorescent light strips / ducts (photo p3, p7), tiled every 64 px
  decal(runKey) -> { scale:2, w, h, data }, // run overlay at 2 world px per cell (w = W*8, h = H*8). data is Uint32 ABGR, 0 = none.
                                            // Contains the dashed route guide line + chevrons in run.color, and the checkered finish rect.
  sprite(name, frame) -> { tex, worldW, worldH, z },  // billboards; frame is optional (default 0). z = base height in world px.
       // names: 'bollard','column','palletjack','bins','crates','cart','exitsign' (z ~ 64),'pickup' (4 frames, bobbing "?" pallet),
       //        'drop_wrap','drop_peanuts','drop_box','ehs' (a yellow "CALL EHS!" sign / hazard beacon that floats over an AGV during E-STOP)
  agv(color, boxes, view, lightRed) -> { tex, worldW, worldH, z:0 },
       // pre-rendered AGV billboard (a small software-3D render of the model above, at a slight overhead camera angle of about 18°).
       // view 0..15: the AGV's heading relative to the camera's line of sight to it, in 22.5° steps, positive = clockwise as seen
       // from above in world coords. view 0 = we see its REAR (lidar puck facing away), 4 = its heading is 90° clockwise from the
       // line of sight (we see its left flank, nose pointing to screen right), 8 = we see its FRONT.
       // boxes 0..4. lightRed: status beacon red instead of green. Cached by key. Texture about 48x32.
  boxFace(kind, face) -> texture             // kind 'door' (white leaf with steel kick plate, 16x56) | 'mover' (face 0 = long side racking,
                                             // face 1 = grey end panel with a black control box), 32x96
};
```

## view3d.js → `AGV.view3d` (owner: VIEW3D agent)
```js
AGV.view3d = {
  init(),                       // after AGV.map and AGV.tex; allocates buffers
  render(ctx, vx, vy, vw, vh, cam, scene)
     // Draws one viewport at screen rect (vx,vy,vw,vh) of the 320x180 canvas using its own ImageData buffer + putImageData.
     // cam   = { x, y, z, angle, pitch, fov }   (fov in radians, default ~1.15)
     // scene = {
     //   t, runKey,
     //   racers:  [{ x, y, angle, color, boxes, estop, boost, finished, tag }],
     //   pickups: [{ x, y }]           (only active ones),
     //   drops:   [{ kind:'wrap'|'peanuts'|'box', x, y }],
     //   doors:   [{ door, openFrac }],
     //   movers:  [{ mover, rect }],
     //   particles: [{ x, y, z, color, size }]
     // }
     // Returns nothing. Must not throw if AGV.tex is missing (use flat placeholder colors).
  project(cam, vw, vh, x, y, z) -> { sx, sy, scale, depth } | null   // world -> viewport px (null if behind the camera);
                                // used by game.js to place floating text (e.g. "CALL EHS!") over AGVs
};
```
Rendering requirements:
- Walls: DDA raycast per screen column against `AGV.isSolid` tiles, ignoring CURB (treated as floor), with perpendicular
  distance correction and a texture u from the hit position.
- Floor and ceiling casting per pixel row.
- Thin dynamic boxes (door leaves, movers) intersected per column with ray-vs-AABB, drawn if nearer than the wall,
  each with its own height.
- Billboards (props from `AGV.map.props` that have a sprite, pickups, drops, racers, `ehs` signs over racers in E-STOP),
  sorted far to near and clipped against a per-column depth buffer.
- Distance shading/fog through lookup tables, so depth reads clearly.
- The player's own AGV is just another billboard; the camera behind it naturally shows its rear.
- Performance target: under 6 ms per frame for a 320x180 viewport, or two 160x180 viewports, in Chrome.

## Naming change: E-STOP → "CALL EHS!"
All player-facing text that said E-STOP now says **CALL EHS!** (EHS = Environment, Health & Safety). Internal
field names (`estop`, `estopT`, sfx `'estop'`) stay unchanged.
