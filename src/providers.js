// Known multi-stream providers (curated data). A station whose stream host matches `hosts` is treated as part of the
// provider: its station page gets an "Other streams" tab listing `streams`, and (when `feed` is set) now-playing
// comes from the provider's own feed instead of the stream. Stations from providers NOT listed here still get
// "Other streams" through a directory lookup (see lookupSource in app.js); this file is for sources the directory
// does not know about, or knows only partially.
//
// Provider fields
//   id       short key, used to cache directory extras (localStorage radio.cache.prov.<id>)
//   name     shown in headings
//   hosts    stream host suffixes that identify the provider (matched on the end of the hostname)
//   feed     optional now-playing adapter name; only 'mpr' exists (nowplaying.js)
//   icon     fallback artwork for streams without their own `favicon` (a path inside src/)
//   streams  one entry per stream; same shape as an app station object (see compact() in app.js) plus:
//              programId  the provider's feed id for this stream (MPR: used in the WebSocket path)
//              desc       one-line description shown when a stream has no genre tags
//              url / alt  preferred stream and an alternative encoding
// The MPR list was read from thecurrent.org's own site; all 13 stream URLs were verified to respond.
// To add a provider: append an object here, add its logo under src/icons/, and (if it has a feed) add an adapter in nowplaying.js.
window.PROVIDERS = [
  {
    id: 'mpr',
    name: 'The Current / MPR',
    hosts: ['stream.publicradio.org'],
    feed: 'mpr', // now-playing via nowplayingv2.publicradio.org
    icon: 'icons/the-current.png', // family logo for streams without a distinct icon
    streams: [
    {
        "id": "mpr:the-current",
        "programId": "the-current",
        "name": "The Current",
        "desc": "Great Music Lives Here",
        "url": "https://current.stream.publicradio.org/current.mp3",
        "alt": "https://current.stream.publicradio.org/current.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:ritmofonica",
        "programId": "ritmofonica",
        "name": "Ritmofonica",
        "desc": "Tu Música, Tu Cultura/Ritmofonica: Your Music, Your Culture",
        "url": "https://ritmofonica.stream.publicradio.org/ritmofonica.mp3",
        "alt": "https://ritmofonica.stream.publicradio.org/ritmofonica.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:the-siren",
        "programId": "the-siren",
        "name": "The Siren",
        "desc": "Amplifying Women's Voices",
        "url": "https://thesiren.stream.publicradio.org/thesiren.mp3",
        "alt": "https://thesiren.stream.publicradio.org/thesiren.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:local-current",
        "programId": "local-current",
        "name": "Local Current",
        "desc": "Minnesota Music",
        "url": "https://localcurrent.stream.publicradio.org/localcurrent.mp3",
        "alt": "https://localcurrent.stream.publicradio.org/localcurrent.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:radio-heartland",
        "programId": "radio-heartland",
        "name": "Radio Heartland",
        "desc": "Acoustic, Americana and Roots",
        "url": "https://radioheartland.stream.publicradio.org/radioheartland.mp3",
        "alt": "https://radioheartland.stream.publicradio.org/radioheartland.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:rockthecradle",
        "programId": "rockthecradle",
        "name": "Rock The Cradle",
        "desc": "Music for kids and their adults",
        "url": "https://rockthecradle.stream.publicradio.org/rockthecradle.mp3",
        "alt": "https://rockthecradle.stream.publicradio.org/rockthecradle.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:purple-current",
        "programId": "purple-current",
        "name": "Purple Current",
        "desc": "Exploring the musical legacy of Prince and beyond",
        "url": "https://purplecurrent.stream.publicradio.org/purplecurrent.mp3",
        "alt": "https://purplecurrent.stream.publicradio.org/purplecurrent.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:carbon-sound",
        "programId": "carbon-sound",
        "name": "Carbon Sound",
        "desc": "Music For Life",
        "url": "https://carbonsound.stream.publicradio.org/carbonsound.mp3",
        "alt": "https://carbonsound.stream.publicradio.org/carbonsound.aac",
        "favicon": "https://www.carbonsound.fm/images/carbon-sound-logo.png",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:current-holiday",
        "programId": "current-holiday",
        "name": "The Current Holiday",
        "desc": "",
        "url": "https://currentholiday.stream.publicradio.org/currentholiday.mp3",
        "alt": "https://currentholiday.stream.publicradio.org/currentholiday.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:teenage-kicks",
        "programId": "teenage-kicks",
        "name": "Teenage Kicks",
        "desc": "",
        "url": "https://teenagekicks.stream.publicradio.org/teenagekicks.mp3",
        "alt": "https://teenagekicks.stream.publicradio.org/teenagekicks.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:current-20",
        "programId": "current-20",
        "name": "Current 20",
        "desc": "",
        "url": "https://current20.stream.publicradio.org/current20.mp3",
        "alt": "https://current20.stream.publicradio.org/current20.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:current-pride",
        "programId": "current-pride",
        "name": "Current Pride",
        "desc": "",
        "url": "https://currentpride.stream.publicradio.org/CurrentPride.mp3",
        "alt": "https://currentpride.stream.publicradio.org/CurrentPride.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    },
    {
        "id": "mpr:current-halloween",
        "programId": "current-halloween",
        "name": "Current Halloween",
        "desc": "",
        "url": "https://currenthalloween.stream.publicradio.org/currenthalloween.mp3",
        "alt": "https://currenthalloween.stream.publicradio.org/currenthalloween.aac",
        "favicon": "",
        "cc": "US",
        "country": "United States",
        "tags": "",
        "codec": "MP3",
        "bitrate": 128,
        "hls": false
    }
],
  },
];
