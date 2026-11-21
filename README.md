# Radon (webOS app)

An internet-radio browser and player for LG webOS TV, made for a remote control. Stations come from the public
[radio-browser.info](https://www.radio-browser.info) directory. There is no server to run and nothing to install
except the app itself.

## What it does

- **Home**: genre shelves (Rock, Pop, Jazz & Blues, ...) of top stations for your country, each ending in "See all".
- **Search**: type a station name *or a genre*; narrow with Country, Genre, Bitrate and Sort. Results are paged.
- **Favorites**, **Settings** (play last station on start, open on Now Playing or Home, genres hidden from Search).
- **Station page**: artwork, flag, genres, Play / Favorite / Quality, a *Recently played* list and *Other streams*
  (sibling channels of the same broadcaster).
- **Now Playing**: full-screen cover art, song, artist and host, with an animated background. Song info comes from the
  station's own feed or stream. Opens automatically at launch if there is something to resume.
- Exits with an Apple-TV-style "Do you want to exit?" prompt (Back at the top, then Back again or Exit).

Remote: arrows move; OK selects; Back steps back; Yellow toggles a favorite; Blue opens "Other streams"; Play / Pause /
Stop work; CH+/CH- (or PageUp/PageDown) turn pages in Search. The Magic Remote pointer works too (hovering focuses).

## Layout

- `src/` - the app itself; this is what gets packaged (`appinfo.json` lives here)
- `assets/` - icon source (`radon-icon.svg`). `src/radon-icon-80.png`, `src/radon-icon-130.png` and `src/splash.png` are
  rendered from it. The PNG file names are new on purpose: the TV launcher caches icons by name.
- `dist/` - built `.ipk` files (git-ignored)
- `build.sh` - runs `ares-package`
- `DEVELOPERS.md` - **start here if you are changing the code**: architecture, file-by-file purpose, TV quirks, testing

## Build and install on the TV (device `lgtv`)

Needs LG's CLI (`npm i -g @webos-tools/cli`) and a TV in Developer Mode with a device named `lgtv`
(`ares-setup-device`).

    cd ~/Developer/webos/radio-app
    ./build.sh
    ares-install --device lgtv dist/com.craig.radio_<version>_all.ipk
    ares-launch  --device lgtv com.craig.radio

Bump `version` in `src/appinfo.json` before each install. Uninstall: `ares-install --device lgtv --remove com.craig.radio`
(this also erases the app's saved favorites and settings).

## Try it on a computer

Open `src/index.html` in Chrome. The layout scales to the window and the arrow keys, Enter and Esc (Back) work as on the
remote. See `DEVELOPERS.md` for scripted testing.

## Known limits

- No equalizer or real visualizer: the TV plays the stream outside the app's reach. The bars on Now Playing are decorative.
- When the app is not in the foreground, webOS freezes its script (audio may continue; song info will not update).
- Favorites and settings live in the app's own storage on the TV only.

## Dev container

Open the folder in VS Code and choose "Reopen in Container" (or use GitHub Codespaces). It provides Node 22, the
`ares-*` CLI, Claude Code (CLI and VS Code extension; your host `~/.claude` and `~/.claude.json` are bind-mounted,
so login and settings carry over) and Chromium (`$CHROME_BIN`) for headless tests, so `./build.sh` works out of the box. To install on the
TV, the container must be able to reach it on your network and have the `lgtv` device set up (`ares-setup-device`);
that is easiest on Linux hosts, as Docker Desktop on macOS may need extra networking.
