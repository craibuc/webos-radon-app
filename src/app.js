'use strict';
/*
 * Radon: internet-radio browser/player for LG webOS TV (Chromium 132, 1920x1080, remote control only).
 *
 * The whole app is this one IIFE: no framework, no bundler, no runtime dependencies. Four small scripts load
 * first (see index.html) and publish the globals this file reads:
 *   window.REGION_ORDER, regionOf()   regions.js     country picker grouping
 *   window.GENRES                     genres.js      genre families (genre picker, Home shelves, hide-genres)
 *   window.PROVIDERS                  providers.js   curated multi-stream sources (The Current / MPR)
 *   window.NowPlaying                 nowplaying.js  song / cover art / host feed for the playing station
 *
 * Reading order (search for the "// ----------" banners):
 *   config, helpers, radio-browser API, station model + merging encodings, state, providers,
 *   searching (paged), rendering (cards, grid, nav, chrome), Now Playing page, playback,
 *   station page, sources for any station, exit prompt, pickers, Home shelves, Settings, filters,
 *   wiring, D-pad navigation + key handler, search box, boot.
 *
 * Ideas that explain most of the code:
 *  - Screens: Home (genre shelves), Search (query + filters, paged), Favorites, Settings. Two overlays can open
 *    on top of them: the station page (state.detail) and Now Playing (state.nowOpen). state.view is 'browse'
 *    (= Home) | 'search' | 'favorites' | 'settings'. Overlays hide #main through renderChrome().
 *  - Focus is the only selection mechanism. Every interactive element has class "f" (a <button>, or the search
 *    <input>). The TV gives web apps no spatial navigation, so move() implements the arrow keys itself, and
 *    focusing a nav tab activates it (NAV_ACTIONS): there is no click step.
 *  - A "station" is a plain object (see compact()). The directory lists every encoding as its own station, so
 *    mergeInto() folds encodings into one station with `variants`; its id is 'g:<country>|<base name>'.
 *  - Nothing plays until the user presses Play (cards open the station page), except the optional
 *    "play last station on start" setting.
 *  - Persistence is localStorage only (store.get / store.set, keys prefixed "radio."). Deleting the app from
 *    the TV wipes it.
 *  - Network: radio-browser.info (directory), MPR's WebSocket feed and the stations' own streams (song titles),
 *    iTunes Search (cover art). This app's page is not subject to CORS on the TV, so all of them are called directly.
 */
