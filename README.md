# WaRo Kart

An 8-bit racing game set in the Peabody warehouse. You drive an automated guided vehicle (AGV) loaded with
white boxes along the real AGV delivery routes. Lose boxes in crashes and you take a time penalty.

Races use a pseudo-3D chase camera right behind your AGV, in the style of early-90s raycast games: textured walls,
racking, dock doors and the ceiling lights of the real building. The camera trails your heading slightly, pulls back
while you boost and never clips into walls. The HUD shows your position, the time, your boxes, your item, a speed bar,
the area you're in, a minimap and an arrow pointing to the next waypoint, so you don't get lost in the corridors.

Hit something hard enough and your AGV safety-stops: it has to **CALL EHS!** (Environment, Health & Safety) and sits
still for a moment. A really hard crash also knocks a box off.

Everything runs in the browser on one machine. There's no server, no accounts and no online play.

## Play
- Online: open the GitHub Pages URL for this repo.
- Locally: double-click `index.html`, or run `python3 -m http.server` in this folder and open http://localhost:8000.

## Modes
- **1 Player vs CPU**: race 3 computer AGVs.
- **2 Player split screen**: two players on the same keyboard, plus 2 CPU AGVs.
- **Time Trial**: race alone for a best time. Best times are saved in your browser.

## Runs
1. **Stockroom Run**: Dock → Main Hall → Corner → up the Stockroom aisle.
2. **Decon Run**: Dock → Main Hall → Corner → Decon Hallway → Decon Doors.
3. **Double Delivery**: Stockroom drop-off, back to the Corner, then the Decon Doors.

## Controls
| | Player 1 | Player 2 |
|---|---|---|
| Drive | W A S D | Arrow keys |
| Use item | Space | Enter |
| Drift | Left Shift | Right Shift |

Esc pauses and M mutes. In 1-player and Time Trial modes, the arrow keys and Enter also work for player 1.

## Items
- **Priority Label**: speed boost.
- **Shrink-Wrap**: drops a sticky patch behind you.
- **Packing Peanuts**: drops a spill that spins out whoever hits it.
- **Spare Box**: gives you back a lost box.
- **Lidar Ping**: the AGV ahead of you has to CALL EHS!

Each box lost below 4 adds 2 seconds to your final time.

## Code
Plain HTML5 canvas and JavaScript, no build step. See `CONTRACT.md` for how the modules fit together.
- `js/map.js`: warehouse tile map, routes, doors, mobile racks.
- `js/gfx.js`: pixel-art menus, title screen, bitmap font, item icons and the HUD minimap (plus the top-down view,
  used as a fallback).
- `js/tex.js`: procedural pixel-art textures and sprites for the 3D view.
- `js/view3d.js`: the raycast chase-cam renderer (walls, floor/ceiling, doors, mobile racks, billboards).
- `js/audio.js`: WebAudio chiptune sound.
- `js/game.js`: game loop, physics, AI, items, menus, chase camera, HUD.
- `tools/sim.js`: headless race simulator (`node tools/sim.js`).
- `tools/shot.html`: dev screenshot harness that jumps straight into a race
  (`?mode=1p|2p|tt&run=stockroom|decon|double&t=8&at=tx,ty&ang=deg`; see the comment in the file for more).

## Publish to GitHub Pages
```sh
gh repo create waro-kart --public --source=. --push
gh api -X POST repos/{owner}/waro-kart/pages -f "source[branch]=main" -f "source[path]=/"
```
