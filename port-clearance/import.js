// Port Clearance: finds crew, passengers, stores, cargo, ship and voyage data in text taken from other documents.
//   PCImport.parse(text, fileName) -> { ship:{}, voy:{}, tables:[{kind, rows, unknown, warn, from}], notes:[] }
// It looks for table headers (Family name, Rank, Nationality, Date of birth, Name of article, Quantity ...) and for labelled values
// (Name of ship, IMO number, Port of arrival ...). Nothing is guessed silently: the caller shows what was found before anything is used.
(function () {
  var N = function (s) { return String(s == null ? "" : s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
  var C = function (s) { return N(s).replace(/['’`´]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim(); };   // for matching words: no punctuation, no numbering
  var pad = function (n) { return String(n).padStart(2, "0"); };

  // ---------- column words ----------
  var RAW = {
    person: {
      family: ["family name", "surname", "last name", "lastname", "family", "nazwisko"],
      given: ["given names", "given name", "first names", "first name", "firstname", "forenames", "forename", "christian names", "christian name", "imie", "imiona"],
      name: ["name", "full name", "crew name", "name of crew member", "name of crew", "name of person", "name and surname", "nazwisko i imie"],
      rank: ["rank or rating", "rank rating", "rank", "rating", "position", "function", "capacity", "duty", "stopien", "stanowisko"],
      nat: ["nationality", "citizenship", "nat"],
      dobpob: ["date and place of birth", "date place of birth", "birth date and place"],
      dob: ["date of birth", "birth date", "dob", "d o b", "born"],
      pob: ["place of birth", "birthplace", "pob"],
      gender: ["gender", "sex", "m f"],
      iddoc: ["nature and no of identity document", "nature and number of identity document", "nature and no of identity", "identity document", "id document", "travel document", "passport seamans book"],
      idType: ["nature of identity document", "type of identity or travel document", "type of identity travel document", "type of travel document", "type of identity document", "document type", "type of document", "id type"],
      idNo: ["serial number of identity or travel document", "serial number of identity document", "number of identity document", "identity document number", "document serial number", "serial number", "document number", "document no", "passport number", "passport no", "id number", "id no", "seamans book no", "book number", "book no"],
      idState: ["issuing state of identity or travel document", "issuing state of identity document", "issuing state", "issued by", "country of issue", "state of issue", "issuing country"],
      idExp: ["expiry date of identity or travel document", "date of expiry of identity or travel document", "expiry date of identity document", "expiry date", "date of expiry", "expiration date", "valid until", "valid to", "expires", "expiry"],
      effects: ["effects ineligible for relief from customs duties and taxes or subject to prohibitions or restrictions", "effects ineligible for relief", "effects to declare", "declared effects", "effects"],
      embark: ["port of embarkation", "embarkation port", "embarkation", "embarked at"],
      disembark: ["port of disembarkation", "disembarkation port", "disembarkation", "disembarked at"],
      visa: ["visa residence permit number", "visa number", "visa residence permit", "residence permit number", "visa"],
      transit: ["transit passenger", "transit"],
      num: ["no", "nr", "item", "number"]
    },
    stores: {
      article: ["name of article", "name of item", "articles", "article", "item", "stores", "description", "product", "material"],
      qty: ["quantity on board", "quantity", "qty", "amount"],
      unit: ["unit", "uom"],
      loc: ["location on board", "storage location", "stowage", "location", "place"],
      num: ["no", "nr", "number"]
    },
    cargo: {
      bl: ["b l number", "b l no", "b l nr", "bill of lading", "bol", "b l"],
      marks: ["marks and numbers", "marks numbers", "container number", "container no", "marks"],
      desc: ["number and kind of packages description of goods", "number and kind of packages", "kind of packages", "description of goods", "description of cargo", "cargo description", "goods description", "description", "goods", "cargo"],
      weight: ["gross weight", "gross mass", "weight", "mass"],
      meas: ["measurements", "measurement", "volume", "cbm"]
    },
    dg: {
      stow: ["stowage position", "stowage"], ref: ["reference number", "ref no", "reference"],
      marks: ["marks and numbers container id", "marks numbers container id", "container id"],
      un: ["un number", "un no", "un"], psn: ["proper shipping name", "psn"], cls: ["class subsidiary risk", "imo class", "hazard class", "class"],
      pg: ["packing group", "pg"], addl: ["additional information marine pollutant flash point", "additional information"],
      pkgs: ["number and kind of packages", "packages"], mass: ["mass kg or volume l", "mass"], ems: ["ems"]
    }
  };
  var DICT = {};
  Object.keys(RAW).forEach(function (kind) { DICT[kind] = {}; Object.keys(RAW[kind]).forEach(function (k) { DICT[kind][k] = RAW[kind][k].map(C); }); });

  function matchKey(cell, dict) {            // which column does this header cell mean? the longest matching phrase wins
    var c = C(cell); if (!c) return null;
    var p = " " + c + " ", best = null, len = 0;
    Object.keys(dict).forEach(function (k) {
      dict[k].forEach(function (syn) {
        if (!syn) return;
        var ok = syn.length <= 3 ? c === syn : (c === syn || p.indexOf(" " + syn + " ") >= 0);
        if (ok && syn.length > len) { best = k; len = syn.length; }
      });
    });
    return best;
  }
  function headerKeys(cells, kind) {
    var keys = [], seen = {};
    cells.forEach(function (c) { var k = c ? matchKey(c, DICT[kind]) : null; if (k && seen[k]) k = null; if (k) seen[k] = 1; keys.push(k); });
    return keys;
  }
  var count = function (keys, list) { return list.filter(function (k) { return keys.indexOf(k) >= 0; }).length; };
  function score(keys, kind) {               // how well does this header row look like a table of that kind? 0 = not at all
    var has = function (k) { return keys.indexOf(k) >= 0; };
    if (kind === "person") { var o = count(keys, ["given", "rank", "nat", "dob", "dobpob", "pob", "gender", "iddoc", "idType", "idNo", "idState", "idExp", "effects", "embark", "disembark", "visa"]); return (has("family") || has("name")) && o >= 1 ? 2 + o + (has("family") ? 1 : 0) : 0; }
    if (kind === "stores") return has("article") && has("qty") ? 4 + (has("loc") ? 1 : 0) : 0;
    if (kind === "cargo") { var n = count(keys, ["bl", "marks", "desc", "weight", "meas"]); return n >= 2 && (has("weight") || has("bl") || has("meas")) ? 2 + n : 0; }
    if (kind === "dg") return has("un") && (has("psn") || has("cls") || has("pg")) ? 4 + count(keys, ["psn", "cls", "pg", "mass", "ems"]) : 0;
    return 0;
  }

  // ---------- values ----------
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function mkIso(y, m, d) { if (y < 100) y += y > 40 ? 1900 : 2000; if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null; return y + "-" + pad(m) + "-" + pad(d); }
  function findDate(s) {                      // {iso, start, end} of the first date in the text, or null
    s = String(s == null ? "" : s); var m;
    if ((m = s.match(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/))) { var a = mkIso(+m[1], +m[2], +m[3]); if (a) return { iso: a, start: m.index, end: m.index + m[0].length }; }
    if ((m = s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/))) {
      var d = +m[1], mo = +m[2]; if (mo > 12 && d <= 12) { var t = d; d = mo; mo = t; }
      var b = mkIso(+m[3], mo, d); if (b) return { iso: b, start: m.index, end: m.index + m[0].length };
    }
    if ((m = s.match(/\b(\d{1,2})[ \-.]*([A-Za-z]{3,9})\.?[ \-.,]*(\d{4}|\d{2})\b/))) { var mn = MON[N(m[2]).slice(0, 4)] || MON[N(m[2]).slice(0, 3)]; if (mn) { var c = mkIso(+m[3], mn, +m[1]); if (c) return { iso: c, start: m.index, end: m.index + m[0].length }; } }
    if ((m = s.match(/\b([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})\b/))) { var mn2 = MON[N(m[1]).slice(0, 4)] || MON[N(m[1]).slice(0, 3)]; if (mn2) { var e = mkIso(+m[3], mn2, +m[2]); if (e) return { iso: e, start: m.index, end: m.index + m[0].length }; } }
    return null;
  }
  function dateOf(s, dateColumn) {             // a date column may also hold an Excel serial number
    s = String(s == null ? "" : s).trim(); if (!s) return "";
    var f = findDate(s); if (f) return f.iso;
    if (dateColumn && /^\d{5}(\.\d+)?$/.test(s)) { var n = Math.floor(+s); if (n > 10000 && n < 80000) { var d = new Date(Date.UTC(1899, 11, 30) + n * 864e5); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); } }
    return "";
  }
  function splitDobPob(s) {
    s = String(s || "").trim(); var f = findDate(s);
    if (!f) return { dob: "", pob: s };
    var rest = (s.slice(0, f.start) + " " + s.slice(f.end)).replace(/^[\s,;\/\-–]+|[\s,;\/\-–]+$/g, "").replace(/^(in|at)\s+/i, "").trim();
    return { dob: f.iso, pob: rest };
  }
  function gender(s) { var c = C(s); if (/^(m|male|man|masculine|mezczyzna)$/.test(c)) return "Male"; if (/^(f|female|woman|feminine|kobieta)$/.test(c)) return "Female"; return String(s || "").trim(); }
  function yesNo(s) { var c = C(s); if (/^(y|yes|tak|x|true)$/.test(c)) return "Yes"; if (/^(n|no|nie|false)$/.test(c)) return "No"; return String(s || "").trim(); }
  function idDoc(s) {                          // "Passport AB1234567" -> type + number
    s = String(s || "").trim(); if (!s) return { type: "", no: "" };
    var type = "", rest = s;
    if (/passport|paszport/i.test(s)) type = "Passport"; else if (/seaman|seafarer|ksiazeczka|sbook|\bs\.?b\.?\b/i.test(N(s))) type = "Seaman's book"; else if (/id card|identity card|national id|dowod/i.test(N(s))) type = "ID card";
    rest = s.replace(/passport|paszport|seaman'?s?\s*book|seafarer'?s?\s*(identity)?\s*(document|book)?|identity card|id card|national id|ksi[aą]żeczka|dow[oó]d( osobisty)?/ig, " ").replace(/\b(no|nr|number|numer|n°)\b\.?/ig, " ").replace(/[:#,;\/]+/g, " ").replace(/\s+/g, " ").trim();
    return { type: type, no: rest };
  }
  function splitName(s) {                      // one cell with the whole name: "KOWALSKI Jan", "Kowalski, Jan" or "Jan Kowalski"
    s = String(s || "").trim(); if (!s) return { family: "", given: "", guess: false };
    if (s.indexOf(",") > 0) { var a = s.split(","); return { family: a[0].trim(), given: a.slice(1).join(" ").trim(), guess: false }; }
    var w = s.split(/\s+/); if (w.length === 1) return { family: s, given: "", guess: true };
    var up = function (x) { return x.length > 1 && x === x.toUpperCase() && x !== x.toLowerCase(); };
    var ups = w.filter(up), others = w.filter(function (x) { return !up(x); });
    if (ups.length && others.length) return { family: ups.join(" "), given: others.join(" "), guess: false };
    return { family: w[0], given: w.slice(1).join(" "), guess: true };                // first word taken as the family name: the preview shows it
  }
  var clean = function (v) { return String(v == null ? "" : v).replace(/[.…_]{3,}/g, " ").replace(/\s+/g, " ").trim(); };

  // ---------- tables ----------
  function toLines(text) { return String(text || "").split(/\r?\n/).map(function (l) { return l.split("\t").map(function (c) { return c.trim(); }); }); }
  var isBlank = function (cells) { return !cells.some(function (c) { return c !== ""; }); };
  var filled = function (cells) { return cells.filter(function (c) { return c !== ""; }); };

  function rowObject(cells, keys) {
    if (keys[0] == null || keys[0] === "num") { /* the numbering column is part of the table */ }
    else if (/^\d{1,3}[.)]?$/.test(cells[0]) && cells.length >= 2) cells = cells.slice(1);      // a row number in front of a column that holds a name or an article
    var o = {}; keys.forEach(function (k, i) { if (k && k !== "num" && cells[i] != null && cells[i] !== "") o[k] = clean(cells[i]); });
    return o;
  }
  function person(o, kind, hint) {
    var p = { family: o.family || "", given: o.given || "" }, warn = [];
    if (!p.family && o.name) { var s = splitName(o.name); p.family = s.family; p.given = s.given; if (s.guess) warn.push("name split guessed"); }
    if (o.rank) p.rank = o.rank; if (o.nat) p.nat = o.nat;
    if (o.dobpob) { var d = splitDobPob(o.dobpob); if (d.dob) p.dob = d.dob; if (d.pob) p.pob = d.pob; }
    if (o.dob) { var dd = dateOf(o.dob, true); if (dd) p.dob = dd; else warn.push("date of birth not understood: " + o.dob); }
    if (o.pob) p.pob = o.pob;
    if (o.gender) p.gender = gender(o.gender);
    if (o.iddoc) { var id = idDoc(o.iddoc); if (id.type) p.idType = id.type; if (id.no) p.idNo = id.no; }
    if (o.idType) { var t = idDoc(o.idType); p.idType = t.type || o.idType; if (t.no) p.idNo = p.idNo || t.no; }
    if (o.idNo) p.idNo = o.idNo; if (o.idState) p.idState = o.idState;
    if (o.idExp) { var ex = dateOf(o.idExp, true); if (ex) p.idExp = ex; }
    if (o.effects) p.effects = o.effects;
    if (kind === "pax") { if (o.embark) p.embark = o.embark; if (o.disembark) p.disembark = o.disembark; if (o.visa) p.visa = o.visa; if (o.transit) p.transit = yesNo(o.transit); }
    return { rec: p, warn: warn };
  }
  var STOP = /^(signature|date and signature|date signature|total|page|notes?|remarks?|master|name of master)\b/;
  function collect(lines, i, keys, kind, minKey) {   // data rows under the header at line i; returns {rows, end}
    var rows = [], j = i + 1, empties = 0, hdrKeysSig = keys.join("|");
    for (; j < lines.length; j++) {
      var cells = lines[j];
      if (isBlank(cells)) { if (++empties > 40) break; continue; }
      var f = filled(cells);
      if (headerKeys(cells, kind).join("|") === hdrKeysSig) continue;                                   // a header repeated on the next page
      var best = 0; ["person", "stores", "cargo", "dg"].forEach(function (k) { best = Math.max(best, score(headerKeys(cells, k), k)); });
      if (best >= 4 && kind !== "person") break;                                                        // the next table starts
      if (kind === "person" && best >= 5 && score(headerKeys(cells, "person"), "person") === 0) break;
      if (f.length === 1 && (f[0].length > 30 || STOP.test(C(f[0])))) { if (rows.length) break; else continue; }
      if (f.length === 1 && STOP.test(C(f[0]))) break;
      empties = 0;
      var o = rowObject(cells, keys);
      if (!o[minKey[0]] && !(minKey[1] && o[minKey[1]])) continue;
      rows.push(o);
    }
    return { rows: rows, end: j };
  }
  function findTables(lines, fileName) {
    var tables = [], i = 0;
    while (i < lines.length) {
      var cells = lines[i];
      if (filled(cells).length < 2) { i++; continue; }
      var bestKind = null, bestScore = 0, bestKeys = null;
      ["person", "stores", "cargo", "dg"].forEach(function (k) { var ks = headerKeys(cells, k), sc = score(ks, k); if (sc > bestScore) { bestScore = sc; bestKind = k; bestKeys = ks; } });
      if (!bestKind) { i++; continue; }
      var min = { person: ["family", "name"], stores: ["article"], cargo: ["desc", "marks"], dg: ["un", "psn"] }[bestKind];
      var got = collect(lines, i, bestKeys, bestKind, min);
      if (got.rows.length) {
        var ctx = lines.slice(Math.max(0, i - 10), i + 1).map(function (l) { return l.join(" "); }).join(" ").toLowerCase() + " " + N(fileName || "");
        var kind = bestKind;
        if (bestKind === "person") {
          var hasRank = bestKeys.indexOf("rank") >= 0, paxCols = count(bestKeys, ["embark", "disembark", "visa", "transit"]);
          var pc = (ctx.match(/passenger/g) || []).length, cc = (ctx.match(/\bcrew|seafarer|seaman/g) || []).length;
          kind = paxCols ? "pax" : hasRank ? "crew" : pc > cc ? "pax" : cc > pc ? "crew" : "person";
        }
        var unknown = []; cells.forEach(function (c, ix) { if (c && !bestKeys[ix] && !/^\d+\.?$/.test(c) && C(c)) unknown.push(c); });
        var warn = [], out;
        if (bestKind === "person") out = got.rows.map(function (o) { var r = person(o, kind, ctx); r.warn.forEach(function (w) { if (warn.indexOf(w) < 0) warn.push(w); }); return r.rec; }).filter(function (r) { return r.family || r.given; });
        else if (bestKind === "stores") out = got.rows.map(function (o) { return { article: o.article || "", qty: [o.qty, o.unit].filter(Boolean).join(" "), loc: o.loc || "" }; });
        else out = got.rows;
        if (out.length) tables.push({ kind: kind, rows: out, unknown: unknown, warn: warn, from: fileName || "" });
      }
      i = Math.max(i + 1, got.end);
    }
    return tables;
  }

  // ---------- labelled values (ship, voyage) ----------
  var LABELS = {
    "ship.name": ["name of ship or inland navigation vessel", "name of ship", "name of vessel", "ship name", "vessel name", "name of the ship", "name and type of ship"],
    "ship.type": ["type of ship", "ship type", "type of vessel"],
    "ship.imo": ["imo number", "imo no", "registration imo number", "registration imo no", "imo"],
    "ship.callSign": ["call sign", "callsign"],
    "ship.flag": ["flag state of ship", "flag state", "flag"],
    "ship.master": ["name of master", "masters name", "master name", "name of captain", "captain"],
    "ship.gt": ["gross tonnage"], "ship.nt": ["net tonnage"],
    "ship.registry": ["certificate of registry port date number", "certificate of registry"],
    "voy.portA": ["port of arrival", "arrival at", "arrival port"], "voy.portD": ["port of departure", "departure from", "departure port"],
    "voy.port": ["submitted at the port of", "port of arrival departure", "port of call"],
    "voy.dateA": ["date and time of arrival", "date of arrival", "arrival date", "eta"], "voy.dateD": ["date and time of departure", "date of departure", "departure date", "etd"],
    "voy.lastPort": ["last port of call"], "voy.nextPort": ["next port of call", "next port", "port of destination", "destination"],
    "voy.voyageNo": ["voyage number", "voyage no", "voyage nr", "voy no"],
    "voy.agent": ["name and contact details of ships agent", "ships agent", "name of agent", "shipping agent", "agent"]
  };
  var LAB = {}; Object.keys(LABELS).forEach(function (k) { LAB[k] = LABELS[k].map(C); });
  var ALLLAB = []; Object.keys(LAB).forEach(function (k) { LAB[k].forEach(function (l) { ALLLAB.push(l); }); });
  var numbered = function (s) { return /^\s*\(?\d+(\.\d+)*[.)]\s*[A-Za-z]/.test(s) || /^\s*\d+(\.\d+)+\s+[A-Za-z]/.test(s); };             // "5. Last port of call": the printed label of another box
  var looksLikeLabel = function (cell) { var c = C(cell); return !!c && (numbered(cell) || ALLLAB.some(function (l) { return c === l || c.indexOf(l + " ") === 0; })); };
  var plausible = function (v) { return !!v && !/^[^A-Za-z0-9]/.test(v) && !numbered(v) && !/^\d{1,2}\.?$/.test(v); };   // not a stray bit of punctuation, not another label, not an item number

  function cutAtLabel(v) {                      // "Rotterdam   Date of departure: 05 Nov" -> "Rotterdam"
    var cut = v.length;
    ALLLAB.forEach(function (l) {
      if (!l || l.length < 5) return;
      var m = new RegExp("(^|[^A-Za-z0-9])" + l.split(" ").join("[^A-Za-z0-9]*") + "([^A-Za-z0-9]|$)", "i").exec(v);
      if (m && m.index > 0 && m.index < cut) cut = m.index;
    });
    return v.slice(0, cut);
  }
  function labelled(lines) {
    var out = {};
    Object.keys(LAB).forEach(function (key) {
      var found = null;
      for (var i = 0; i < lines.length && !found; i++) {
        var cells = lines[i];
        for (var j = 0; j < cells.length && !found; j++) {
          var raw = cells[j]; if (!raw) continue; var c = C(raw), hit = null;
          LAB[key].forEach(function (l) { if (!hit && l && (c === l || c.indexOf(l + " ") === 0 || (" " + c + " ").indexOf(" " + l + " ") >= 0 && c.length < l.length + 40)) hit = l; });
          if (!hit) continue;
          var v = "";
          var colon = raw.indexOf(":"); if (colon >= 0 && colon < raw.length - 1) v = raw.slice(colon + 1);
          if (!clean(v)) { var re = new RegExp(hit.split(" ").join("[^A-Za-z0-9]*") , "i"); var m = N(raw).match(re); if (m) { var tail = raw.slice(m.index + m[0].length).replace(/^[\s.…_:\-–]+/, ""); if (clean(tail) && C(tail) !== c) v = tail; } }
          if (!plausible(clean(v))) v = "";
          if (!clean(v)) for (var k = j + 1; k < cells.length; k++) if (clean(cells[k])) { if (!looksLikeLabel(cells[k])) v = cells[k]; break; }       // the next filled cell, unless it is another label
          if (!clean(v) && lines[i + 1]) { var nx = lines[i + 1]; if (clean(nx[j]) && !looksLikeLabel(nx[j])) v = nx[j]; else for (var q = 0; q < nx.length; q++) if (clean(nx[q]) && !looksLikeLabel(nx[q])) { v = nx[q]; break; } }
          v = clean(cutAtLabel(clean(v))); if (plausible(v) && v.length < 160) found = { value: v, cell: raw };
        }
      }
      if (found) out[key] = found;
    });
    return out;
  }
  function shipVoyage(lines, text) {
    var L = labelled(lines), ship = {}, voy = {}, v;
    var take = function (obj, k, key, fn) { if (L[key]) { var x = fn ? fn(L[key].value) : L[key].value; if (x) obj[k] = x; } };
    take(ship, "name", "ship.name", function (s) { var a = s.split(/\s*[\/|]\s*|\s{3,}/); return a[0].trim(); });
    if (L["ship.name"]) { var a2 = L["ship.name"].value.split(/\s*[\/|]\s*/); if (a2.length > 1 && /name and type/.test(C(L["ship.name"].cell))) ship.type = a2.slice(1).join(" / ").trim(); }
    take(ship, "type", "ship.type");
    var imo = (L["ship.imo"] && L["ship.imo"].value.match(/\b\d{7}\b/)) || String(text).match(/\bIMO(?:\s*(?:no|number|nr)\.?)?\s*[:\-]?\s*(\d{7})\b/i);
    if (imo) ship.imo = imo[1] || imo[0];
    take(ship, "callSign", "ship.callSign"); take(ship, "flag", "ship.flag"); take(ship, "master", "ship.master"); take(ship, "registry", "ship.registry");
    take(ship, "gt", "ship.gt", function (s) { var m = s.match(/[\d.,]+/); return m ? m[0] : ""; }); take(ship, "nt", "ship.nt", function (s) { var m = s.match(/[\d.,]+/); return m ? m[0] : ""; });
    if (L["voy.portA"]) { voy.mode = "arrival"; voy.port = L["voy.portA"].value; } else if (L["voy.portD"]) { voy.mode = "departure"; voy.port = L["voy.portD"].value; } else take(voy, "port", "voy.port");
    var dA = L["voy.dateA"] ? dateOf(L["voy.dateA"].value, true) : "", dD = L["voy.dateD"] ? dateOf(L["voy.dateD"].value, true) : "";
    if (voy.mode === "departure") { voy.date = dD || dA; } else { voy.date = dA || dD; }
    if (!voy.mode && (dA || dD)) voy.mode = dA ? "arrival" : "departure";
    if (!voy.date) delete voy.date;
    take(voy, "lastPort", "voy.lastPort"); take(voy, "nextPort", "voy.nextPort"); take(voy, "voyageNo", "voy.voyageNo"); take(voy, "agent", "voy.agent");
    return { ship: ship, voy: voy };
  }

  window.PCImport = {
    parse: function (text, fileName) {
      var lines = toLines(text), sv = shipVoyage(lines, text);
      return { ship: sv.ship, voy: sv.voy, tables: findTables(lines, fileName), from: fileName || "" };
    },
    merge: function (list) {                   // several documents -> one result; the first value found wins
      var r = { ship: {}, voy: {}, tables: [], sources: [] };
      list.forEach(function (x) {
        r.sources.push(x.from);
        Object.keys(x.ship).forEach(function (k) { if (r.ship[k] == null) r.ship[k] = x.ship[k]; });
        Object.keys(x.voy).forEach(function (k) { if (r.voy[k] == null) r.voy[k] = x.voy[k]; });
        x.tables.forEach(function (t) { r.tables.push(t); });
      });
      return r;
    },
    _test: { findDate: findDate, splitDobPob: splitDobPob, idDoc: idDoc, splitName: splitName, C: C }
  };
})();
