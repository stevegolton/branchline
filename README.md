# Branchline

A browser-based wooden train track builder.

Play it at: https://stevegolton.github.io/branchline/

## Why

While playing BRIO with my son, I realised that a lot of the joy (for me at
least) came from assembling a suitably complex yet viable track loop, and the
45° curve is what makes it a genuine puzzle rather than a rote grid-fitting
exercise.

Looking for a digital version that captured the same feeling, I kept finding
track builders that snap everything to a square grid and drop the 45° pieces
entirely, reducing the puzzle to right-angle corners. Others sidestep the
difficulty with flexible tracks that bend to fit, ignore tab gender, or let you
cheat by dipping up and down between levels. Branchline sticks to the original
BRIO piece set and only allows valid transforms — rotation and
flipping.

## Development

```sh
npm install
npm run dev      # start dev server
npm run build    # type-check and build to dist/
npm run preview  # preview the production build
```

## Plan

### MVP

- Tree based track builder.
- Undo/redo.
- Four track pieces:
  - Straight.
  - Curved.
  - Male split.
  - Female split.
- Saved states in localstorage.
- Trains which can be dragged and dropped onto tracks, and just start running when placed on a track.
- Track building shortcuts.
  - Copy/paste entire tree
  - Duplicate entire tree.
  - Hotkeys to add track types.
  - Toolbox to drag track pieces out onto the workspace.
- Don't allow collisions with other pieces.
- Trash can to drop nodes into.

### Better Trains

- Carriages with magnetic physics.
- Train/carriage collisions.

### Elevation

- Ramp up/down pieces - can cross over other pieces.

### Automation

- Switchable points.
- Buffers and stop signs.

### Make it pretty

- 3D orthographic renderer - heavily stylized.

### Stations/Passengers and Cargo

- Add stations with supply and demand.

### Gamification

- Add proper levels, tasks, success state / fail state.
  - Deliver passengers from areas of supply to demand (similar to mini metro).

## TODO

Ultimately, I threw this project together in an evening to scratch an itch.
Right now it's a very basic track editor, not a playable game. I will probably
never touch this again, but if I did, this is what I'd like to do next:

- [ ] Trains (obviously)!
- [ ] Workspace zoom in/out.
- [ ] Level saving and sharing.
- [ ] Bridges / levels.
- [ ] Don't allow pieces to clip through each other (require bridge pieces or crossroads in order to cross).
- [ ] Interactive pieces (points, turntables, bridges, etc...).
- [ ] Cool-looking isometric rendering.
- [ ] Canvas or WebGL renderer (right now it's DOM elements and SVG).
- [ ] Mobile support.
- [ ] Many more pieces!
