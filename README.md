# Branchline

A browser-based wooden train track builder.

Play it at: https://stevegolton.github.io/branchline/

## Why

Playing BRIO with my son, I realised that assembling a track that actually
loops back on itself is most of the fun, and the 45° curve is what makes it
a genuine puzzle rather than a rote grid-fitting exercise.

Looking for a digital version that captured the same feeling, I kept finding
track builders that snap everything to a square grid and drop the 45° pieces
entirely, reducing the puzzle to right-angle corners. Others sidestep the
difficulty with flexible tracks that bend to fit, ignore tab gender, or let you
cheat by dipping up and down between levels. Branchline sticks to the original
BRIO piece set and only allows physically possible moves: rotation and
flipping.

## Development

```sh
npm install
npm run dev      # start dev server
npm run build    # type-check and build to dist/
npm run preview  # preview the production build
```

## TODO

Ultimately, I threw this project together in an evening to satisfy an itch.
Right now it's a very basic track editor, not a playable game. I will probably
never touch this again, but if I did, this is what I'd like to do next:

- [ ] Trains (obviously)!
- [ ] Loop detection - some visual feedback when a loop is created.
- [ ] Don't allow pieces to clip into one another.
- [ ] Bridges / levels.
- [ ] More track pieces.
- [ ] Turntables!
- [ ] Canvas or WebGL renderer (right now it's DOM elements and SVG).
- [ ] Mobile support.
