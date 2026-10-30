# Peabody AGV Rally

An 8-bit top-down racing game set in the Peabody warehouse. You drive an automated guided vehicle (AGV) loaded with
white boxes along the real AGV delivery routes. Lose boxes in crashes and you take a time penalty.

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
- **Lidar Ping**: E-stops the AGV ahead of you.

Each box lost below 4 adds 2 seconds to your final time.

## Code
Plain HTML5 canvas and JavaScript, no build step. See `CONTRACT.md` for how the modules fit together.
- `js/map.js`: warehouse tile map, routes, doors, mobile racks.
- `js/gfx.js`: pixel-art rendering and bitmap font.
- `js/audio.js`: WebAudio chiptune sound.
- `js/game.js`: game loop, physics, AI, items, menus, HUD.
- `tools/sim.js`: headless race simulator (`node tools/sim.js`).

## Publish to GitHub Pages
```sh
gh repo create agv-rally --public --source=. --push
gh api -X POST repos/{owner}/agv-rally/pages -f "source[branch]=main" -f "source[path]=/"
```
