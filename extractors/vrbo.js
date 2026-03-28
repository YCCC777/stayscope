// ============================================================
// StayScope - VRBO Extractor
// Depends on extractors/base.js
// VRBO (Vacation Rentals by Owner) - Expedia Group
// NOTE: VRBO uses Expedia custom React framework (NOT Next.js), no __NEXT_DATA__
// ============================================================
'use strict';

// ---- Shared coord regex ----
// \\? allows for JS-escaped quote format (\"key\") found in inline script textContent
const _VRBO_COORD_RE     = /\\?"lat(?:itude)?\\?"\s*:\s*(-?\d{1,3}\.\d{3,})\s*,\s*\\?"l(?:ng|on(?:gitude)?)\\?"\s*:\s*(-?\d{1,3}\.\d{3,})/i;
const _VRBO_COORD_RE_REV = /\\?"l(?:ng|on(?:gitude)?)\\?"\s*:\s*(-?\d{1,3}\.\d{3,})\s*,\s*\\?"lat(?:itude)?\\?"\s*:\s*(-?\d{1,3}\.\d{3,})/i;
const _VRBO_COUNTRY_RE   = /\\?"(?:countryCode|country_code|addressCountry|countryIso)\\?"\s*:\s*\\?"([A-Z]{2})\\?"/i;
// 'name' removed — too generic (matches browser/device info like {"name":"chrome"})
// Priority order: headlineText (most reliable), propertyName, unitName, listingTitle, headline
const _VRBO_NAME_RE      = /\\?"(?:headlineText|propertyName|unitName|listingTitle|headline)\\?"\s*:\s*\\?"([^"\\]{4,150})/;

function _parseCoords(str) {
  var m = str.match(_VRBO_COORD_RE);
  if (m) {
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (isValidCoord(lat, lng)) return { lat: lat, lng: lng };
  }
  m = str.match(_VRBO_COORD_RE_REV);
  if (m) {
    var lng2 = parseFloat(m[1]), lat2 = parseFloat(m[2]);
    if (isValidCoord(lat2, lng2)) return { lat: lat2, lng: lng2 };
  }
  // Non-adjacent fallback: lat and lng may have other fields between them
  var latM = str.match(/\\?"lat(?:itude)?\\?"\s*:\s*(-?\d{1,3}\.\d{4,})/i);
  var lngM = str.match(/\\?"l(?:ng|on(?:gitude)?)\\?"\s*:\s*(-?\d{1,3}\.\d{4,})/i);
  if (latM && lngM) {
    var lat3 = parseFloat(latM[1]), lng3 = parseFloat(lngM[1]);
    if (isValidCoord(lat3, lng3)) return { lat: lat3, lng: lng3 };
  }
  return null;
}

// ---- Strategy 2: Scan Expedia/VRBO window globals (MAIN world) ----
function extractFromVrboGlobals() {
  try {
    var candidates = [
      window.__INITIAL_STATE__,
      window.__APOLLO_STATE__,
      window.__VRBO_INITIAL_DATA__,
      window.__EXPEDIA_INITIAL_STATE__,
      window.wrapp,
      window.__listing,
      window.propertyData,
      window.__RENDERING_CONTEXT__,
      window.initialRenderingContext,
      window.__SSR_DATA__,
    ].filter(Boolean);
    for (var i = 0; i < candidates.length; i++) {
      try {
        var str = JSON.stringify(candidates[i]);
        var coords = _parseCoords(str);
        if (!coords) continue;
        var cm = str.match(_VRBO_COUNTRY_RE);
        var nm = str.match(_VRBO_NAME_RE);
        return { lat: coords.lat, lng: coords.lng, name: nm ? nm[1] : null, country: cm ? cm[1] : null, city: null, strategy: 'vrbo-globals' };
      } catch (e2) { continue; }
    }
  } catch (e) {}
  return null;
}

