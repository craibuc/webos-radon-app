'use strict';
// Now-playing metadata. window.NowPlaying.start(station, emit) -> stop()
//
// emit receives { title, artist, album, art, host, show, history: [{title, artist, art, at}] }
// (any field may be empty). Sources, in order of preference:
//   1. A provider's own feed (MPR/The Current): song, art, recent plays, hosts.
//   2. ICY metadata read straight from the stream. Browsers can only do this when the server
//      allows the Icy-MetaData header and exposes icy-metaint, which only some stations do.
// Album art falls back to the iTunes Search API when a source gives a title but no art.
(() => {
  const MPR_WS = 'wss://nowplayingv2.publicradio.org';
  const ICY_POLL_MS = 20000;
  const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // ---------- album art lookup ----------
  const artCache = new Map();
  async function findArt(artist, title) {
    const key = norm(artist + ' ' + title);
    if (artCache.has(key)) return artCache.get(key);
    let art = '';
    try {
      const r = await fetch('https://itunes.apple.com/search?' + new URLSearchParams({ term: artist + ' ' + title, entity: 'song', limit: '5' }));
      const j = await r.json();
      const a = norm(artist), t = norm(title);
      // Require both artist and title to line up, otherwise a wrong cover is worse than none.
      const hit = (j.results || []).find(x => {
        const xa = norm(x.artistName), xt = norm(x.trackName);
        return xt && xa && (xt.includes(t) || t.includes(xt)) && (xa.includes(a) || a.includes(xa));
      });
      if (hit && hit.artworkUrl100) art = hit.artworkUrl100.replace('100x100bb', '600x600bb');
    } catch (e) { /* offline or blocked: no art */ }
    artCache.set(key, art);
    return art;
  }

  // ---------- MPR feed (WebSocket) ----------
  function mprAdapter(programId, emit) {
    let dead = false, plays = [], schedule = [], hostInfo = { host: '', show: '' };
    const timers = [], sockets = [];

    const refreshHost = () => {
      const now = Date.now();
      const cur = schedule.find(s => Date.parse(s.start_dtim) <= now && now < Date.parse(s.end_dtim));
      const people = cur && cur.people ? cur.people.map(p => p.name).filter(Boolean) : [];
      const host = people.length > 1 ? people.slice(0, -1).join(', ') + ' and ' + people[people.length - 1] : (people[0] || '');
      hostInfo = { host, show: cur && cur.shows && cur.shows[0] ? cur.shows[0].name || '' : '' };
    };
    const push = () => {
      if (dead) return;
      const cur = plays[0] && plays[0].song;
      emit({
        title: cur ? cur.title || '' : '', artist: cur ? cur.artist || '' : '', album: cur ? cur.album || '' : '',
        art: cur ? cur.art_url || '' : '',
        history: plays.filter(p => p.song).map(p => ({ title: p.song.title, artist: p.song.artist, art: p.song.art_url || '', at: p.played_at })),
        host: hostInfo.host, show: hostInfo.show,
      });
    };
    function connect(path, onData) {
      let attempt = 0;
      const open = () => {
        if (dead) return;
        let ws;
        try { ws = new WebSocket(MPR_WS + '/' + path); } catch (e) { return; }
        sockets.push(ws);
        ws.onmessage = m => { attempt = 0; try { const d = JSON.parse(m.data); if (d && d.data) onData(d.data); } catch (e) { /* ignore bad frame */ } };
        ws.onclose = () => {
          if (dead || ++attempt > 6) return; // a stream with no feed closes at once; stop after a few tries
          timers.push(setTimeout(open, Math.min(60000, 3000 * attempt)));
        };
      };
      open();
    }
    connect('playlist/' + programId + '/v2', d => { if (Array.isArray(d.plays)) { plays = d.plays; refreshHost(); push(); } });
    connect('schedule/' + programId + '/v1', d => { if (Array.isArray(d.schedule)) { schedule = d.schedule; refreshHost(); push(); } });
    timers.push(setInterval(() => { refreshHost(); push(); }, 60000)); // the host changes on schedule, not on a push
    return () => { dead = true; timers.forEach(t => { clearTimeout(t); clearInterval(t); }); sockets.forEach(w => { try { w.close(); } catch (e) { /* already closed */ } }); };
  }

  // ---------- ICY metadata read directly from the stream ----------
  const decode = raw => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch (e) { return new TextDecoder('latin1').decode(raw); }
  };

  // Connect, read just far enough to reach the first metadata block, then hang up.
  async function readIcy(url, signal) {
    const res = await fetch(url, { headers: { 'Icy-MetaData': '1' }, signal });
    const mi = parseInt(res.headers.get('icy-metaint') || '0', 10);
    if (!res.ok || !mi || !res.body) { if (res.body) res.body.cancel(); throw new Error('no icy metadata available'); }
    const reader = res.body.getReader();
    let buf = new Uint8Array(0);
    const fill = async n => {
      while (buf.length < n) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb;
      }
    };
    try {
      let off = 0;
      for (let block = 0; block < 3; block++) { // a zero-length block means "unchanged"; look at a few
        await fill(off + mi + 1);
        const len = buf[off + mi] * 16;
        if (len) {
          await fill(off + mi + 1 + len);
          const m = /StreamTitle='([\s\S]*?)';/.exec(decode(buf.slice(off + mi + 1, off + mi + 1 + len)));
          return m ? m[1].trim() : '';
        }
        off += mi + 1;
      }
      return null;
    } finally { try { await reader.cancel(); } catch (e) { /* already closed */ } }
  }

  function splitTitle(text, stationName) {
    if (!text || norm(text) === norm(stationName) || /^(unknown|n\/a|-+)$/i.test(text)) return null;
    const i = text.indexOf(' - ');
    return i > 0 ? { artist: text.slice(0, i).trim(), title: text.slice(i + 3).trim() } : { artist: '', title: text };
  }

  function icyAdapter(url, stationName, emit) {
    let dead = false, timer = 0, ctl = null, last = null, fails = 0;
    const history = [];
    const tick = async () => {
      if (dead) return;
      ctl = new AbortController();
      try {
        const text = await readIcy(url, ctl.signal);
        fails = 0;
        if (text !== null && text !== last) {
          last = text;
          const t = splitTitle(text, stationName);
          if (t) { history.unshift({ title: t.title, artist: t.artist, art: '', at: new Date().toISOString() }); history.length = Math.min(history.length, 15); }
          emit({ title: t ? t.title : '', artist: t ? t.artist : '', album: '', art: '', host: '', show: '', history: history.slice() });
        }
      } catch (e) {
        if (dead) return;
        if (++fails >= 2) return; // the server does not expose ICY to a browser; stop quietly
      }
      timer = setTimeout(tick, ICY_POLL_MS);
    };
    tick();
    return () => { dead = true; clearTimeout(timer); if (ctl) ctl.abort(); };
  }

  // ---------- wiring ----------
  function feedFor(st) {
    let host;
    try { host = new URL(st.url).hostname.toLowerCase(); } catch (e) { return null; }
    for (const p of window.PROVIDERS || []) {
      if (p.feed !== 'mpr') continue;
      for (const s of p.streams) {
        try { if (s.programId && new URL(s.url).hostname.toLowerCase() === host) return s; } catch (e) { /* skip bad URL */ }
      }
    }
    return null;
  }

  function start(st, emit) {
    let dead = false, lastKey = '';
    const out = info => {
      if (dead) return;
      const key = info.artist + '|' + info.title;
      lastKey = key;
      emit(info);
      if (!info.art && info.title && info.artist) {
        findArt(info.artist, info.title).then(art => { if (art && !dead && lastKey === key) emit(Object.assign({}, info, { art })); });
      }
    };
    const feed = feedFor(st);
    const stop = feed ? mprAdapter(feed.programId, out) : icyAdapter(st.url, st.name, out);
    return () => { dead = true; stop(); };
  }

  window.NowPlaying = { start };
})();
