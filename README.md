# Mike's Hybrid Strength, Balance & Mobility Program

A small phone app (plain HTML, CSS and JavaScript - no build step, no libraries, no internet needed after the first visit).
Web address once GitHub Pages is on: https://machineguy989.github.io/Exercise-app/

## Where things are
- `data.js` - **all the words and numbers** (exercises, tips, progression, success targets). Edit here.
- `index.html`, `styles.css`, `app.js`, `core.js` - the app itself.
- `manifest.webmanifest`, `sw.js`, `icons/` - Home Screen install and offline support.
- `tests/` - automated checks (see `tests/README.md`). Not needed to run the app.

## Saved data
Everything is saved on the phone in the browser's storage, under names that start with `mikeExercise.`.
Use **Data > Export progress** to make a backup file.

## After changing a file
The app normally fetches the newest files whenever the phone is online. To force phones to drop old saved copies,
change `CACHE = 'mikeExercise-v1'` in `sw.js` to `-v2`, `-v3`, ...