(() => {
  // ---------- config ----------
  // radio-browser.info mirrors, tried in this order: api() fails over to the next one on any error.
  const API_HOSTS = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info'];
  // Stations per page on the Search list (Previous / Next). Multi-term queries slice this up, see loadPage().
  const PAGE = 40;
  const BITRATES = [0, 64, 96, 128, 192, 256, 320];
  const ORDERS = [
    { v: 'votes', label: 'Top voted', reverse: true },
    { v: 'clickcount', label: 'Most listened', reverse: true },
    { v: 'clicktrend', label: 'Trending', reverse: true },
    { v: 'bitrate', label: 'Highest bitrate', reverse: true },
    { v: 'name', label: 'Name A-Z', reverse: false },
  ];
  // webOS remote key codes. Back is 461 (not 8/27); yellow 405, blue 406. PageUp/PageDown (33/34) and CH-/CH+
  // (427/428) are matched inline in the keydown handler.
  const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, ESC: 27, BACKSPACE: 8,
    BACK: 461, YELLOW: 405, BLUE: 406, PLAY: 415, PAUSE: 19, STOP: 413, PLAYPAUSE: 463 };

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  // localStorage wrapper: JSON values under keys prefixed "radio."; failures are swallowed because storage can be
  // unavailable. Keys: favorites, last, view, filters, settings, cache.countries3, cache.tags, cache.prov.<id>.
  const store = {
    get(k, d) { try { const v = localStorage.getItem('radio.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('radio.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  // Flag images are bundled (flags/xx.svg): emoji flags are not reliably in a TV's fonts.
  const flagNode = (cc, title) => {
    const i = new Image();
    i.className = 'flag'; i.alt = cc; if (title) i.title = title;
    i.onerror = () => i.replaceWith(document.createTextNode(cc + ' ')); // no flag for this code: show the letters
    i.src = 'flags/' + cc.toLowerCase() + '.svg';
    return i;
  };
  // Placeholder letter for a station without a logo: the first letter or digit (".977 Country" -> "9", not ".").
  const initialOf = name => (String(name || '').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.8l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 17l-5.8 3.3 1.4-6.4-4.9-4.4 6.5-.7z"/></svg>',
    starOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.8l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 17l-5.8 3.3 1.4-6.4-4.9-4.4 6.5-.7z"/></svg>',
  };

  // ---------- radio-browser API ----------
  // GET <mirror><path>?<params> as JSON. 10 s timeout per mirror; on error it tries the next mirror and remembers
  // the one that worked (hostIdx). Throws the last error if every mirror fails.
  let hostIdx = 0;
  async function api(path, params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    let lastErr;
    for (let i = 0; i < API_HOSTS.length; i++) {
      const idx = (hostIdx + i) % API_HOSTS.length;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      try {
        const r = await fetch(API_HOSTS[idx] + path + qs, { signal: ctl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        hostIdx = idx;
        return data;
      } catch (e) { lastErr = e; } finally { clearTimeout(timer); }
    }
    throw lastErr;
  }

  // Rarely-changing directory lists (countries, tags) are cached in localStorage for 24 hours.
  async function cachedList(key, loader) {
    const c = store.get('cache.' + key, null);
    if (c && Date.now() - c.t < 24 * 3600 * 1000) return c.d;
    const d = await loader();
    store.set('cache.' + key, { t: Date.now(), d });
    return d;
  }

  const loadCountries = () => cachedList('countries3', async () => {
    const d = await api('/json/countries', { order: 'stationcount', reverse: 'true', hidebroken: 'true' });
    return d.filter(c => c.iso_3166_1 && c.stationcount >= 2).map(c => ({ code: c.iso_3166_1, name: c.name.replace(/^The /, '').replace('United States Of America', 'United States').replace('United Kingdom Of Great Britain And Northern Ireland', 'United Kingdom'), n: c.stationcount }));
  });
  const loadTags = () => cachedList('tags', async () => {
    const d = await api('/json/tags', { order: 'stationcount', reverse: 'true', hidebroken: 'true', limit: '300' });
    return d.filter(t => t.stationcount >= 15).map(t => ({ name: t.name, n: t.stationcount }));
  });

  // Directory record -> the app's station object (kept small: favorites are stored whole in localStorage).
  //   id       directory uuid; becomes 'g:<cc>|<base name>' once mergeInto() has grouped the station
  //   name, url (resolved stream), alt (the original url), favicon, cc / country, tags (comma-separated string),
  //   codec, bitrate, hls, homepage, lang
  // Added later: variants + uuid (mergeInto); desc + programId (providers.js entries).
  const compact = s => ({
    id: s.stationuuid, name: (s.name || '').trim() || 'Unnamed', url: s.url_resolved || s.url, alt: s.url,
    favicon: s.favicon || '', cc: s.countrycode || '', country: s.country || '',
    tags: s.tags || '', codec: s.codec || '', bitrate: s.bitrate || 0, hls: !!s.hls,
    homepage: s.homepage || '', lang: s.language || '',
  });

  // ---------- merging encodings of the same station ----------
  // The directory lists each encoding as its own station ("MPR News [AAC 48k]", "MPR News (MP3 128k)").
  // Group them by cleaned-up name + country and keep the encodings as selectable variants.
  const CODEC_RE = '(?:mp3|aac\\+?|aacp|ogg|opus|flac|vorbis|kbps|kbit|hq|lq|\\d{2,3}\\s*k(?:bps)?)';
  const TAG_GROUP = new RegExp('\\s*[\\[(][^\\])]*\\b' + CODEC_RE + '(?![\\p{L}\\p{N}])[^\\])]*[\\])]', 'giu');
  const TAG_WORD = new RegExp('\\b' + CODEC_RE + '(?![\\p{L}\\p{N}])', 'giu');
  const displayName = n => n.replace(TAG_GROUP, '').replace(/\s+/g, ' ').trim() || n;
  const baseKey = n => (displayName(n).toLowerCase().replace(TAG_WORD, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()) || n.toLowerCase();
  // Station owners often state the real bitrate in the name; the directory's number is less reliable.
  const effBitrate = s => { const m = /\b(\d{2,3})\s*k(?:bps)?(?![\p{L}\p{N}])/iu.exec(s.name); return m ? +m[1] : (s.bitrate || 0); };
  const urlKey = u => u.toLowerCase().replace(/^https?:\/\//, '');
  // The same station can reach us under different ids (a saved favorite, a search result, a sibling list),
  // so "is this the one playing?" compares ids and then any shared stream address.
  function sameStation(a, b) {
    if (!a || !b) return false;
    if (a.id === b.id) return true;
    const urls = s => {
      const out = new Set();
      for (const v of (s.variants || [])) { if (v.url) out.add(urlKey(v.url)); if (v.alt) out.add(urlKey(v.alt)); }
      if (s.url) out.add(urlKey(s.url));
      if (s.alt) out.add(urlKey(s.alt));
      return out;
    };
    const ua = urls(a);
    for (const u of urls(b)) if (ua.has(u)) return true;
    return false;
  }
  // Tags come as one comma-separated string, often messy ("rock, Rock ,"). Normalise and cap for display.
  const tagList = t => { const out = []; for (const raw of String(t || '').split(',')) { const g = raw.trim().toLowerCase(); if (g && !out.includes(g)) out.push(g); } return out; };
  const genreText = t => tagList(t).filter(g => !/^\d+s?$/.test(g)).slice(0, 3).map(g => g[0].toUpperCase() + g.slice(1)).join(' · ');
  const mergeTags = (a, b) => tagList(a + ',' + b).join(',');
  const codecRank = c => (/mp3/i.test(c) ? 0 : /aac/i.test(c) ? 1 : 2);
  const variantOf = s => ({ uuid: s.id, url: s.url, alt: s.alt, codec: s.codec, bitrate: effBitrate(s) });

  // Re-rank a group's variants (highest bitrate first, MP3 before AAC on a tie) and copy the best onto the group's
  // own url / alt / codec / bitrate / uuid, so a merged group can be played like a single station.
  function applyPrimary(g) {
    g.variants.sort((a, b) => (b.bitrate - a.bitrate) || (codecRank(a.codec) - codecRank(b.codec)));
    const v = g.variants[0];
    g.url = v.url; g.alt = v.alt; g.codec = v.codec; g.bitrate = v.bitrate; g.uuid = v.uuid;
  }

  // The group id 'g:<cc>|<base name>' is stable between sessions, so favorites and the playing marker keep matching.
  // Returns the station when it starts a new group, null when it was folded into an existing one.
  function mergeInto(map, s) {
    const key = (s.cc || '') + '|' + baseKey(s.name);
    const v = variantOf(s);
    const g = map.get(key);
    if (!g) {
      s.variants = [v];
      s.name = displayName(s.name);
      s.id = 'g:' + key; s.uuid = v.uuid;
      applyPrimary(s);
      map.set(key, s);
      return s;
    }
    if (g.variants.some(x => urlKey(x.url) === urlKey(v.url))) return null;
    g.variants.push(v);
    applyPrimary(g);
    if (!g.favicon && s.favicon) g.favicon = s.favicon;
    g.tags = mergeTags(g.tags, s.tags);
    return null;
  }

  // ---------- state ----------
  //   view       'browse' (Home) | 'search' | 'favorites' | 'settings'; only browse/favorites are remembered
  //   filters    Search-page filters {cc, ccLabel, tag, tagFamily, bitrate, order}. (`name` is unused: typed text is state.query)
  //   favorites  saved station objects, so they show without a network call
  //   current    the station last started (persisted as 'last'); playing = audio is actually running
  //   np         latest now-playing info for `current` (shape: see nowplaying.js)
  //   detail     the open station page or null (shape: see enterDetail); nowOpen / exitOpen = those overlays are open
  //   picker     the open pop-up list, {returnTo}; fresh = launched straight onto Now Playing and nothing visited yet
  // Set elsewhere, not declared here: variant (encoding chosen for `current`), nowScroll, and the list accessors below.
  const state = {
    view: store.get('view', 'browse'),
    filters: Object.assign({ cc: '', ccLabel: '', tag: '', tagFamily: '', bitrate: 0, order: 'votes', name: '' }, store.get('filters', {})),
    favorites: store.get('favorites', []).map(s => Object.assign({}, s, { name: displayName(s.name || '') })),
    query: '',
    current: store.get('last', null),
    playing: false, np: null, detail: null, nowOpen: false, exitOpen: false, fresh: false,
    picker: null,
  };
  const isFav = id => state.favorites.some(f => f.id === id);
  if (state.view === 'search' || state.view === 'settings') state.view = 'browse'; // these start empty, so never reopen on them
  // User settings, kept on the TV (localStorage) like favorites; defaults fill in anything not yet saved.
  const settings = Object.assign({ autoplay: true, startOn: 'now', hiddenGenres: ['Religious'] }, store.get('settings', {}));
  state.filters.name = ''; // the name filter moved to the Search page

  // Only the Search page has a paged list: lists.search holds its pages, paging and in-flight request. The accessors
  // defined below make state.stations / pages / seenIds / page / hasMore / loading / token / error read and write it.
  // (lists.browse is a leftover from when Home was a paged list as well; Home is built from `home` below.)
  const newList = () => ({ stations: [], pages: [], seenIds: new Set(), page: 0, hasMore: false, loading: false, token: 0, error: '' });
  const lists = { browse: newList(), search: newList() };
  // Home: one shelf per genre family, each filled from the directory. shelves[i] = {family, stations, state:'loading'|'done'|'error'};
  // cc = the country the shelves were loaded for; token discards responses from a superseded load.
  const home = { shelves: [], cc: null, token: 0, error: false };
  const listView = () => 'search'; // only the Search page has a paged list; Home is shelves
  const isListView = () => state.view === 'search';
  for (const k of Object.keys(lists.browse)) {
    Object.defineProperty(state, k, { get: () => lists[listView()][k], set: v => { lists[listView()][k] = v; }, enumerable: true });
  }

  // ---------- providers (sibling streams from the same source) ----------
  const PROVIDERS = window.PROVIDERS || [];
  // The curated provider (providers.js) whose host list matches this station's stream host, or null.
  function providerFor(st) {
    if (!st || !st.url) return null;
    let host;
    try { host = new URL(st.url).hostname.toLowerCase(); } catch (e) { return null; }
    return PROVIDERS.find(p => p.hosts.some(h => host === h || host.endsWith('.' + h))) || null;
  }
  // A provider's stream list carries no genres or icons of its own: enrichProvider() borrows genres from the matching
  // directory entries (cached 7 days). It resolves true when it did work, so callers re-render only once.
  const PROVIDER_CACHE_MS = 7 * 24 * 3600 * 1000;
  async function enrichProvider(p) {
    // Provider lists carry no icons or genres; borrow them from the directory entry for the same stream.
    if (p._enriched) return false;
    p._enriched = true;
    const apply = d => {
      // Directory icons for these streams are mostly a generic placeholder, so use only their genres.
      // Icons come from providers.js: a per-stream `favicon` if set, otherwise the family logo.
      for (const s of p.streams) {
        const x = d[s.id];
        if (x && !s.tags) s.tags = x.tags;
        if (!s.favicon) s.favicon = p.icon || '';
      }
    };
    const cached = store.get('cache.prov.' + p.id, null);
    if (cached && Date.now() - cached.t < PROVIDER_CACHE_MS) { apply(cached.d); return true; }
    const d = {};
    await Promise.all(p.streams.map(async s => {
      try {
        const host = new URL(s.url).hostname.toLowerCase();
        const res = await api('/json/stations/search', { name: s.name, hidebroken: 'true', limit: '25' });
        const hit = res.find(r => { try { return new URL(r.url_resolved || r.url).hostname.toLowerCase() === host; } catch (e) { return false; } });
        if (hit) d[s.id] = { favicon: hit.favicon || '', tags: hit.tags || '' };
      } catch (e) { /* leave this stream without extras */ }
    }));
    store.set('cache.prov.' + p.id, { t: Date.now(), d });
    apply(d);
    return true;
  }


  function toggleFav(st) {
    if (!st) return;
    if (isFav(st.id)) state.favorites = state.favorites.filter(f => f.id !== st.id);
    else state.favorites = [st].concat(state.favorites);
    store.set('favorites', state.favorites);
    renderFavMarks();
    renderPlayerButtons();
    if (state.view === 'favorites') renderGrid(true);
  }

  // ---------- searching (paged) ----------
  // The list is shown one page at a time (Previous / Next) rather than as one endless scroll.
  const search = () => loadPage(0, true); // any change of query or filter starts the visible list over
  // Genre families hidden on Search (Settings). A genre you pick yourself in the Genre filter is never hidden.
  function hiddenFamilies(f) {
    const exempt = new Set();
    if (f.tagFamily) exempt.add(f.tagFamily);
    if (f.tag) { const fam = window.GENRES.families.find(x => x.test.test(f.tag)); if (fam) exempt.add(fam.name); }
    return (settings.hiddenGenres || []).filter(n => !exempt.has(n)).map(n => window.GENRES.family(n)).filter(Boolean);
  }

  // Does the Search page have anything to look for yet? (a typed name, or any filter)
  const searchActive = (f = Object.assign({}, state.filters, { name: state.query })) => !!(f.name || f.cc || f.tag || f.tagFamily || f.bitrate);

  function applyPage(L, n) {
    const p = L.pages[n];
    L.page = n; L.stations = p.stations; L.hasMore = p.hasMore; L.error = '';
  }

  // Load page n of the Search list. reset = a new query (discards old pages and any request still in flight).
  // Pages are cached in lists.search.pages so Previous is instant. A page can come back empty after client-side
  // filtering (genre family test, hidden genres, HLS, de-duplication); it then advances up to 3 pages on its own.
  // "All <family>" runs one request per family term in parallel and merges them (the directory matches one tag per request).
  async function loadPage(n, reset, focusFirst) {
    const view = state.view;
    if (view !== 'search') return;
    const L = lists[view]; // keep using this list even if the user moves to another page while we wait
    const visible = () => state.view === view;
    if (reset) { L.token++; L.pages = []; L.seenIds = new Set(); n = 0; }
    else if (L.loading) return;
    const token = L.token;
    const done = () => { renderGrid(true); if (focusFirst) { const c = grid.querySelector('.card'); if (c) c.focus(); } };
    if (L.pages[n]) { applyPage(L, n); done(); return; }
    // Search combines the typed name with the filters and waits until it has something to look for.
    // (The fallback after the ':' is unreachable now: loadPage returns early unless view === 'search'.)
    const f = view === 'search' ? Object.assign({}, state.filters, { name: state.query }) : { cc: '', tag: '', tagFamily: '', bitrate: 0, order: 'votes', name: '' };
    if (view === 'search' && !searchActive(f)) {
      L.loading = false; L.stations = []; L.page = 0; L.hasMore = false; L.error = '';
      if (visible()) renderGrid(true);
      return;
    }
    L.loading = true; L.error = ''; L.stations = []; L.page = n; L.hasMore = false;
    if (visible()) renderGrid(true);
    const fam = f.tagFamily ? window.GENRES.family(f.tagFamily) : null;
    const order = ORDERS.find(o => o.v === f.order) || ORDERS[0];
    // "All <family>" runs one query per term, so each term gets a smaller slice to keep a page about PAGE long.
    const hidden = view === 'search' ? hiddenFamilies(f) : [];
    // What to ask the directory. Typed text matches a station's NAME or its GENRE tags: the directory ANDs its filters, so
    // that is two requests whose results are merged (like "All <family>"). With a genre filter already chosen, the text
    // just narrows by name within that genre.
    const byNameOrGenre = !!f.name && !fam && !f.tag;
    const variants = fam ? fam.terms.map(t => ({ tag: t })) : byNameOrGenre ? [{ name: f.name }, { tag: f.name }] : [{}];
    const limit = variants.length > 1 ? Math.max(12, Math.ceil(PAGE / variants.length)) : PAGE;
    try {
      let page = n, tries = 0;
      for (;;) {
        const params = { hidebroken: 'true', limit: String(limit), offset: String(page * limit), order: order.v, reverse: String(order.reverse) };
        if (f.cc) params.countrycode = f.cc;
        if (!fam && f.tag) { params.tag = f.tag; params.tagExact = 'true'; }
        if (f.bitrate) params.bitrateMin = String(f.bitrate);
        if (f.name && !byNameOrGenre) params.name = f.name;
        const results = await Promise.all(variants.map(v => api('/json/stations/search', Object.assign({}, params, v))));
        if (token !== L.token) return; // a newer search superseded this one
        const raw = [];
        const inPage = new Set();
        for (const r of results) for (const s of r) if (!inPage.has(s.stationuuid)) { inPage.add(s.stationuuid); raw.push(s); }
        if (variants.length > 1) raw.sort((x, y) => (order.v === 'name' ? String(x.name).localeCompare(String(y.name)) : (y[order.v] || 0) - (x[order.v] || 0)));
        const hasMore = results.some(r => r.length === limit);
        const map = new Map(), stations = [];
        for (const r of raw) {
          if (L.seenIds.has(r.stationuuid)) continue; // already shown on an earlier page
          L.seenIds.add(r.stationuuid);
          if (fam && !fam.test.test(r.tags || '')) continue; // drop substring false positives ("popular" for "pop")
          if (hidden.some(h => h.test.test(r.tags || ''))) continue; // genres hidden in Settings
          const s = compact(r);
          if (s.hls || !s.url) continue; // <audio> can't reliably play HLS
          const g = mergeInto(map, s);
          if (g) stations.push(g);
        }
        L.pages[page] = { stations, hasMore };
        // Filtering can empty a page; move on rather than show a blank one.
        if (stations.length || !hasMore || ++tries >= 3) { n = page; break; }
        page++;
      }
    } catch (e) {
      if (token !== L.token) return;
      L.error = 'Could not reach the station directory. Check the network and try again.';
      L.loading = false;
      if (visible()) renderGrid(true);
      return;
    }
    L.loading = false;
    applyPage(L, n);
    if (visible()) done();
  }

  function nextPage() {
    if (!isListView() || state.detail || state.nowOpen || state.loading || !state.hasMore) return;
    loadPage(state.page + 1, false, true);
  }
  function prevPage() {
    if (!isListView() || state.detail || state.nowOpen || state.loading || state.page === 0) return;
    let p = state.page - 1;
    while (p > 0 && state.pages[p] && !state.pages[p].stations.length) p--; // skip pages that filtered down to nothing
    loadPage(p, false, true);
  }

  function renderPager() {
    const on = isListView() && !state.detail && !state.nowOpen && !state.loading && (state.page > 0 || state.hasMore);
    $('#pager').hidden = !on;
    $('#pg-prev').hidden = state.page === 0;
    $('#pg-next').hidden = !state.hasMore;
    $('#pg-info').textContent = 'Page ' + (state.page + 1);
  }

  function visibleList() {
    if (isListView()) return state.stations;
    return state.favorites;
  }

  // ---------- rendering ----------
  const grid = $('#grid'), empty = $('#empty');

  // Icons under 32px (the directory has plenty of 1px placeholders) count as missing, so the letter shows instead.
  function logoNode(st, cls) {
    const box = el('div', cls);
    const letter = el('span', 'letter', initialOf(st.name));
    box.appendChild(letter);
    if (st.favicon) {
      const img = new Image();
      img.alt = '';
      img.onload = () => { if (img.naturalWidth < 32 || img.naturalHeight < 32) return; letter.remove(); box.appendChild(img); };
      img.src = st.favicon;
    }
    return box;
  }

  // One art-first tile. Used on Home shelves, the Search / Favorites grid and the "Other streams" tab. Sets el._station
  // (read by the key handlers and the playing / favorite markers). Selecting it opens the station page; it never plays directly.
  function cardFor(st) {
    const b = el('button', 'f card');
    b.dataset.id = st.id;
    b.appendChild(logoNode(st, 'logo'));
    b.appendChild(el('div', 'name', st.name));
    // Art-first tile: everything else (quality, country, history) lives on the station's page.
    const sub = el('div', 'sub');
    if (st.cc) sub.appendChild(flagNode(st.cc, st.country));
    sub.appendChild(el('span', 'txt', genreText(st.tags) || st.desc || prettyCountry(st.country)));
    b.appendChild(sub);
    const star = el('span', 'star'); star.innerHTML = ICON.starOn; star.hidden = !isFav(st.id);
    b.appendChild(star);
    if (state.playing && sameStation(st, state.current)) b.classList.add('playing');
    b._station = st;
    b.addEventListener('click', () => openDetail(st, b));
    return b;
  }

  // Render the current screen's content: Home shelves, Settings, or the grid (Search results / Favorites).
  // reset = start at the top instead of keeping scroll position and the focused card.
  function renderGrid(reset) {
    const onHome = state.view === 'browse', onSettings = state.view === 'settings';
    $('#home').hidden = !onHome; $('#settings').hidden = !onSettings; grid.hidden = onHome || onSettings;
    if (onHome) { empty.hidden = true; renderPager(); renderHome(); return; }
    if (onSettings) { empty.hidden = true; renderPager(); renderSettings(); return; }
    const list = visibleList();
    renderPager();
    const focusId = !reset && document.activeElement && document.activeElement._station ? document.activeElement._station.id : null;
    const scrollTop = $('#main').scrollTop;
    grid.textContent = '';
    for (const st of list) grid.appendChild(cardFor(st));
    if (isListView() && state.loading) grid.appendChild(el('div', 'card more', 'Loading…'));
    let msg = '';
    if (!list.length && !state.loading) {
      if (state.error) msg = state.error;
      else if (state.view === 'favorites') msg = 'No favorites yet.';
      else if (state.view === 'search') msg = searchActive() ? 'No stations found.' : 'Search by station name or genre, or use the filters.';
      else msg = 'No stations match these filters.';
    }
    empty.hidden = !msg; empty.textContent = msg;
    if (focusId) {
      const n = [...grid.children].find(c => c._station && c._station.id === focusId);
      if (n) n.focus({ preventScroll: true });
      $('#main').scrollTop = scrollTop;
    } else if (reset) {
      $('#main').scrollTop = 0;
    }
  }

  function renderFavMarks() {
    for (const c of document.querySelectorAll('#grid .card, #home .card')) {
      if (!c._station) continue;
      const s = c.querySelector('.star'); if (s) s.hidden = !isFav(c._station.id);
    }
  }

  function renderPlaying() {
    for (const c of document.querySelectorAll('#grid .card, #home .card')) if (c._station) c.classList.toggle('playing', state.playing && sameStation(c._station, state.current));
  }

  // Which parts of the page show. The search box and the filter row belong to the Search page only; a station page or
  // Now Playing (the overlays) hides the main area and both rows, but the nav stays visible.
  function renderChrome() {
    const overlay = !!state.detail || state.nowOpen;
    $('#main').hidden = overlay;
    $('#filters').hidden = overlay || state.view !== 'search';
    $('#searchrow').hidden = overlay || state.view !== 'search';
  }

  // The nav pill: highlights the section you are in (Now Playing wins while its page is open); .live animates the
  // bars on the Now Playing tab while audio plays.
  function renderNav() {
    $('#tab-browse').classList.toggle('active', !state.nowOpen && state.view === 'browse');
    $('#tab-search').classList.toggle('active', !state.nowOpen && state.view === 'search');
    $('#tab-settings').classList.toggle('active', !state.nowOpen && state.view === 'settings');
    $('#tab-favorites').classList.toggle('active', !state.nowOpen && state.view === 'favorites');
    $('#tab-now').classList.toggle('active', state.nowOpen);
    $('#tab-now').classList.toggle('live', state.playing); // animated bars while audio plays
  }

  // Nav buttons work from anywhere, including a station's page and Now Playing.
  function goTab(v) {
    state.fresh = false;
    if (state.nowOpen) closeNow();
    if (state.detail) closeDetail();
    setView(v);
    renderNav();
    const t = $('#tab-' + v); if (t) t.focus({ preventScroll: true });
  }

  // ---------- Now Playing page (full screen, after Apple's) ----------
  // An overlay like the station page: it hides #main and the header rows (renderChrome) but keeps the nav visible.
  // The tab opens it as soon as it is focused. state.nowScroll remembers #main's scroll position for when it closes.
  let lastNowArt = null, lastNowTitle = null;
  function openNow(keepFocus) {
    if (state.detail) closeDetail();
    state.nowScroll = $('#main').scrollTop;
    state.nowOpen = true;
    $('#nowpage').hidden = false; renderChrome();
    lastNowArt = null; lastNowTitle = null;
    renderNowPage(); renderNav();
    if (!keepFocus) $('#n-play').focus();
  }
  function closeNow() {
    if (!state.nowOpen) return false;
    state.nowOpen = false;
    $('#nowpage').hidden = true; renderChrome();
    $('#main').scrollTop = state.nowScroll || 0;
    renderNav();
    return true;
  }
  function exitNow() { if (closeNow()) { const t = $('#tab-' + state.view); if (t) t.focus({ preventScroll: true }); } }

  // Safe to call at any time (playback, now-playing info or status changed): it only touches the DOM when something
  // differs, comparing art and title with the last values to avoid flicker and marquee restarts.
  function renderNowPage() {
    if (!state.nowOpen) return;
    $('#nowpage').classList.toggle('playing', !!state.current && state.playing); // switches the CSS animations on and off
    const st = state.current, np = state.np;
    if (!st) { // nothing has been played yet: an empty page, not a missing tab
      for (const id of ['#n-station', '#n-artist', '#n-host', '#n-status']) $(id).textContent = '';
      $('#n-title-t').textContent = 'Nothing playing'; lastNowTitle = null;
      lastNowArt = null; $('#n-img').hidden = true; $('#n-letter').textContent = ''; $('#n-bg').style.backgroundImage = 'none';
      $('#n-actions').hidden = true;
      return;
    }
    $('#n-actions').hidden = false;
    const hasSong = !!(np && np.title);
    $('#n-station').textContent = hasSong ? st.name : '';
    $('#n-artist').textContent = hasSong ? (np.artist || '') : '';
    $('#n-host').textContent = np && np.host ? 'Hosted by ' + np.host : '';
    const shown = statusErr || /^(Connecting|Buffering|Stopped)/.test(statusBase) ? statusBase : '';
    $('#n-status').textContent = shown; $('#n-status').classList.toggle('err', statusErr);
    const title = hasSong ? np.title : st.name;
    if (title !== lastNowTitle) { lastNowTitle = title; $('#n-title-t').textContent = title; fitMarquee(); }
    // album art when we have it, else the station logo; the same image, blurred, tints the page
    const art = (np && np.art) || st.favicon || '';
    if (art !== lastNowArt) {
      lastNowArt = art;
      const img = $('#n-img'), letter = $('#n-letter');
      letter.textContent = initialOf(st.name); img.hidden = true;
      $('#n-bg').style.backgroundImage = art ? 'url("' + art.replace(/"/g, '%22') + '")' : 'none';
      if (art) { img.onload = () => { if (img.naturalWidth < 32 || img.naturalHeight < 32) return; img.hidden = false; letter.textContent = ''; }; img.onerror = () => { img.hidden = true; }; img.src = art; }
    }
    $('#n-play').innerHTML = state.playing ? ICON_STOP : ICON.play;
    $('#n-fav').innerHTML = isFav(st.id) ? ICON.starOn : ICON.starOff;
  }

  // A title too long for the page scrolls slowly back and forth, as on Apple's.
  function fitMarquee() {
    const t = $('#n-title-t'), box = $('#n-title');
    t.style.animation = 'none';
    requestAnimationFrame(() => {
      const over = t.scrollWidth - box.clientWidth;
      if (over > 4) { t.style.setProperty('--shift', -over + 'px'); t.style.animation = 'marquee ' + Math.max(8, Math.round(over / 30)) + 's ease-in-out infinite alternate'; }
      else t.style.animation = '';
    });
  }

  function renderFilters() {
    const f = state.filters;
    $('#f-country .v').textContent = f.cc ? (f.ccLabel || f.cc) : 'Any';
    $('#f-tag .v').textContent = f.tagFamily ? 'All ' + f.tagFamily : (f.tag || 'Any');
    $('#f-bitrate .v').textContent = f.bitrate ? f.bitrate + 'k and up' : 'Any';
    $('#f-order .v').textContent = (ORDERS.find(o => o.v === f.order) || ORDERS[0]).label;
    renderNav();
    renderChrome();
  }

  function renderPlayerButtons() {
    renderNav();
    renderNowPage();
    renderPlaying();
    if (state.detail) renderDetailButtons();
  }

  function renderPlayerInfo() {
    renderPlayerButtons();
    renderPlaying();
  }

  // The status line on Now Playing ('Connecting…', 'Buffering…', 'Stopped', or an error). 'Playing' itself is not shown.
  let statusBase = '', statusErr = false;
  function setStatus(text, isErr) { statusBase = text; statusErr = !!isErr; renderNowPage(); }

  // ---------- now playing ----------
  // Runs the nowplaying.js feed for the playing station; state.np holds the latest {title, artist, album, art, host, show, history}.
  let npStop = null;
  function beginNowPlaying(st) {
    endNowPlaying();
    if (!window.NowPlaying || !st) return;
    npStop = window.NowPlaying.start(st, info => { state.np = info; renderNowPlaying(); });
  }
  function endNowPlaying() {
    if (npStop) { npStop(); npStop = null; }
    state.np = null; renderNowPlaying();
  }
  function renderNowPlaying() { renderNowPage(); }

  // ---------- playback ----------
  // One <audio> element for the whole app. The TV plays it natively (Web Audio cannot tap it, so no in-app EQ).
  // `attempts` = stream URLs to try for the current station, preferred variant first; onFail() steps to the next one.
  const audio = $('#audio');
  let attempts = [], attemptIdx = 0;

  // Every URL worth trying for a station, preferred variant first, then the others as fallbacks.
  function attemptsFor(st, first) {
    const vs = st.variants && st.variants.length ? st.variants.slice() : [{ uuid: st.id, url: st.url, alt: st.alt }];
    if (first) { const i = vs.findIndex(v => v.url === first.url); if (i > 0) vs.unshift(vs.splice(i, 1)[0]); }
    const urls = [];
    for (const v of vs) for (const u of [v.url, v.alt]) if (u && !urls.includes(u)) urls.push(u);
    return urls;
  }
  const qLabel = v => (v ? [v.codec, v.bitrate ? v.bitrate + 'k' : ''].filter(Boolean).join(' ') : '');
  function currentVariant() {
    const st = state.current;
    if (!st || !st.variants) return null;
    const u = attempts[attemptIdx];
    return st.variants.find(v => v.url === u || v.alt === u) || null;
  }

  // Start a station (always an explicit user action or resume-on-start). `variant` = an encoding picked in the Quality list.
  // Saved as 'last', which is what resume-on-start plays.
  function play(st, variant) {
    state.current = st; store.set('last', st);
    state.variant = variant || null;
    attempts = attemptsFor(st, variant); attemptIdx = 0;
    renderPlayerInfo();
    beginNowPlaying(st);
    start(attempts[0]);
    // Courtesy to the directory: count the listen so popularity stays meaningful.
    const uuid = (variant && variant.uuid) || st.uuid || st.id;
    if (uuid && !String(uuid).includes(':')) fetch(API_HOSTS[hostIdx] + '/json/url/' + encodeURIComponent(uuid)).catch(() => {});
  }

  function showQuality(target, returnTo) {
    const st = target || state.current;
    if (!st || !st.variants || st.variants.length < 2) return;
    const active = sameStation(st, state.current) ? currentVariant() : null;
    const items = st.variants.map(v => ({ label: qLabel(v) || 'Unknown', sub: v === st.variants[0] ? 'best' : '', value: v.url, variant: v }));
    openPicker('Quality', items, active ? active.url : st.url, it => play(st, it.variant), returnTo || $('#d-quality'));
  }

  function start(url) {
    setStatus('Connecting…');
    state.playing = true; renderPlayerButtons();
    audio.src = url;
    const p = audio.play();
    if (p && p.catch) p.catch(e => {
      if (e && e.name === 'NotAllowedError') { state.playing = false; renderPlayerButtons(); setStatus('Stopped'); return; } // autoplay blocked: not a stream fault
      if (e && e.name !== 'AbortError') onFail();
    });
  }

  function onFail() {
    if (attemptIdx + 1 < attempts.length) { attemptIdx++; start(attempts[attemptIdx]); return; }
    state.playing = false; renderPlayerButtons();
    setStatus('This stream would not play. Try another station.', true);
  }

  function stop() {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    endNowPlaying();
    state.playing = false; renderPlayerButtons();
    setStatus(state.current ? 'Stopped' : '');
  }

  function togglePlay() {
    if (!state.current) return;
    if (state.playing) stop(); // live radio: stopping beats pausing, resuming would replay stale buffer
    else { attempts = attemptsFor(state.current, state.variant); attemptIdx = 0; beginNowPlaying(state.current); start(attempts[0]); }
  }

  audio.addEventListener('playing', () => {
    state.playing = true; renderPlayerButtons();
    const multi = state.current && state.current.variants && state.current.variants.length > 1;
    setStatus(multi ? 'Playing · ' + qLabel(currentVariant()) : 'Playing');
  });
  audio.addEventListener('waiting', () => { if (state.playing) setStatus('Buffering…'); });
  audio.addEventListener('error', () => { if (audio.getAttribute('src')) onFail(); });

  // ---------- station details page ----------
  // Selecting a station opens this page; nothing plays until Play is pressed.
  const ICON_STOP = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const prettyCountry = n => String(n || '').replace(/^The /, '').replace('United States Of America', 'United States').replace('United Kingdom Of Great Britain And Northern Ireland', 'United Kingdom');
  const hostOf = u => { try { return new URL(/^https?:/i.test(u) ? u : 'http://' + u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

  // Opening a station from another station's "Other streams" tab stacks the pages; Back walks back down.
  function openDetail(st, opener, tab) {
    if (!st) return;
    state.fresh = false;
    const prev = state.detail;
    const base = prev ? { opener: prev.opener, scroll: prev.scroll } : { opener, scroll: $('#main').scrollTop };
    const stack = prev ? prev.stack.concat([{ st: prev.st, tab: prev.tab }]) : [];
    enterDetail(st, base, stack, tab);
  }

  // state.detail = {st, opener, scroll, stack, tab, wantSources, info, listKey, timer, emptyShown, stop}
  //   opener  element to refocus on Back;  scroll  #main scrollTop to restore;  stack  earlier stations (drilling through
  //   "Other streams");  wantSources  open on that tab once the sibling lookup finishes;  info / listKey  latest now-playing
  //   info and a signature of the history rows (rows are only rebuilt when it changes);  stop  stops this page's feed.
  function enterDetail(st, base, stack, tab) {
    stopDetailFeeds();
    const d = state.detail = { st, opener: base.opener, scroll: base.scroll, stack, tab: 'history', wantSources: tab === 'sources', info: null, listKey: '', timer: 0, emptyShown: false };
    $('#detail').hidden = false; renderChrome();
    renderNav();
    $('#d-list').textContent = ''; $('#d-sources').textContent = ''; $('#d-empty').hidden = true;
    renderDetail();
    ensureSource(st);
    $('#detail').scrollTop = 0;
    if (window.NowPlaying) d.stop = window.NowPlaying.start(st, info => { if (state.detail === d) renderDetailList(info); });
    d.timer = setTimeout(() => { if (state.detail === d && !d.listKey) { d.emptyShown = true; if (d.tab === 'history') $('#d-empty').hidden = false; } }, 6000);
    setTab(d.wantSources && sourceFor(st) ? 'sources' : 'history');
    $('#d-play').focus();
  }

  function stopDetailFeeds() {
    const d = state.detail;
    if (d) { if (d.stop) d.stop(); clearTimeout(d.timer); }
  }

  function closeDetail() {
    const d = state.detail;
    if (!d) return null;
    stopDetailFeeds();
    state.detail = null;
    $('#detail').hidden = true; renderChrome();
    renderNav();
    $('#main').scrollTop = d.scroll;
    return d;
  }

  function exitDetail() {
    const d = state.detail;
    if (!d) return;
    if (d.stack.length) { // back to the station we came from
      const prev = d.stack[d.stack.length - 1];
      enterDetail(prev.st, { opener: d.opener, scroll: d.scroll }, d.stack.slice(0, -1), prev.tab);
      return;
    }
    closeDetail();
    let target = d.opener && document.body.contains(d.opener) ? d.opener : null;
    if (!target) target = document.querySelector('#grid [data-id="' + String(d.st.id).replace(/"/g, '\\"') + '"], #home [data-id="' + String(d.st.id).replace(/"/g, '\\"') + '"]');
    if (!target) target = $('#tab-' + state.view);
    if (target) target.focus({ preventScroll: true });
  }

  function setTab(tab) {
    const d = state.detail; if (!d) return;
    const hasSrc = !!sourceFor(d.st);
    if (tab === 'sources' && !hasSrc) tab = 'history';
    d.tab = tab;
    $('#d-tab-history').classList.toggle('active', tab === 'history');
    $('#d-tab-sources').classList.toggle('active', tab === 'sources');
    $('#d-tab-sources').hidden = !hasSrc;
    $('#d-list').hidden = tab !== 'history';
    $('#d-empty').hidden = !(tab === 'history' && d.emptyShown);
    $('#d-sources').hidden = tab !== 'sources';
    if (tab === 'sources') renderDetailSources();
  }

  function renderDetailSources() {
    const d = state.detail; if (!d) return;
    const src = sourceFor(d.st);
    const box = $('#d-sources'); box.textContent = '';
    if (!src) return;
    for (const s of src.streams) box.appendChild(cardFor(s)); // same cards as browsing; selecting one opens its page
    enrichProvider(src).then(changed => { if (changed && state.detail === d && d.tab === 'sources') renderDetailSources(); });
  }

  function renderDetail() {
    const d = state.detail; if (!d) return;
    const st = d.st;
    $('#d-name').textContent = st.name;
    // artwork
    const img = $('#d-img'), letter = $('#d-letter');
    letter.textContent = initialOf(st.name); img.hidden = true;
    if (st.favicon) { img.onload = () => { if (img.naturalWidth < 32 || img.naturalHeight < 32) return; img.hidden = false; letter.textContent = ''; }; img.onerror = () => { img.hidden = true; }; img.src = st.favicon; }
    // sub line: flag, country, quality, host
    const sub = $('#d-sub'); sub.textContent = '';
    if (st.cc) sub.appendChild(flagNode(st.cc, st.country));
    const nv = st.variants ? st.variants.length : 1;
    const q = [st.codec, st.bitrate ? st.bitrate + 'k' : ''].filter(Boolean).join(' ');
    const host = d.info && d.info.host ? 'Hosted by ' + d.info.host : '';
    sub.appendChild(el('span', '', [prettyCountry(st.country || st.cc), q, nv > 1 ? nv + ' qualities' : '', host].filter(Boolean).join(' \u00b7 ')));
    $('#d-genres').textContent = tagList(st.tags).filter(g => !/^\d+s?$/.test(g)).slice(0, 6).map(cap).join(' \u00b7 ');
    $('#d-desc').textContent = [st.desc, st.lang ? 'Language: ' + cap(st.lang) : '', st.homepage ? hostOf(st.homepage) : ''].filter(Boolean).join(' \u00b7 ');
    renderDetailButtons();
  }

  function renderDetailButtons() {
    const d = state.detail; if (!d) return;
    const st = d.st;
    const isCur = sameStation(st, state.current);
    const live = isCur && state.playing;
    $('#d-play').innerHTML = (live ? ICON_STOP : ICON.play) + '<span>' + (live ? 'Stop' : 'Play') + '</span>';
    $('#d-fav').innerHTML = isFav(st.id) ? ICON.starOn : ICON.starOff;
    $('#d-quality').hidden = !(st.variants && st.variants.length > 1);
  }

  function renderDetailList(info) {
    const d = state.detail; if (!d) return;
    const hostChanged = (d.info && d.info.host) !== (info && info.host);
    d.info = info;
    if (hostChanged) renderDetail();
    const rows = (info && info.history) || [];
    const key = rows.map(h => (h.at || '') + h.title).join('|');
    if (key === d.listKey) return; // feeds re-send unchanged data; don't rebuild rows (it would drop focus)
    d.listKey = key;
    const list = $('#d-list'); list.textContent = '';
    if (rows.length) { d.emptyShown = false; $('#d-empty').hidden = true; }
    const time = at => { const t = new Date(at); return isNaN(t) ? '' : t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
    rows.forEach((h, i) => {
      const r = el('button', 'f track');
      const th = el('div', 'thumb');
      if (h.art) { const im = new Image(); im.alt = ''; im.onload = () => th.appendChild(im); im.src = h.art; }
      r.appendChild(th);
      const tt = el('div', 'tt');
      tt.appendChild(el('div', 'ttl', h.title || ''));
      if (h.artist) tt.appendChild(el('div', 'art', h.artist));
      r.appendChild(tt);
      r.appendChild(el('div', 'when' + (i === 0 ? ' now' : ''), i === 0 ? 'On now' : time(h.at)));
      list.appendChild(r);
    });
  }

  // ---------- sources for any station ----------
  // Curated providers (providers.js) are known up front. For everything else, look for stations in the
  // directory that share this station's website and brand word (e.g. all the Sanctuary Radio channels).
  const GENERIC_HOSTS = ['facebook.com', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'tunein.com',
    'zeno.fm', 'radio.garden', 'radio.net', 'onlineradiobox.com', 'mytuner-radio.com', 'live365.com', 'shoutcast.com', 'icecast.org',
    'wordpress.com', 'blogspot.com', 'google.com', 'linktr.ee', 'radiojar.com', 'streamtheworld.com', 'wixsite.com', 'weebly.com',
    'iheart.com', 'radioking.com', 'radio.co', 'listen2myradio.com', 'streamguys.com', 'caster.fm', 'myradio.click'];
  const STOPWORDS = new Set(['the', 'radio', 'fm', 'am', 'la', 'el', 'le', 'les', 'de', 'der', 'die', 'das', 'online', 'web', 'hd', 'live', 'rádio', 'radyo']);
  const brandWord = name => { for (const w of baseKey(name || '').split(' ')) if (w && !STOPWORDS.has(w)) return w; return ''; };
  const homeHost = st => {
    const h = hostOf(st.homepage || '');
    return h && !GENERIC_HOSTS.some(g => h === g || h.endsWith('.' + g)) ? h : '';
  };
  const sourceCache = new Map(); // homepage host -> source | null
  function commonBrand(groups) {
    const lists = groups.map(g => g.name.split(/\s+/));
    let n = 0;
    while (lists.every(l => l[n] && l[n].toLowerCase() === lists[0][n].toLowerCase())) n++;
    return lists[0].slice(0, n).join(' ');
  }
  // undefined = not looked up yet, null = no siblings, object = a source with `streams`
  function sourceFor(st) {
    if (!st) return null;
    const p = providerFor(st); if (p) return p;
    const h = homeHost(st); if (!h) return null;
    return sourceCache.has(h) ? sourceCache.get(h) : undefined;
  }
  async function lookupSource(st) {
    const p = providerFor(st); if (p) return p;
    const h = homeHost(st), word = brandWord(st.name);
    if (!h || !word) return null;
    if (sourceCache.has(h)) return sourceCache.get(h);
    let src = null;
    try {
      const raw = await api('/json/stations/search', { name: word, hidebroken: 'true', limit: '100', order: 'votes', reverse: 'true' });
      const map = new Map(), groups = [];
      for (const r of raw) {
        if (r.hls) continue;
        const s = compact(r);
        if (!s.url || homeHost(s) !== h || brandWord(s.name) !== word) continue; // same site AND same brand
        const g = mergeInto(map, s);
        if (g) groups.push(g);
      }
      if (groups.length >= 2) {
        const brand = commonBrand(groups);
        src = { id: 'dyn:' + h, name: brand && brand.length > 2 ? brand : h, streams: groups, _enriched: true };
      }
    } catch (e) { return null; } // offline: don't cache, ask again later
    sourceCache.set(h, src);
    return src;
  }
  // Called when a sibling lookup finishes: reveal the "Other streams" tab (and jump to it if asked).
  function refreshSourceButtons() {
    const d = state.detail; if (!d) return;
    if (d.wantSources && sourceFor(d.st)) { d.wantSources = false; setTab('sources'); } else setTab(d.tab);
  }
  function ensureSource(st) {
    if (st && sourceFor(st) === undefined) lookupSource(st).then(refreshSourceButtons);
  }

  function detailPlay() {
    const d = state.detail; if (!d) return;
    const isCur = sameStation(d.st, state.current);
    if (isCur && state.playing) stop();
    else if (isCur) togglePlay();
    else play(d.st);
  }

  // ---------- exit prompt (Back at the top level) ----------
  let exitReturn = null;
  function openExit() {
    exitReturn = document.activeElement;
    state.exitOpen = true;
    $('#exit-dialog').hidden = false;
    $('#exit-no').focus(); // the safe choice has focus; Back again exits
  }
  function closeExit() {
    if (!state.exitOpen) return;
    state.exitOpen = false;
    $('#exit-dialog').hidden = true;
    if (exitReturn && document.body.contains(exitReturn)) exitReturn.focus({ preventScroll: true });
  }
  function exitApp() {
    // Close the app itself. (platformBack asks the TV to "generate RECENT key", which opens its recent-apps
    // screen before the app goes away: that was the second prompt.) It stays as a fallback if closing fails.
    try { window.close(); } catch (e) { /* ignore */ }
    setTimeout(() => { try { if (window.PalmSystem && window.PalmSystem.platformBack) window.PalmSystem.platformBack(); } catch (e) { /* not on a TV */ } }, 900);
  }

  // ---------- picker (modal list) ----------
  const picker = $('#picker'), pickerList = $('#picker-list');

  function openPicker(title, items, selectedValue, onPick, returnTo) {
    $('#picker-title').textContent = title;
    pickerList.textContent = '';
    let sel = null;
    for (const it of items) {
      if (it.header) { pickerList.appendChild(el('div', 'hdr', it.header)); continue; } // section label, not focusable
      const b = el('button', 'f opt');
      const lbl = el('span', 'lbl');
      if (it.flag) lbl.appendChild(flagNode(it.flag));
      lbl.appendChild(document.createTextNode(it.label));
      b.appendChild(lbl);
      if (it.sub) b.appendChild(el('span', 'sub', it.sub));
      if (it.value === selectedValue) { b.classList.add('sel'); sel = b; }
      b.addEventListener('click', () => { closePicker(); onPick(it); });
      pickerList.appendChild(b);
    }
    state.picker = { returnTo };
    picker.hidden = false;
    (sel || pickerList.firstChild).focus();
  }

  function openMultiPicker(title, names, selected, onChange, returnTo) {
    $('#picker-title').textContent = title;
    pickerList.textContent = '';
    for (const name of names) {
      const b = el('button', 'f opt');
      b.appendChild(el('span', 'lbl', name));
      b.classList.toggle('sel', selected.has(name));
      b.addEventListener('click', () => {
        if (selected.has(name)) selected.delete(name); else selected.add(name);
        b.classList.toggle('sel', selected.has(name));
        onChange(names.filter(n => selected.has(n)));
      });
      pickerList.appendChild(b);
    }
    state.picker = { returnTo };
    picker.hidden = false;
    pickerList.firstChild.focus();
  }

  function closePicker() {
    if (!state.picker) return;
    const back = state.picker.returnTo;
    state.picker = null; picker.hidden = true;
    if (back) back.focus();
  }

  // ---------- Home shelves ----------
  const localeCountry = () => { const m = /[-_]([A-Za-z]{2})\b/.exec(navigator.language || ''); return m ? m[1].toUpperCase() : ''; };
  const homeCountry = () => state.filters.cc || localeCountry(); // your country: the Country filter, else the TV's language

  async function loadHome() {
    const cc = homeCountry();
    if (home.cc === cc && home.shelves.length && !home.error) return; // already loaded for this country
    home.cc = cc; home.error = false;
    const token = ++home.token;
    const fams = window.GENRES.families;
    home.shelves = fams.map(f => ({ family: f.name, stations: [], state: 'loading' }));
    renderHome();
    await Promise.all(fams.map(async (fam, i) => {
      try {
        // the family's main word, matched anywhere in a tag; the family test then weeds out near-misses
        const params = { hidebroken: 'true', limit: '40', order: 'votes', reverse: 'true', tag: fam.terms[0] };
        if (cc) params.countrycode = cc;
        const raw = await api('/json/stations/search', params);
        if (token !== home.token) return;
        const map = new Map(), stations = [];
        for (const r of raw) {
          if (!fam.test.test(r.tags || '')) continue;
          const s = compact(r);
          if (s.hls || !s.url) continue;
          const g = mergeInto(map, s);
          if (g) stations.push(g);
        }
        home.shelves[i].stations = stations; // trimmed at render time, once overlaps between shelves are known
        home.shelves[i].state = 'done';
      } catch (e) {
        if (token !== home.token) return;
        home.shelves[i].state = 'error';
      }
      if (token === home.token && state.view === 'browse') renderHome();
    }));
    if (token === home.token && home.shelves.every(s => s.state === 'error')) { home.error = true; if (state.view === 'browse') renderHome(); }
  }

  function renderHome() {
    const box = $('#home');
    const scroll = $('#main').scrollTop;
    box.textContent = '';
    let shown = 0;
    const used = new Set(); // a station appears in only the first shelf that claims it (shelves overlap: "rock" matches metal too)
    for (const sh of home.shelves) {
      const stations = sh.stations.filter(s => !used.has(s.id)).slice(0, 12);
      if (sh.state === 'error' || (sh.state === 'done' && !stations.length)) continue;
      for (const s of stations) used.add(s.id);
      shown++;
      const sec = el('section', 'shelf');
      sec.appendChild(el('h2', '', sh.family));
      const row = el('div', 'row');
      if (sh.state === 'loading') row.appendChild(el('div', 'shelf-wait', 'Loading\u2026'));
      for (const st of stations) row.appendChild(cardFor(st));
      if (sh.state === 'done') {
        const more = el('button', 'f card seeall');
        const art = el('div', 'logo'); art.appendChild(el('span', 'letter', '\u203a'));
        more.appendChild(art);
        more.appendChild(el('div', 'name', 'See all'));
        more.addEventListener('click', () => showFamily(sh.family));
        row.appendChild(more);
      }
      sec.appendChild(row);
      box.appendChild(sec);
    }
    if (!shown) box.appendChild(el('div', 'home-empty', home.error ? 'Could not reach the station directory. Check the network and try again.' : 'Loading\u2026'));
    $('#main').scrollTop = scroll;
  }

  // ---------- Settings ----------
  const SETTINGS = [
    { key: 'autoplay', label: 'Play last station on start', options: [[true, 'On'], [false, 'Off']] },
    { key: 'startOn', label: 'Open on', options: [['now', 'Now Playing'], ['home', 'Home']] },
    { key: 'hiddenGenres', label: 'Hide genres on Search', multi: true },
  ];
  const hiddenSummary = () => { const h = settings.hiddenGenres || []; return h.length === 0 ? 'None' : h.length <= 2 ? h.join(', ') : h.length + ' hidden'; };
  function renderSettings() {
    const box = $('#settings');
    box.textContent = '';
    for (const s of SETTINGS) {
      const row = el('button', 'f setting');
      row.appendChild(el('span', 'lbl', s.label));
      if (s.multi) {
        const val = el('span', 'val', hiddenSummary());
        row.appendChild(val);
        row.addEventListener('click', () => {
          const names = window.GENRES.families.map(f => f.name);
          openMultiPicker(s.label, names, new Set(settings.hiddenGenres || []), list => {
            settings.hiddenGenres = list;
            store.set('settings', settings);
            val.textContent = hiddenSummary();
            lists.search.pages = []; // Search re-runs with the new list the next time it is shown
          }, row);
        });
        box.appendChild(row);
        continue;
      }
      const cur = s.options.find(o => o[0] === settings[s.key]) || s.options[0];
      row.appendChild(el('span', 'val', cur[1]));
      row.addEventListener('click', () => {
        const i = s.options.findIndex(o => o[0] === settings[s.key]);
        settings[s.key] = s.options[(i + 1) % s.options.length][0]; // select = flip to the next option
        store.set('settings', settings);
        renderSettings();
        $('#settings').children[SETTINGS.indexOf(s)].focus({ preventScroll: true });
      });
      box.appendChild(row);
    }
  }

  // "See all" opens Search already filtered to that genre family.
  function showFamily(name) {
    state.filters.tagFamily = name; state.filters.tag = '';
    store.set('filters', state.filters);
    lists.search.pages = []; // force a fresh query
    goTab('search');
  }

  function applyFilters() {
    store.set('filters', state.filters);
    renderFilters();
    if (state.view === 'search') search(); else renderGrid(true);
  }

  async function pickCountry() {
    const opener = $('#f-country');
    let list;
    try { list = await loadCountries(); } catch (e) { list = []; }
    // Group by region (North America first); within a region the list stays sorted by station count.
    const byRegion = new Map(window.REGION_ORDER.map(r => [r, []]));
    for (const c of list) byRegion.get(window.regionOf(c.code)).push(c);
    const items = [{ label: 'Any country', value: '' }];
    for (const [region, countries] of byRegion) {
      if (!countries.length) continue;
      items.push({ header: region });
      for (const c of countries) items.push({ label: c.name, sub: String(c.n), value: c.code, name: c.name, flag: c.code });
    }
    openPicker('Country', items, state.filters.cc, it => { state.filters.cc = it.value; state.filters.ccLabel = it.name || ''; applyFilters(); }, opener);
  }
  async function pickTag() {
    const opener = $('#f-tag');
    let list;
    try { list = await loadTags(); } catch (e) { list = []; }
    // Families first ("All Rock" plus its sub-genres), then whatever didn't fit a family.
    const cap = s => s[0].toUpperCase() + s.slice(1);
    const items = [{ label: 'Any genre', value: '' }];
    for (const [family, tags] of window.GENRES.group(list)) {
      if (!tags.length) continue;
      items.push({ header: family });
      if (family !== window.GENRES.OTHER) items.push({ label: 'All ' + family, value: 'fam:' + family });
      for (const t of tags) items.push({ label: cap(t.name), sub: String(t.n), value: t.name });
    }
    const selected = state.filters.tagFamily ? 'fam:' + state.filters.tagFamily : state.filters.tag;
    openPicker('Genre', items, selected, it => {
      if (it.value.startsWith('fam:')) { state.filters.tagFamily = it.value.slice(4); state.filters.tag = ''; }
      else { state.filters.tagFamily = ''; state.filters.tag = it.value; }
      applyFilters();
    }, opener);
  }
  function pickBitrate() {
    const items = BITRATES.map(b => ({ label: b ? b + 'k and up' : 'Any bitrate', value: b }));
    openPicker('Minimum bitrate', items, state.filters.bitrate, it => { state.filters.bitrate = it.value; applyFilters(); }, $('#f-bitrate'));
  }
  function pickOrder() {
    const items = ORDERS.map(o => ({ label: o.label, value: o.v }));
    openPicker('Sort by', items, state.filters.order, it => { state.filters.order = it.value; applyFilters(); }, $('#f-order'));
  }

  function setView(v) {
    if (state.view === v) return;
    state.view = v;
    if (v === 'browse' || v === 'favorites') store.set('view', v);
    if (v === 'search') $('#q').value = state.query;
    renderFilters();
    // Home loads once; coming back to it (or to Search) shows what was already there.
    if (v === 'browse') { loadHome(); renderGrid(true); }
    else if (v === 'search' && !lists.search.pages.length && !lists.search.loading && searchActive()) search(); // Search loads once it has something to look for
    else renderGrid(true);
  }

  // ---------- wiring ----------
  $('#pg-prev').addEventListener('click', prevPage);
  $('#pg-next').addEventListener('click', nextPage);
  $('#d-back').addEventListener('click', exitDetail);
  $('#exit-yes').addEventListener('click', exitApp);
  $('#exit-no').addEventListener('click', closeExit);
  $('#f-country').addEventListener('click', pickCountry);
  $('#f-tag').addEventListener('click', pickTag);
  $('#f-bitrate').addEventListener('click', pickBitrate);
  $('#f-order').addEventListener('click', pickOrder);
  // Moving onto a nav tab switches to it at once; no click needed. Each action is idempotent, because
  // focusing a tab is also how we hand focus back to the nav. A station page opened from Browse stays put
  // when you move up to the Browse tab (it is the section you are already in).
  const NAV_ACTIONS = {
    browse: () => { if (state.nowOpen || state.view !== 'browse') goTab('browse'); },
    search: () => { if (state.nowOpen || state.view !== 'search') goTab('search'); },
    settings: () => { if (state.nowOpen || state.view !== 'settings') goTab('settings'); },
    favorites: () => { if (state.nowOpen || state.view !== 'favorites') goTab('favorites'); },
    now: () => { if (!state.nowOpen) openNow(true); },
  };
  for (const name of Object.keys(NAV_ACTIONS)) {
    const b = $('#tab-' + name);
    b.addEventListener('focus', NAV_ACTIONS[name]);
    b.addEventListener('click', NAV_ACTIONS[name]);
  }
  $('#n-play').addEventListener('click', togglePlay);
  $('#n-fav').addEventListener('click', () => toggleFav(state.current));
  $('#n-info').addEventListener('click', () => { if (!state.current) return; closeNow(); openDetail(state.current, $('#tab-now')); });
  $('#d-play').addEventListener('click', detailPlay);
  $('#d-fav').addEventListener('click', () => { if (state.detail) toggleFav(state.detail.st); });
  $('#d-quality').addEventListener('click', () => { if (state.detail) showQuality(state.detail.st, $('#d-quality')); });
  $('#d-tab-history').addEventListener('click', () => setTab('history'));
  $('#d-tab-sources').addEventListener('click', () => setTab('sources'));
  // Filter as you type: debounce so a fast typist doesn't fire a network search per keystroke.
  let typeTimer = 0;
  const commitQuery = () => {
    clearTimeout(typeTimer);
    const v = $('#q').value.trim();
    if (state.view !== 'search') return;
    if (v !== state.query) { state.query = v; search(); }
  };
  $('#q').addEventListener('input', () => { clearTimeout(typeTimer); typeTimer = setTimeout(commitQuery, 350); });
  $('#q').addEventListener('change', commitQuery);

  // Magic Remote pointer: hovering focuses, so pointer and D-pad share one focus model.
  document.addEventListener('mouseover', e => {
    const f = e.target.closest && e.target.closest('.f');
    if (f && f !== document.activeElement && f.tagName !== 'INPUT') f.focus({ preventScroll: true });
  });

  // ---------- D-pad spatial navigation ----------
  function focusables() {
    const scope = state.exitOpen ? $('#exit-dialog') : (state.picker ? picker : document);
    return [...scope.querySelectorAll('.f')].filter(n => !n.hidden && n.offsetParent !== null);
  }

  // Spatial navigation. From the focused .f element, pick the best .f element in the direction of travel. The score is
  // the gap between edges plus a penalty for not overlapping (details inside). Moving up into the nav lands on the
  // active tab rather than whichever tab is nearest, because focusing a tab switches to it.
  function move(dir) {
    const els = focusables();
    const cur = document.activeElement;
    if (!cur || !cur.classList || !cur.classList.contains('f') || !els.includes(cur)) { if (els[0]) els[0].focus(); return; }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestScore = Infinity;
    for (const n of els) {
      if (n === cur) continue;
      const b = n.getBoundingClientRect();
      const dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
      // Judge by edges, not centres: an item that overlaps ours in the direction of travel is "straight ahead"
      // even if its centre is far off (a wide search box under a small icon), and the gap between edges is the distance.
      const overlapX = Math.min(r.right, b.right) - Math.max(r.left, b.left);
      const overlapY = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      let along, across;
      if (dir === 'left') { if (dx >= -4) continue; along = Math.max(0, r.left - b.right); across = overlapY > 0 ? 0 : -overlapY; }
      else if (dir === 'right') { if (dx <= 4) continue; along = Math.max(0, b.left - r.right); across = overlapY > 0 ? 0 : -overlapY; }
      else if (dir === 'up') { if (dy >= -4) continue; along = Math.max(0, r.top - b.bottom); across = overlapX > 0 ? 0 : -overlapX; }
      else { if (dy <= 4) continue; along = Math.max(0, b.top - r.bottom); across = overlapX > 0 ? 0 : -overlapX; }
      // among equals, prefer the one lined up most closely with where we are
      const score = along + across * 3 + (dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy)) * 0.02;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best && best.closest('#nav') && !cur.closest('#nav')) { const act = $('#nav .tab.active'); if (act) best = act; }
    if (best) {
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  // The one key handler. Arrow keys call move(); OK clicks the focused element; colour keys and media keys are shortcuts.
  // Back (461) unwinds in this order: typing > exit prompt (confirms) > pop-up list > Now Playing > station page >
  // Search/Favorites/Settings -> Home > exit prompt.
  document.addEventListener('keydown', e => {
    const k = e.keyCode;
    const inInput = e.target && e.target.tagName === 'INPUT';
    // The search box is a button until you press OK on it; only then is it a text field (and the keyboard opens).
    const editing = inInput && !e.target.readOnly;
    if (editing) {
      const q = e.target;
      const atStart = q.selectionStart === 0 && q.selectionEnd === 0, atEnd = q.selectionStart === q.value.length;
      if (k === KEY.BACKSPACE) return;                       // deleting text
      if (k === KEY.LEFT && !atStart) return;                // caret moves inside the text...
      if (k === KEY.RIGHT && !atEnd) return;
      if (k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN) { // ...and at the edges (or up/down) you step out
        e.preventDefault(); endEdit();
        move(k === KEY.LEFT ? 'left' : k === KEY.RIGHT ? 'right' : k === KEY.UP ? 'up' : 'down');
        return;
      }
    }
    switch (k) {
      case KEY.LEFT: e.preventDefault(); move('left'); break;
      case KEY.RIGHT: e.preventDefault(); move('right'); break;
      case KEY.UP: e.preventDefault(); move('up'); break;
      case KEY.DOWN: e.preventDefault(); move('down'); break;
      case KEY.ENTER:
        if (inInput) { e.preventDefault(); if (editing) endEdit(); else startEdit(); } // OK starts typing; OK again is Done
        else if (e.target.classList && e.target.classList.contains('f')) { e.preventDefault(); e.target.click(); }
        break;
      case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE: {
        e.preventDefault();
        if (editing) endEdit(); // Back stops typing and stays on the page
        else if (state.exitOpen) exitApp(); // Back again on the prompt confirms
        else if (state.picker) closePicker();
        else if (state.nowOpen) { if (state.fresh) openExit(); else exitNow(); } // nothing behind a freshly opened Now Playing
        else if (state.detail) exitDetail();
        else if (state.view !== 'browse') goTab('browse'); // Search / Favorites -> Home
        else openExit(); // already at the top: ask
        break;
      }
      case KEY.BLUE: {
        e.preventDefault();
        const f = document.activeElement;
        if (state.detail) setTab('sources'); // Blue: jump to the other streams
        else openDetail(f && f._station ? f._station : state.current, f, 'sources');
        break;
      }
      case KEY.YELLOW: {
        e.preventDefault();
        const f = document.activeElement;
        toggleFav(f && f._station ? f._station : (state.detail ? state.detail.st : state.current));
        break;
      }
      case KEY.PLAY: {
        e.preventDefault();
        // Play on a focused card (or the open details page) starts that station; otherwise resume the current one.
        const f = document.activeElement;
        const target = f && f._station ? f._station : (state.detail ? state.detail.st : null);
        if (target && !(sameStation(target, state.current) && state.playing)) play(target);
        else if (!state.playing) togglePlay();
        break;
      }
      case KEY.PAUSE: case KEY.STOP: e.preventDefault(); if (state.playing) stop(); break;
      case 33: case 427: if (!state.picker) { e.preventDefault(); prevPage(); } break; // PageUp / CH-
      case 34: case 428: if (!state.picker) { e.preventDefault(); nextPage(); } break; // PageDown / CH+
      case KEY.PLAYPAUSE: e.preventDefault(); togglePlay(); break;
      default: break;
    }
  });

  // UNUSED: nothing calls this any more (the search box commits through commitQuery()); safe to delete.
  function applyQueryFromInput() { commitQuery(); }

  // ---------- search box: highlight first, type on OK ----------
  const qBox = $('#q');
  function startEdit() {
    qBox.readOnly = false;
    qBox.focus();
    try { qBox.setSelectionRange(qBox.value.length, qBox.value.length); } catch (e) { /* not supported for this input type */ }
  }
  function endEdit() {
    if (qBox.readOnly) return;
    qBox.readOnly = true;
    commitQuery();
    qBox.blur(); qBox.focus({ preventScroll: true }); // re-focusing a read-only box keeps the highlight and closes the keyboard
  }
  qBox.addEventListener('blur', () => { if (!qBox.readOnly) { qBox.readOnly = true; commitQuery(); } }); // keyboard dismissed, or focus moved away
  qBox.addEventListener('click', () => { if (qBox.readOnly) startEdit(); }); // pointer click

  // ---------- boot ----------
  // Order matters: render the chrome and the (empty) screen, start loading Home, then focus a tab. Focusing
  // #tab-now opens Now Playing (focus = activate), then resume-on-start plays the last station if the setting is on.
  try { localStorage.removeItem('radio.dbg'); } catch (e) { /* ignore */ } // leftover from the diagnostics build
  // Decorative bars along the bottom of Now Playing. CSS animates them while audio plays. They are NOT driven by the sound:
  // the TV plays the stream natively, so the app cannot read its levels. Each bar gets its own speed, delay and peak
  // (custom properties --d, --o, --h) so they do not move in step.
  for (let i = 0; i < 56; i++) {
    const bar = el('i');
    bar.style.setProperty('--d', (0.55 + Math.random() * 1.25).toFixed(2) + 's');
    bar.style.setProperty('--o', (-Math.random() * 2).toFixed(2) + 's');
    bar.style.setProperty('--h', (0.3 + Math.random() * 0.7).toFixed(2));
    $('#n-bars').appendChild(bar);
  }
  renderFilters();
  renderPlayerInfo();
  setStatus(state.current ? 'Stopped' : '');
  if (state.view === 'browse') loadHome();
  renderGrid(true);
  // Open on Now Playing when there is something to resume and that is the chosen start page (focusing the tab opens it).
  const firstFocus = state.current && settings.startOn === 'now' ? $('#tab-now') : $('#tab-' + state.view);
  state.fresh = firstFocus === $('#tab-now'); // launched straight onto Now Playing
  if (firstFocus) firstFocus.focus();
  if (state.current && settings.autoplay) togglePlay(); // pick up where you left off
})();
