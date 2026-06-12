# Last Lantern

Isometric survival prototype built with three.js. You are a Lightkeeper in an
endless dark forest; your lantern is your only weapon. Survive until dawn
(10 minutes of fuel) while ghouls close in.

## Run it

No build step — everything loads from the jsDelivr CDN via an import map.
Just serve the folder over HTTP (ES modules don't work from `file://`):

```
node tools/serve.mjs        # bundled zero-dependency server on :5173
# or: npx -y serve .  /  python -m http.server 8000
```

Then open http://localhost:5173 in a browser.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move (screen-relative) |
| Mouse | Aim the lantern |
| Hold left click | Focus the light from a 360° circle down to a 45° beam |
| `[` / `]` | Decrease / increase pixelation |

Wide light: weak damage over a large area. Narrow beam: high damage, fast
ticks, longer reach. Enemies hit by a damage tick flash and are briefly
stunned. Ghouls that touch you deal 8 damage; you flash red and get 0.5s of
invulnerability.

## Tuning

Core balance constants live at the top of these files:

- [src/lantern.js](src/lantern.js) — arc limits (360°→45°), range (9→16),
  DPS (7→44), tick rate (0.5s→0.15s), focus in/out speed.
- [src/enemies.js](src/enemies.js) — spawn interval (3.5s→0.8s over 8 min),
  pack size (1→4), max alive (8→45), ghoul HP/speed scaling, touch damage.
- [src/main.js](src/main.js) — fuel (600s), max HP (100), camera offset,
  pixel size, tone-mapping exposure (raise it if the scene reads too dark).
- [src/world.js](src/world.js) — room size (48), gate width, tree/rock
  density, terrain palette.

## Architecture

- `src/main.js` — game loop, isometric ortho camera, input, pixel-art
  post-processing (`RenderPixelatedPass`), HUD wiring, win/lose.
- `src/world.js` — room streaming: the current room plus its 4 orthogonal
  neighbors exist; everything else is disposed. Rooms are deterministic from
  grid coords, fenced by pine walls with a gate per edge, and all static
  flora merges into one draw call per room.
- `src/lantern.js` — the light weapon: point light (wide) + spotlight
  (focused) + a custom ground-sector shader showing the exact damage zone,
  which pulses on every damage tick.
- `src/enemies.js` — ghoul spawner, chase AI with separation, stun/flash on
  damage ticks, difficulty ramp.
- `src/assets.js` — all procedural low-poly assets: lightkeeper, ghoul,
  pines, rocks, grass tufts, glowing mushrooms.
- `src/player.js`, `src/ui.js` — movement/red damage flash, DOM HUD.
