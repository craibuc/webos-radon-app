// ISO 3166-1 alpha-2 country code -> region, used to group the country picker (North America first).
// Exposes window.regionOf(code) -> region name ('Other' for anything not listed, e.g. territories) and
// window.REGION_ORDER (display order). Add codes to the lists below when the directory introduces new countries.
(() => {
  const R = {
    'North America': 'US CA MX GL BM PM',
    'Europe': 'AL AD AT BY BE BA BG HR CY CZ DK EE FO FI FR DE GI GR GG VA HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB AX',
    'Asia': 'AF BD BT BN KH CN HK IN ID JP KZ KG LA MO MY MV MN MM NP KP PK PH SG KR LK TW TJ TH TL TM UZ VN',
    'Middle East': 'AE AM AZ BH GE IR IQ IL JO KW LB OM PS QA SA SY TR YE',
    'South America': 'AR BO BR CL CO EC FK GF GY PY PE SR UY VE',
    'Central America & Caribbean': 'BZ CR SV GT HN NI PA AG BS BB CU DM DO GD HT JM KN LC VC TT AW CW SX BQ KY TC VG VI PR AI MS GP MQ BL MF',
    'Africa': 'DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW',
    'Oceania': 'AU NZ FJ PG WS TO VU SB KI FM MH NR PW PF NC GU AS MP CK NU TK TV WF',
  };
  const of = {};
  for (const region of Object.keys(R)) for (const c of R[region].split(' ')) of[c] = region;
  window.REGION_ORDER = Object.keys(R).concat('Other'); // display order, North America first
  window.regionOf = code => of[code] || 'Other';
})();
