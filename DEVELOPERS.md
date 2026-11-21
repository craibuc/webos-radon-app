# Radon: developer guide

This guide is for people changing Radon's code. Read it once top to bottom, then use it as a map. User-facing
information (what the app does, how to install it) is in `README.md`.

Contents: [1. At a glance](#1-at-a-glance) · [2. Decisions and constraints](#2-decisions-and-constraints) ·
[3. Files](#3-files) · [4. How the app works](#4-how-the-app-works) · [5. Styling](#5-styling) ·
[6. The TV: facts and quirks](#6-the-tv-facts-and-quirks) · [7. Workflow](#7-workflow) · [8. Testing](#8-testing) ·
[9. Recipes](#9-recipes) · [10. Known leftovers](#10-known-leftovers-and-limits) · [11. Troubleshooting](#11-troubleshooting)

---

## 1. At a glance

- A web app (HTML + CSS + plain JavaScript) packaged as an `.ipk` for **LG webOS TV**. Target: LG OLED65G3PUA,
  webOS 11.2 (marketed as "webOS 26"), Chromium 132, fixed **1920x1080**, **remote control only**.
- **No framework, no bundler, no runtime dependencies, no server.** Everything the app needs is in `src/`. The only
  external things it uses are public web services (section 4.5).
- All app logic is one file, `src/app.js` (about 1,400 lines, one IIFE, banner comments between sections). Four small
  scripts supply data and helpers to it. State is plain objects; the DOM is built with a tiny `el()` helper and updated
  by `render*()` functions.
- Everything on screen is selected by **focus**. There is no mouse-style hover or click flow to design for.

```
index.html ──loads──> regions.js  genres.js  providers.js  nowplaying.js  fit.js  app.js
                          │          │           │             │                    │
                          └──────────┴───────────┴─────────────┴── window globals ──┘ (read by app.js)
```

## 2. Decisions and constraints

These are deliberate. Check them before "improving" something.

| Decision | Why |
|---|---|
| No dependencies; no proxy or server component | Owner's requirement. Also unnecessary: the TV's web view does not enforce CORS for this app, so it can call the directory, station streams and feeds directly (section 6). |
| App id is `com.craig.radio`, display name is **Radon** | The id is the key for the app's saved data on the TV. Changing it makes the TV treat it as a different app and loses favorites and settings. Only the *title* changed. |
| Icon files have unique names (`radon-icon-80.png`, ...) | The launcher caches icons by file name. When the artwork changes, change the names too (section 9). |
| Nothing plays unless the user presses Play | Cards open a station page first. Only the "Play last station on start" setting auto-plays. |
| Stopping instead of pausing | A paused live stream resumes from stale buffered audio. |
| One `<audio>` element, native playback | The TV plays it outside the app's reach (see 6), so there is no in-app equalizer or real visualizer. |
| Exit by `window.close()`, not `PalmSystem.platformBack()` | `platformBack` makes the TV open its recent-apps screen first, which looked like a second exit prompt. `platformBack` remains only as a delayed fallback. |
| Back is handled by the app (`disableBackHistoryAPI: true`) | The app owns the whole Back chain and the exit prompt. |

## 3. Files

Paths are relative to `radio-app/`. Everything under `src/` is packaged into the app.

### Project level

| File | Purpose |
|---|---|
| `README.md` | What the app does, how to build/install. |
| `DEVELOPERS.md` | This guide. |
| `build.sh` | `ares-package src -o dist`. Output `dist/<id>_<version>_all.ipk`. Note this `ares-package` version minifies JS and has no switch to disable it, so the code on the TV differs from `src/`. |
| `assets/radon-icon.svg` | Source artwork for the icon and the launch splash (render instructions are in the file's comment). |
| `.gitignore` | Ignores `dist/`, editor and OS files. |
| `dist/` | Build output (git-ignored). |

### `src/` (the packaged app)

| File | Purpose |
|---|---|
| `appinfo.json` | webOS manifest (JSON cannot hold comments, so fields are explained below). |
| `index.html` | Page skeleton: header nav, main areas, the two overlays, exit dialog, pop-up list, `<audio>`. Comments describe the structure and script order. |
| `style.css` | All styling, dark theme, fixed 1920x1080. Banner comment lists conventions and sections. |
| `app.js` | The application (state, rendering, navigation, playback, pages). Header comment gives the reading order. |
| `nowplaying.js` | Now-playing feed: `window.NowPlaying.start(station, emit) -> stop()`. MPR WebSocket adapter, ICY-from-stream adapter, iTunes cover-art lookup. No DOM access. |
| `providers.js` | Curated multi-stream providers (`window.PROVIDERS`); currently The Current / MPR with 13 streams. Schema documented in the file. |
| `genres.js` | Genre families (`window.GENRES`): Metal & Punk, Rock, Pop, ... Used by the Genre picker, the Home shelves, "All <family>" filtering and the hide-genres setting. |
| `regions.js` | Country code to region (`window.regionOf`, `window.REGION_ORDER`); groups the Country picker. |
| `fit.js` | Scales the 1920x1080 page to the window when opened in a desktop browser. Does nothing on the TV. |
| `flags/` | 270 SVG flags (`xx.svg`, from the MIT-licensed `flag-icons` project; licence in `flags/LICENSE-flag-icons.txt`). Bundled because emoji flags are not reliably in a TV's fonts. |
| `icons/the-current.png` | Logo used for MPR streams that have no logo of their own. |
| `radon-icon-80.png`, `radon-icon-130.png` | App icon (`icon`, 80x80) and large icon (`largeIcon`, 130x130), rendered from `assets/radon-icon.svg`. |
| `splash.png` | 1920x1080 launch splash (`splashBackground`). Without one webOS shows a generic web-app splash. |

### `appinfo.json` fields

| Field | Value / meaning |
|---|---|
| `id` | `com.craig.radio`. Do not change (section 2). |
| `version` | Bump for every install; the TV treats a new version as an update. |
| `title` | `Radon`: the name in the launcher. |
| `type`, `main` | `web`, `index.html`. |
| `icon`, `largeIcon` | `radon-icon-80.png`, `radon-icon-130.png`. |
| `splashBackground`, `bgColor` | `splash.png`, `#0e1116`: the launch screen. |
| `resolution` | `1920x1080`. |
| `disableBackHistoryAPI` | `true`: the app, not the platform, handles Back. |

## 4. How the app works

### 4.1 Screens and overlays

`state.view` is one of `'browse'` (Home), `'search'`, `'favorites'`, `'settings'`. Two overlays can sit on top:

```
 ┌ #top ───────────────────────────────────────────────┐
 │  #nav  [Search][Home][Favorites][Now Playing][Settings]   always visible
 │  #searchrow + #filters                                    Search page only
 └─────────────────────────────────────────────────────┘
 #main :  #home (genre shelves) | #grid (Search results / Favorites) | #settings   (+ #empty, #pager)
 #detail  overlay: station page             state.detail  (hides #main and the header rows)
 #nowpage overlay: Now Playing              state.nowOpen (hides #main and the header rows)
 #exit-dialog, #picker                      modal layers above everything
```

`renderChrome()` decides what is visible from `view`, `detail` and `nowOpen`. Overlays use the `hidden` attribute.

### 4.2 Focus is the interface

- Every interactive element is a `<button>` (or the search `<input>`) with class **`f`**. The focus look is one CSS rule.
- The TV gives web apps no arrow-key navigation, so **`move(dir)`** does it: among all visible `.f` elements it picks the
  best one in the direction of travel, judged by edge gaps and overlap (not centres), with small tie-breakers.
  Moving up into the nav lands on the *active* tab.
- **Focus on a nav tab activates it** (`NAV_ACTIONS`): there is no click step. These handlers are idempotent because
  focusing a tab is also how code hands focus back to the nav. A station page opened from Home stays open when you move
  up to the Home tab (you are already in that section).
- **Search box**: while merely focused it is `readonly` (highlight only, no on-screen keyboard). OK makes it editable;
  arrow keys, Enter or Back end editing, and Left/Right at the text edges step out (`startEdit` / `endEdit`).
- **Back** (`461`) unwinds in this order: typing, exit prompt (confirms exit), pop-up list, Now Playing, station page,
  Search/Favorites/Settings to Home, then the exit prompt. A freshly launched Now Playing (`state.fresh`) goes straight to
  the prompt because nothing is behind it.
- Other keys: Yellow `405` toggles a favorite (focused card, open page or playing station); Blue `406` opens the
  "Other streams" tab; Play `415`, Pause `19`, Stop `413`, Play/Pause `463`; PageUp/Down and CH-/CH+ turn Search pages.
- The Magic Remote pointer works because hovering a `.f` element focuses it.

### 4.3 Stations

The directory returns a record per *encoding* (for example "MPR News [AAC 48k]" and "MPR News (MP3 128k)"). `compact()`
turns a record into the app's station object, and `mergeInto()` folds encodings into one:

```
station = { id, name, url, alt, favicon, cc, country, tags, codec, bitrate, hls, homepage, lang,
            variants: [{uuid, url, alt, codec, bitrate}, ...],      // all encodings, best first
            uuid }                                                   // directory id of the best encoding
id      = 'g:<country code>|<base name>'   // stable between sessions; used by favorites and "now playing" markers
```

- The base name strips codec and bitrate tags (`displayName`, `baseKey`); the bitrate in a *name* beats the directory's number.
- `sameStation(a, b)` is how the app asks "is this the same station?": ids, then any shared stream address. Use it, not `===`.
- Favorites store whole station objects, so they display without network access.
- Providers (`providers.js`) and "Other streams" use the same shape.

### 4.4 Search and Home

**Search** (`loadPage`) is paged, 40 per page. Each page's results are cached (`lists.search.pages`). Rules:

- Typed text matches a station's **name or genre**. The directory ANDs its filters, so that is two requests (`name=`,
  `tag=`), merged and sorted by the chosen order. If a Genre filter is set, the text narrows by name *within* that genre.
- "All <family>" runs one request per family term in parallel and keeps stations whose tags pass the family's regex
  (this removes substring accidents such as "popular" for "pop").
- Client-side filters then apply: HLS streams dropped (not playable in `<audio>`), stations already shown on an earlier
  page dropped, genres hidden in Settings dropped (never the genre you picked yourself). A page that ends up empty
  advances up to 3 pages by itself.
- Search waits until it has something to look for (text or a filter).
- `lists.search` is reached through `state.stations`, `state.page`, ... (accessors defined at startup). `lists.browse` is a
  leftover (section 10).

**Home** (`loadHome`) fires one request per genre family (the family's first term, then the family regex), for your
country (`state.filters.cc` if set, otherwise the region of `navigator.language`). Shelves render as results arrive; a
station appears only in the first shelf that claims it. "See all" sets the Genre filter and switches to Search.

### 4.5 Network sources

| Service | Used for | Where |
|---|---|---|
| `de1` / `de2.api.radio-browser.info` | Station directory: countries, tags, search, listen counter (`/json/url/<uuid>`) | `api()` in `app.js` (fails over between mirrors, 10 s timeout) |
| `wss://nowplayingv2.publicradio.org` | MPR playlist (`/playlist/<id>/v2`) and schedule (`/schedule/<id>/v1`) feeds | `nowplaying.js`, `mprAdapter` |
| The station's own stream | Song titles via the ICY protocol (`Icy-MetaData` request header) | `nowplaying.js`, `icyAdapter` |
| `itunes.apple.com/search` | Cover art when a song has artist and title but no art | `nowplaying.js`, `findArt` |
| thecurrent.org | Source of the MPR stream list in `providers.js` (copied once; not fetched at runtime) | `providers.js` |

### 4.6 Playback

- `play(station, variant?)` sets `state.current`, builds `attempts` (stream URLs, preferred variant first), starts the
  now-playing feed and calls `start(url)`. `onFail()` advances to the next attempt, then reports an error.
- Browsers can refuse automatic sound (`NotAllowedError`): that leaves the app quietly stopped (not an error).
- `state.current` is saved as `last`. With the *Play last station on start* setting the app calls `togglePlay()` at boot.
- `audio` events keep `state.playing` and the status line in step; everything that shows playback state is refreshed by
  `renderPlayerButtons()`.

### 4.7 Now playing

`window.NowPlaying.start(station, emit)` picks an adapter and calls `emit` with
`{title, artist, album, art, host, show, history[]}` whenever something changes; it returns a `stop()` function.

1. **MPR feed**, when the stream host belongs to a provider with `feed: 'mpr'`: song, art, recent plays, host, via WebSocket
   (reconnects with back-off; gives up after a few tries if a stream has no feed).
2. **ICY**, for everything else: every 20 s connect with `Icy-MetaData: 1`, read up to the first metadata block, hang up.
   Gives up quietly after two failures. (Desktop browsers allow this only for stations that permit it; the TV allows it
   for nearly all.)
3. **Cover art**: if a song has artist and title but no art, look it up on iTunes, requiring artist and title to match.

The station page runs its own feed instance for the station being viewed (for *Recently played*); Now Playing uses
`state.np`. Both are stopped when no longer shown.

The **Now Playing page** (`renderNowPage`) shows art, title (a long title scrolls back and forth), artist, host and
status. Its animations are pure CSS, switched by one class, `#nowpage.playing`: a drifting blurred copy of the art as
background, a slowly rotating glow ring, a "breathing" artwork, and 56 bars along the bottom (built once at boot with
random speed, delay and peak). **The bars are decorative: they do not follow the audio**, because the app cannot read
the stream's levels (section 6). Only `transform` and `opacity` are animated.

### 4.8 Other streams

`sourceFor(station)` returns the curated provider (from `providers.js`) or a cached directory lookup. `lookupSource`
searches the directory for stations with the **same homepage host and the same first significant name word** (skipping
generic hosts such as facebook.com or iheart.com), merges encodings and needs at least two results. The station page shows
an "Other streams" tab when a source exists. Opening a stream from that tab stacks station pages; Back walks back down
(`state.detail.stack`).

### 4.9 Settings and storage

Everything is kept in `localStorage` through `store.get/set` (keys prefixed `radio.`, values JSON). It is private to the
app on the TV and is **erased when the app is uninstalled**.

| Key | Contents |
|---|---|
| `radio.favorites` | Array of station objects, newest first. |
| `radio.last` | The last station started. |
| `radio.view` | `browse` or `favorites` (Search and Settings never reopen). |
| `radio.filters` | Search filters `{cc, ccLabel, tag, tagFamily, bitrate, order}`. |
| `radio.settings` | `{autoplay: bool, startOn: 'now'|'home', hiddenGenres: [family names]}`; defaults fill missing keys. |
| `radio.cache.countries3`, `radio.cache.tags` | Directory lists, cached 24 h (rename the key to bust the cache). |
| `radio.cache.prov.<id>` | Genres borrowed for a provider's streams, cached 7 days. |

## 5. Styling

- One stylesheet, fixed pixel layout for 1920x1080, design tokens in `:root` (`--bg`, `--panel`, `--accent`, `--fav`, ...).
- `.f` is the shared focus look. **Every star is `--fav` yellow.**
- The file grew by appending, so **later rules override earlier ones**; look for the last occurrence of a selector.
- `<button>` elements used as flex or grid containers need `align-items` set (the TV defaults it to `flex-start`, which
  collapsed card art to zero width once).
- Scrolling containers clip, so leave padding for the focus ring and zoom (Home rows run to the screen edges for this reason).
- Blocks marked `LEGACY` style elements that no longer exist (section 10).

## 6. The TV: facts and quirks

Verified on the target TV through the debugger unless noted.

| Fact | Consequence |
|---|---|
| The web view is Chromium 132. | Modern CSS and JS are fine (`aspect-ratio`, `inset`, optional chaining). |
| The app page (`file://`) is **not restricted by CORS**. | The app reads the directory, MPR's feed, ICY titles and iTunes directly. No proxy. |
| `<audio>` plays through the TV's own player. Web Audio can run (filters work offline) but **receives silence** from the stream. | No in-app equalizer or real visualizer without writing a custom decoder. |
| webOS **freezes the app's script when it is not in the foreground**. | Timers and feeds stop; relaunch before debugging. |
| `PalmSystem.platformBack()` makes the TV "generate RECENT key" (recent-apps screen). | Exit with `window.close()` (`exitApp`). |
| The Home launcher caches icons **by file name**. | Rename the PNGs when the artwork changes. |
| Third-party apps are denied the TV's app-manager service calls. | The app cannot inspect or change its own registration at runtime. |
| `ares-package` minifies JS and this version has no option to turn that off. | Code on the TV is minified; debug readable code in a desktop browser first (section 7). `./build.sh -c` (check only) validates the app without packaging. |
| Deleting the app erases `localStorage`. | Favorites and settings are lost; there is no export. |
| Back is delivered to the page as `keydown` 461 (once per press). | Confirmed from the TV log (`BACKKEY_HANDLE`). |

## 7. Workflow

### On a computer

Open `src/index.html` in Chrome. `fit.js` scales the page; arrows, Enter and Esc (Back) behave like the remote.
Network calls work from `file://`. No build step is needed to see a change.

### Build and install

```sh
./build.sh                                              # -> dist/com.craig.radio_<version>_all.ipk
ares-install --device lgtv dist/com.craig.radio_<version>_all.ipk
ares-launch  --device lgtv com.craig.radio
```

Bump `version` in `src/appinfo.json` first. Launching starts the last station if the autoplay setting is on.

### Debugging on the TV

```sh
ares-inspect --device lgtv --app com.craig.radio        # prints http://localhost:<port>/devtools/inspector.html?ws=...
```

- Open that URL in Chrome DevTools, or script the Chrome DevTools Protocol at `ws://localhost:<port>/devtools/page/<id>`
  (`http://localhost:<port>/json` lists targets). Node 22+ has a global `WebSocket`.
- The app must be **in the foreground**. When scripting, use plain `Runtime.evaluate`; calls with `awaitPromise` hung on the
  TV. Start async work in the page, store results on `window`, and read them back later.
- Screenshots: `Page.captureScreenshot` works and shows the TV's real rendering.
- Logs: `ares-novacom --device lgtv --run '<command>'` runs a command on the TV. Useful files: `/var/log/dbg-log`
  (look for `WAM`, `BACKKEY_HANDLE`, `platformBack`, `killApp`) and `/var/log/home` (the launcher's view of the app, including
  the title and icon paths it registered). Only a minimal shell exists (`ls -l`, `grep`, `cat`, `tail`).
- `ares-launch --running` lists running apps. Stop a debug session with `pkill -f ares-inspect`.

## 8. Testing

There is no unit-test suite. The app was verified by driving real browsers; the scripts were throw-away and are **not in the repo**.
The technique is small enough to recreate:

1. Start Chrome headless with a fresh profile: `--headless=new --mute-audio --autoplay-policy=no-user-gesture-required
   --remote-debugging-port=<port> --window-size=1920,1080 --user-data-dir=<new dir>`. **Always `--mute-audio`, and always kill the
   browser in a `finally`**: a leftover headless Chrome that started a station keeps playing it on your computer.
2. Connect over CDP and call `Emulation.setFocusEmulationEnabled {enabled:true}`. Without it a headless page is not "focused" and
   `focus` events (which switch tabs) never fire.
3. Send keys with `Input.dispatchKeyEvent` using `windowsVirtualKeyCode` (Back is **461**, Enter 13, arrows 37-40, Yellow 405,
   Blue 406). Type text with `Input.insertText` after making the search box editable (press Enter on it).
4. Assert on the DOM with `Runtime.evaluate` (classes, `hidden`, `document.activeElement`, text) and capture screenshots for layout.

Minimal skeleton (Node 22+):

```js
import { spawn } from 'node:child_process';
const chrome = spawn(CHROME, ['--headless=new','--mute-audio','--remote-debugging-port=9333','--user-data-dir=/tmp/p1','about:blank']);
try {
  const [page] = (await (await fetch('http://127.0.0.1:9333/json')).json()).filter(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);  await new Promise(r => ws.onopen = r);
  // send({method:'Page.navigate',...}); send({method:'Emulation.setFocusEmulationEnabled',...}); drive keys; read the DOM
} finally { chrome.kill('SIGKILL'); }
```

Regression checklist (what was exercised before each release):

- Back chain from every screen, exit prompt Cancel / confirm (stub `window.close`), launch straight onto Now Playing.
- Nav switching by focus (including from a station page and from Now Playing); no click needed.
- Search: name, genre word, explicit genre filter plus text, paging (Next/Prev, cached pages), hidden genres, empty states.
- Home: 12 shelves, no station repeated across shelves, "See all" opens Search with that family.
- Station page: Play/Stop, favorite, quality, history tab, other-streams tab and stacked Back.
- Now Playing: empty state, populated state, animations on while playing and off when stopped.
- Settings: each row flips and persists; autoplay and start-page honoured on relaunch.
- Search box: highlight vs edit mode, stepping out with arrows, Enter and Back.
- Layout: nothing clipped at the ends of Home rows or pop-up lists.

## 9. Recipes

**Add a setting.** Add a default to the `settings` object (top of the state section), add a row to `SETTINGS` (a two-option
row needs only `key`, `label`, `options`), then read `settings.<key>` where it matters. It persists automatically.

**Add a genre family.** Append to `FAMILIES` in `genres.js` (`name`, `terms`, `test`). The list order is the Home shelf order and
the order in the Genre picker. Names are saved in settings, so renaming one resets that setting.

**Add a curated provider.** Append to `window.PROVIDERS` (schema in the file), put its logo in `src/icons/`, and if it has a
now-playing feed add an adapter in `nowplaying.js` and select it in `feedFor`.

**Add a nav tab.** Add `<button class="f tab" id="tab-<name>" data-view="<name>">` to `index.html`; add `NAV_ACTIONS.<name>`;
handle the view in `renderGrid`, `renderChrome` and `renderNav`; make sure `setView` does not persist it if it should not reopen.

**Change the icon.** Edit `assets/radon-icon.svg`; render at 512x512 with a transparent background; resize to 130 and 80 px;
render `splash.png` (the tile centred on 1920x1080, `#0e1116`). **Use new file names** for the PNGs and update `appinfo.json`
(the launcher caches by name). Bump `version`.

**Change the app name.** Edit `title` in `appinfo.json` and `<title>` and the exit-dialog text in `index.html`. Keep the id.

**Add a key shortcut.** Add the code to `KEY`, add a `case` in the keydown handler.

## 10. Known leftovers and limits

Dead code that is safe to delete (kept so far to avoid unrequested changes):

- `style.css`: `#player`, `#p-*`, `.round.big` (old bottom player bar); `#source-bar`, `#source-back`, `#source-title`
  (old full-screen sibling view); `#d-list-head` (replaced by tabs). They are marked `LEGACY`.
- `app.js`: `applyQueryFromInput` (unused); `lists.browse` and the `view !== 'search'` fallback branch in `loadPage`
  (Home no longer pages); `state.filters.name` (the text lives in `state.query`).

Limits and cautions:

- No real equalizer/visualizer (section 6). The Now Playing bars are decorative.
- Hiding a genre also hides stations from typed-name results when their tags match; pages can therefore be shorter.
- Home uses the TV's language region unless a Country filter is set.
- Favorites and settings cannot be exported; uninstalling erases them.
- `providers.js` stream URLs come from the broadcaster's site and may change.
- The directory's metadata is crowd-sourced: bitrates, tags and icons are sometimes wrong (the app compensates where it can).

## 11. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Launcher shows an old icon or "BARE APP" with a globe | Cached icon. Use new icon file names, bump the version, and if needed restart the TV. (The "Bare App" picture is the starter template's icon.) |
| Nothing responds over the debug link | App not in the foreground (script frozen) or the inspector session ended. Relaunch, then `ares-inspect` again. |
| Exit prompt appears, then the TV's recent-apps screen | Something calls `PalmSystem.platformBack()` before closing. Exit must use `window.close()`. |
| Tabs do not switch in a headless test | Forgot `Emulation.setFocusEmulationEnabled`. |
| Audio plays on your computer after a test | A headless Chrome was left running. `pkill -f headless=new` and use `--mute-audio`. |
| Station list never loads | Directory unreachable; check the TV's network. `api()` tries two mirrors. |
| No song info for a station | The station sends no ICY title and has no provider feed. Nothing to fix in the app. |
