# Radon (webOS app)

Internet radio browser/player for LG webOS. Step 1 of 3: browse, filter, favorites, playback.

- Stations come from radio-browser.info (filter by country, genre, min bitrate, name; sort).
- Playback is a plain HTML5 `<audio>`; HLS streams are filtered out.
- Favorites and last station are kept in the app's localStorage (will move to the proxy in step 2).

Remote: arrows move, OK plays/selects, Yellow toggles favorite on the focused station (or the playing one),
Back closes a picker, Stop/Pause stop playback. The Magic Remote pointer works too.

## Layout

- `src/` – the app itself (what gets packaged; `appinfo.json` lives here)
- `assets/` – icon source (`radon-icon.svg`); `src/icon.png` and `src/largeIcon.png` are rendered from it
- `dist/` – built `.ipk` files
- `build.sh` – runs `ares-package`

## Install on the TV (device `lgtv`)

    cd ~/Developer/webos/radio-app
    ./build.sh
    ares-install --device lgtv dist/com.craig.radio_<version>_all.ipk
    ares-launch  --device lgtv com.craig.radio

Uninstall: `ares-install --device lgtv --remove com.craig.radio`

## Planned

2. Proxy container: now-playing (ICY), album art, synced favorites.
3. Lyrics (LRCLIB).

## Open questions

- Does audio keep playing when you leave the app? webOS may suspend it; untested.
- Icons are placeholders copied from the launcher app.
