'use strict';
// Genre families: group the directory's ~300 loose tags under a few parents so the picker is
// browsable, without losing the ability to filter by an individual tag.
//
//   terms  - what to search for when the user picks "All <family>". The directory can only match
//            one tag per query, so these run in parallel and the results are merged.
//   test   - decides which family a tag belongs to, and weeds out substring false positives
//            from the search ("pop" also returns "popular").
// A tag goes to the first family whose `test` matches, so order matters (Metal & Punk before Rock).
(() => {
  const FAMILIES = [
    { name: 'Metal & Punk', terms: ['metal', 'punk', 'hardcore'], test: /metal|punk|hardcore/i },
    { name: 'Rock', terms: ['rock', 'indie', 'alternative', 'grunge'], test: /\brock\b|rock ?n.?roll|rockabilly|\bindie\b|alternative|grunge|shoegaze|garage/i },
    { name: 'Pop', terms: ['pop', 'top 40', 'hits', 'adult contemporary'], test: /\bpop\b|j-?pop|k-?pop|top ?40|\bhits?\b|adult contemporary|\bchart/i },
    { name: 'Electronic & Dance', terms: ['electro', 'dance', 'house', 'techno', 'trance', 'ambient', 'chill', 'edm'], test: /electro|dance|\bhouse\b|techno|trance|\bedm\b|dubstep|drum ?(and|&|n) ?bass|\bdnb\b|ambient|chill|lounge|downtempo|synth/i },
    { name: 'Hip-Hop & R&B', terms: ['hip hop', 'hiphop', 'r&b', 'soul', 'rap'], test: /hip ?-?hop|\brap\b|\br ?(&|n|and) ?b\b|\brnb\b|\bsoul\b|funk|urban/i },
    { name: 'Jazz & Blues', terms: ['jazz', 'blues', 'swing'], test: /jazz|blues|\bswing\b|bebop/i },
    { name: 'Classical', terms: ['classical', 'opera', 'baroque', 'orchestra'], test: /classical|opera|baroque|orchestra|symphon|chamber/i },
    { name: 'Country & Folk', terms: ['country', 'folk', 'bluegrass', 'americana'], test: /country|folk|bluegrass|americana|\broots\b/i },
    { name: 'Oldies & Decades', terms: ['oldies', '60s', '70s', '80s', '90s', 'retro', 'disco'], test: /oldies|\b[5-9]0s\b|\b00s\b|retro|classic hits|golden|vintage|nostalgi|disco/i },
    { name: 'Latin & World', terms: ['latin', 'salsa', 'reggae', 'world', 'african', 'tropical'], test: /latin|salsa|reggae|world|african|arab|bollywood|flamenco|samba|bachata|tropic|cumbia|merengue|ethnic/i },
    { name: 'News & Talk', terms: ['news', 'talk', 'sports', 'politic', 'public'], test: /news|talk|sport|politic|public radio|\bnpr\b|comedy|information/i },
    { name: 'Religious', terms: ['christian', 'gospel', 'religio', 'worship', 'islam', 'catholic'], test: /christian|gospel|religio|worship|islam|catholic|bible|quran|praise|spiritual|church/i },
  ];
  const OTHER = 'Other genres';

  window.GENRES = {
    families: FAMILIES,
    OTHER,
    family: name => FAMILIES.find(f => f.name === name) || null,
    // tags: [{name, n}] -> Map(familyName -> tags[]), in display order, "Other genres" last.
    group(tags) {
      const map = new Map(FAMILIES.map(f => [f.name, []]));
      map.set(OTHER, []);
      for (const t of tags) {
        const f = FAMILIES.find(x => x.test.test(t.name));
        map.get(f ? f.name : OTHER).push(t);
      }
      return map;
    },
  };
})();