// Helper: extract country and name near a position in string (2000 char window)
function _extractNearby(str, pos) {
  var start = Math.max(0, pos - 1000);
  var end   = Math.min(str.length, pos + 1000);
  var slice = str.slice(start, end);
  var cm = slice.match(_VRBO_COUNTRY_RE);
  var nm = slice.match(_VRBO_NAME_RE);
  // Widen to 5000 if not found
  if (!cm || !nm) {
    start = Math.max(0, pos - 2500);
    end   = Math.min(str.length, pos + 2500);
    slice = str.slice(start, end);
    if (!cm) cm = slice.match(_VRBO_COUNTRY_RE);
    if (!nm) nm = slice.match(_VRBO_NAME_RE);
  }
  return { country: cm ? cm[1] : null, name: nm ? nm[1] : null };
}
// VRBO sets Apollo state as: window.__APOLLO_STATE__ = JSON.parse("{...escaped JSON...}")
// Apollo State contains multiple lat/lng (city center, region, property) — we must find
// the property-level coordinates, not the city/region ones (~1 mile accuracy difference).
function extractFromVrboApolloState() {
  try {
    var scripts = document.querySelectorAll('script:not([src])');
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent;
      if (!text || text.indexOf('__APOLLO_STATE__') === -1) continue;
      var marker = 'JSON.parse("';
      var si = text.indexOf(marker);
      if (si === -1) continue;
      si += marker.length;
      var ei = text.lastIndexOf('");');
      if (ei <= si) ei = text.lastIndexOf('")');
      if (ei <= si) continue;
      var jsonStr = text.slice(si, ei);
      var cleanStr = null;
      try {
        var unescaped = JSON.parse('"' + jsonStr + '"');
        var parsed = JSON.parse(unescaped);
        cleanStr = JSON.stringify(parsed);
      } catch (e) {
        cleanStr = null;
      }
      var searchStr = cleanStr || jsonStr;

      // For name: scan full string with known keys
      var nm = searchStr.match(_VRBO_NAME_RE);

      // Priority: search property-level location blocks before falling back to full scan.
      // Apollo State key format: "PropertyLocation:xxx", "UnitLocation:xxx", etc.
      // These blocks contain the actual property coords, not city/region centers.
      var priorityRe = /"(?:PropertyLocation|UnitLocation|mapCoordinates|listingGeoCode|propertyCoordinates|geoCode|coordinates|PropertyMapMarker)[^"]*"\s*:\s*\{([^{}]{10,400})\}/gi;
      var pm;
      while ((pm = priorityRe.exec(searchStr)) !== null) {
        var coords = _parseCoords(pm[1]);
        if (coords) {
          // Find country near the matched block position, not from full string
          var nearby = _extractNearby(searchStr, pm.index);
          return { lat: coords.lat, lng: coords.lng, name: nm ? nm[1] : nearby.name, country: nearby.country, city: null, strategy: 'vrbo-apollo-priority' };
        }
      }

      // Fallback: full string scan — find coords position, then extract country nearby
      var coordMatch = searchStr.match(_VRBO_COORD_RE) || searchStr.match(_VRBO_COORD_RE_REV);
      if (!coordMatch) {
        var latM2 = searchStr.match(/\\?"lat(?:itude)?\\?"\s*:\s*(-?\d{1,3}\.\d{4,})/i);
        if (latM2) coordMatch = latM2;
      }
      if (coordMatch) {
        var coords2 = _parseCoords(searchStr);
        if (coords2) {
          var pos = searchStr.indexOf(coordMatch[0]);
          var nearby2 = _extractNearby(searchStr, pos);
          return { lat: coords2.lat, lng: coords2.lng, name: nm ? nm[1] : nearby2.name, country: nearby2.country, city: null, strategy: 'vrbo-apollo-fallback' };
        }
      }
    }
  } catch (e) {}
  return null;
}

// ---- Strategy 3: JSON data islands (<script type="application/json">) ----
function extractFromVrboJsonIslands() {
  try {
    var selectors = ['script[type="application/json"]','script[id*="listing"]','script[id*="property"]','script[id*="initial"]','script[id*="data"]','script[id*="ssr"]'];
    for (var s = 0; s < selectors.length; s++) {
      var els = document.querySelectorAll(selectors[s]);
      for (var e = 0; e < els.length; e++) {
        var text = els[e].textContent;
        if (!text || text.length < 20 || text.length > 5000000) continue;
        if (text.indexOf('lat') === -1 && text.indexOf('latitude') === -1) continue;
        try {
          var str = JSON.stringify(JSON.parse(text));
          var coords = _parseCoords(str);
          if (!coords) continue;
          var cm = str.match(_VRBO_COUNTRY_RE);
          var nm = str.match(_VRBO_NAME_RE);
          return { lat: coords.lat, lng: coords.lng, name: nm ? nm[1] : null, country: cm ? cm[1] : null, city: null, strategy: 'vrbo-json-island' };
        } catch (ex) { continue; }
      }
    }
  } catch (e) {}
  return null;
}

// ---- Strategy 4: Scan all inline scripts ----
function extractFromVrboInline() {
  try {
    var scripts = document.querySelectorAll('script:not([src])');
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent;
      if (!text || text.length > 6000000 || text.length < 50) continue;
      if (text.indexOf('lat') === -1 && text.indexOf('latitude') === -1) continue;
      var coords = _parseCoords(text);
      if (coords) {
        var cm = text.match(_VRBO_COUNTRY_RE);
        var nm = text.match(_VRBO_NAME_RE);
        return { lat: coords.lat, lng: coords.lng, name: nm ? nm[1] : null, country: cm ? cm[1] : null, city: null, strategy: 'vrbo-inline' };
      }
    }
  } catch (e) {}
  return null;
}

// ---- Strategy 5: meta tags fallback ----
function extractFromVrboMeta() {
  try {
    var latEl = document.querySelector('meta[property="place:location:latitude"],meta[name="geo.position"]');
    var lngEl = document.querySelector('meta[property="place:location:longitude"]');
    if (latEl && lngEl) {
      var lat = parseFloat(latEl.getAttribute('content'));
      var lng = parseFloat(lngEl.getAttribute('content'));
      if (isValidCoord(lat, lng)) return { lat: lat, lng: lng, name: null, country: null, city: null, strategy: 'vrbo-meta' };
    }
    if (latEl && latEl.getAttribute('name') === 'geo.position') {
      var parts = latEl.getAttribute('content').split(';');
      if (parts.length === 2) {
        var lat2 = parseFloat(parts[0]), lng2 = parseFloat(parts[1]);
        if (isValidCoord(lat2, lng2)) return { lat: lat2, lng: lng2, name: null, country: null, city: null, strategy: 'vrbo-meta-geo' };
      }
    }
  } catch (e) {}
  return null;
}

// ---- Price extraction ----
function extractVrboPrice() {
  try {
    var scripts = document.querySelectorAll('script:not([src])');
    for (var i = 0; i < scripts.length; i++) {
      var t = scripts[i].textContent;
      if (!t || t.length > 3000000) continue;
      if (t.indexOf('price') === -1 && t.indexOf('rate') === -1 && t.indexOf('Rate') === -1) continue;
      var pm = t.match(/"averageNightlyRate"\s*:\s*\{[^}]{0,300}"formatted"\s*:\s*"([^"]+)"/i)
            || t.match(/"perNightRate"\s*:\s*"([^"]+)"/i)
            || t.match(/"nightlyRate"\s*:\s*"([^"]+)"/i)
            || t.match(/"displayPrice"\s*:\s*"([\$\u20ac\u00a3\u00a5\u20a9\u0e3f\u20ab][^"]{1,20})"/i);
      if (pm) {
        var display = pm[1].trim();
        var amount = parseFloat(display.replace(/[^\d.]/g, ''));
        if (amount > 0 && amount < 1e7) return { amount: amount, display: display, currency: detectCurrency(display), perNight: true };
      }
    }
    var el = document.querySelector('[data-testid="pdp-nightly-price"],[data-testid="rate-info-text"],[class*="nightly-rate"],[class*="per-night"]');
    if (el) {
      var disp = el.textContent.trim().split('\n')[0].trim();
      var amt = parseFloat(disp.replace(/[^\d.]/g, ''));
      if (amt > 0 && amt < 1e7) return { amount: amt, display: disp, currency: detectCurrency(disp), perNight: true };
    }
  } catch (e) {}
  return null;
}

function extractVrboDates() { return extractDatesFromUrl(location.search); }

function extractVrboExpediaId() {
  try {
    var id = new URLSearchParams(location.search).get('expediaPropertyId');
    if (id && /^\d+$/.test(id)) return id;
  } catch (e) {}
  return null;
}

// ---- DOM enrichment fallback ----
// Called when we have coords but name/country are null
function _enrichFromDOM() {
  var name = null, country = null;

  // Name: VRBO always renders the property title in h1 (or a prominent heading)
  try {
    var selectors = [
      '[data-stid*="headline"]',
      'h1[class*="headline"]',
      'h1[class*="title"]',
      'h1[class*="Headline"]',
      'h1[class*="Title"]',
      'h1'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) {
        var txt = el.textContent.trim().replace(/\s+/g, ' ');
        if (txt.length >= 4 && txt.length <= 200) { name = txt; break; }
      }
    }
  } catch (e) {}

  // Country: try page <title> — format is often "... | City, Country | Vrbo"
  // Also try meta og:description, breadcrumbs
  try {
    var _CTRY_MAP = {
      'united kingdom':'GB','england':'GB','scotland':'GB','wales':'GB',
      'united states':'US','france':'FR','germany':'DE','spain':'ES',
      'italy':'IT','portugal':'PT','netherlands':'NL','australia':'AU',
      'japan':'JP','thailand':'TH','indonesia':'ID','malaysia':'MY',
      'taiwan':'TW','south korea':'KR','mexico':'MX','brazil':'BR',
      'canada':'CA','new zealand':'NZ','ireland':'IE','greece':'GR',
      'croatia':'HR','austria':'AT','switzerland':'CH','belgium':'BE',
      'denmark':'DK','sweden':'SE','norway':'NO','finland':'FI','poland':'PL',
      'czech republic':'CZ','hungary':'HU','romania':'RO','vietnam':'VN',
      'singapore':'SG'
    };

    // VRBO breadcrumb usually has city/country links
    var bcEls = document.querySelectorAll('[data-stid*="breadcrumb"] a, nav[aria-label*="read"] a, [class*="breadcrumb"] a');
    for (var b = bcEls.length - 1; b >= 0; b--) {
      var bc = bcEls[b].textContent.trim().toLowerCase();
      if (_CTRY_MAP[bc]) { country = _CTRY_MAP[bc]; break; }
    }

    if (!country) {
      // Try page title: "5BR Cottage | Edinburgh, Scotland, United Kingdom | Vrbo"
      var titleText = (document.title || '').toLowerCase();
      for (var key in _CTRY_MAP) {
        if (titleText.indexOf(key) !== -1) { country = _CTRY_MAP[key]; break; }
      }
    }

    if (!country) {
      // Try meta description
      var metaDesc = document.querySelector('meta[name="description"],meta[property="og:description"]');
      if (metaDesc) {
        var descText = (metaDesc.getAttribute('content') || '').toLowerCase();
        for (var key2 in _CTRY_MAP) {
          if (descText.indexOf(key2) !== -1) { country = _CTRY_MAP[key2]; break; }
        }
      }
    }

    if (!country) {
      // Best source: JSON-LD addressCountry — supports both 2-letter (GB) and 3-letter (GBR)
      var _ISO3 = {
        'GBR':'GB','USA':'US','FRA':'FR','DEU':'DE','ESP':'ES','ITA':'IT',
        'PRT':'PT','NLD':'NL','AUS':'AU','JPN':'JP','THA':'TH','IDN':'ID',
        'MYS':'MY','TWN':'TW','KOR':'KR','MEX':'MX','BRA':'BR','CAN':'CA',
        'NZL':'NZ','IRL':'IE','GRC':'GR','HRV':'HR','AUT':'AT','CHE':'CH',
        'BEL':'BE','DNK':'DK','SWE':'SE','NOR':'NO','FIN':'FI','POL':'PL',
        'CZE':'CZ','HUN':'HU','ROU':'RO','VNM':'VN','SGP':'SG','IND':'IN',
        'CHN':'CN','HKG':'HK','MNL':'PH','PHL':'PH','TUR':'TR','ARE':'AE',
        'MAR':'MA','ZAF':'ZA','ARG':'AR','CHL':'CL','COL':'CO','PER':'PE'
      };
      try {
        var jldEls = document.querySelectorAll('script[type="application/ld+json"]');
        for (var jl = 0; jl < jldEls.length && !country; jl++) {
          var jlText = jldEls[jl].textContent || '';
          // 2-letter code first
          var cc2 = jlText.match(/"addressCountry"\s*:\s*"([A-Z]{2})"/i);
          if (cc2) { country = cc2[1].toUpperCase(); break; }
          // 3-letter ISO code → convert
          var cc3 = jlText.match(/"addressCountry"\s*:\s*"([A-Z]{3})"/i);
          if (cc3 && _ISO3[cc3[1].toUpperCase()]) { country = _ISO3[cc3[1].toUpperCase()]; break; }
        }
      } catch (e) {}
    }
  } catch (e) {}

  return { name: name, country: country };
}

// ---- Main extract function ----
window.__siteExtractFn = function extractVrbo() {
  var dates = extractVrboDates();
  var price = extractVrboPrice();
  var expediaPropertyId = extractVrboExpediaId();
  var url = location.href;

  // Helper: merge DOM fallback for missing name/country
  function _finish(r) {
    if (r && (!r.name || !r.country)) {
      var dom = _enrichFromDOM();
      if (!r.name && dom.name) r.name = dom.name;
      if (!r.country && dom.country) r.country = dom.country;
      // Last resort: derive country from coordinates (base.js bounding boxes)
      if (!r.country && isValidCoord(r.lat, r.lng)) {
        r.country = detectCountryFromCoords(r.lat, r.lng) || null;
      }
    }
    return Object.assign({}, r, { source: 'vrbo', price: price, expediaPropertyId: expediaPropertyId }, dates);
  }

  // 1. JSON-LD (most reliable, SEO standard)
  var jsonld = extractFromJsonLd();
  if (jsonld && isValidCoord(jsonld.lat, jsonld.lng)) return _finish(jsonld);

  // 2. Expedia/VRBO globals (MAIN world)
  var globals = extractFromVrboGlobals();
  if (globals) return _finish(globals);

  // 2b. Apollo state from inline script (VRBO primary data store)
  var apollo = extractFromVrboApolloState();
  if (apollo) return _finish(apollo);

  // 3. JSON data islands
  var island = extractFromVrboJsonIslands();
  if (island) return _finish(island);

  // 4. base.js generic inline scan
  var baseInline = extractFromInlineScripts();
  if (baseInline && isValidCoord(baseInline.lat, baseInline.lng)) return _finish(baseInline);

  // 5. VRBO-specific inline scan
  var vrboInline = extractFromVrboInline();
  if (vrboInline) return _finish(vrboInline);

  // 6. meta tags (last resort)
  var meta = extractFromVrboMeta();
  if (meta) return _finish(meta);

  return null;
};