// Reads text out of documents, in the browser, without sending anything anywhere.
//   DocRead.read(file) -> Promise<string>   rows separated by newlines, table cells separated by tabs
// Supports .docx / .doc (paragraphs and tables), .xlsx / .xlsm / .xls (all sheets), .ods / .odt / .rtf, .csv / .tsv / .txt and .pdf with a text layer.
// Also reads the old binary .doc / .xls, plus .ods / .odt / .rtf. Scanned PDFs (pictures) cannot be read.
(function () {
  if (window.DocRead) return;
  var base = (document.currentScript && document.currentScript.src || "").replace(/assets\/docread\.js.*$/, "");

  function decodeText(buf) {
    var u = new Uint8Array(buf);
    if (u[0] === 0xFF && u[1] === 0xFE) return new TextDecoder("utf-16le").decode(buf);
    if (u[0] === 0xFE && u[1] === 0xFF) return new TextDecoder("utf-16be").decode(buf);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("windows-1252").decode(buf); }
  }
  function unzip(buf) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("This browser cannot open zipped documents. Use a current Edge, Chrome or Safari."));
    var u = new Uint8Array(buf), dv = new DataView(buf), e = u.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) return Promise.reject(new Error("Not a valid zip based document"));
    var n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true), files = {};
    for (var i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
      var method = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      files[new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl))] = { method: method, cs: cs, lho: lho }; p += 46 + nl + xl + cl;
    }
    return Promise.resolve(function (name) {
      var f = files[name]; if (!f) return Promise.resolve(null);
      var lnl = dv.getUint16(f.lho + 26, true), lxl = dv.getUint16(f.lho + 28, true), st = f.lho + 30 + lnl + lxl, d = u.subarray(st, st + f.cs);
      if (f.method === 0) return Promise.resolve(new TextDecoder().decode(d));
      return new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer().then(function (out) { return new TextDecoder().decode(out); });
    });
  }
  var xml = function (s) { return new DOMParser().parseFromString(s, "application/xml"); };
  var ln = function (n) { return n.localName; };

  function docxText(buf) {
    return unzip(buf).then(function (get) { return get("word/document.xml"); }).then(function (x) {
      var d = xml(x || ""), out = [];
      function ptext(p) {
        var s = "";
        (function w(n) { for (var i = 0; i < n.childNodes.length; i++) { var c = n.childNodes[i]; if (c.nodeType !== 1) continue; var l = ln(c);
          if (l === "t") s += c.textContent; else if (l === "tab") s += "\t"; else if (l === "br" || l === "cr") s += "\n"; else if (l !== "instrText") w(c); } })(p);
        return s;
      }
      function paras(x, acc) { for (var i = 0; i < x.childNodes.length; i++) { var y = x.childNodes[i]; if (y.nodeType !== 1) continue; if (ln(y) === "p") acc.push(ptext(y)); else paras(y, acc); } return acc; }
      (function walk(n) {
        for (var i = 0; i < n.childNodes.length; i++) {
          var c = n.childNodes[i]; if (c.nodeType !== 1) continue; var l = ln(c);
          if (l === "p") out.push(ptext(c));
          else if (l === "tbl") {
            for (var j = 0; j < c.childNodes.length; j++) {
              var tr = c.childNodes[j]; if (tr.nodeType !== 1 || ln(tr) !== "tr") continue; var cells = [];
              for (var k = 0; k < tr.childNodes.length; k++) { var tc = tr.childNodes[k]; if (tc.nodeType !== 1 || ln(tc) !== "tc") continue; cells.push(paras(tc, []).join(" ").replace(/\s+/g, " ").trim()); }
              out.push(cells.join("\t"));
            }
          } else walk(c);
        }
      })(d.documentElement);
      return out.join("\n");
    });
  }
  function xlsxText(buf) {
    return unzip(buf).then(function (get) {
      var ss = [], out = [];
      return get("xl/sharedStrings.xml").then(function (sx) {
        if (sx) { var sis = xml(sx).getElementsByTagName("si"); for (var i = 0; i < sis.length; i++) { var s = "", ts = sis[i].getElementsByTagName("t"); for (var j = 0; j < ts.length; j++) { var p = ts[j].parentNode; if (p && ln(p) === "rPh") continue; s += ts[j].textContent; } ss.push(s); } }
        var chain = Promise.resolve();
        for (var n = 1; n <= 60; n++) (function (n) {
          chain = chain.then(function () { return get("xl/worksheets/sheet" + n + ".xml"); }).then(function (sh) {
            if (!sh) return;
            var rows = xml(sh).getElementsByTagName("row");
            for (var r = 0; r < rows.length; r++) {
              var cells = [], cs = rows[r].getElementsByTagName("c");
              for (var c = 0; c < cs.length; c++) {
                var ref = cs[c].getAttribute("r") || "", m = ref.match(/^([A-Z]+)/), col = 0;
                if (m) for (var k = 0; k < m[1].length; k++) col = col * 26 + m[1].charCodeAt(k) - 64;
                col = Math.max(col - 1, cells.length);
                var ty = cs[c].getAttribute("t"), v = cs[c].getElementsByTagName("v")[0], val = "";
                if (ty === "s" && v) val = ss[+v.textContent] || ""; else if (ty === "inlineStr") val = cs[c].textContent; else if (v) val = v.textContent;
                while (cells.length < col) cells.push(""); cells[col] = String(val).replace(/[\t\r\n]+/g, " ");
              }
              while (cells.length && cells[cells.length - 1] === "") cells.pop();
              if (cells.length) out.push(cells.join("\t"));
            }
          });
        })(n);
        return chain;
      }).then(function () { return out.join("\n"); });
    });
  }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("Could not load the PDF reader (are you offline for the first time?)")); }; document.head.appendChild(s); }); }
  function pdfText(buf) {                      // pdf.js comes from the Plot to Route app folder, which the site already ships
    var ready = window.pdfjsLib ? Promise.resolve() : loadScript(base + "plot-to-route/vendor/pdf.min.js").then(function () { pdfjsLib.GlobalWorkerOptions.workerSrc = base + "plot-to-route/vendor/pdf.worker.min.js"; });
    return ready.then(function () { return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise; }).then(function (doc) {
      var out = [], chain = Promise.resolve();
      for (var p = 1; p <= doc.numPages; p++) (function (p) {
        chain = chain.then(function () { return doc.getPage(p); }).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          var rows = [];
          tc.items.forEach(function (it) {
            if (!it.str || !it.str.trim()) return;                      // pdf.js adds blank items for gaps: use the real positions instead
            var y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || 10;
            var r = rows.filter(function (r) { return Math.abs(r.y - y) < h * 0.5; })[0];
            if (!r) { r = { y: y, items: [] }; rows.push(r); }
            r.items.push({ x: x, w: it.width || 0, s: it.str });
          });
          rows.sort(function (a, b) { return b.y - a.y; });
          rows.forEach(function (r) {
            r.items.sort(function (a, b) { return a.x - b.x; });
            var s = "", end = null;
            r.items.forEach(function (it) { if (end !== null) { var gap = it.x - end; s += gap > 10 ? "\t" : gap > 1.2 ? " " : ""; } s += it.s; end = it.x + it.w; });
            out.push(s);
          });
        });
      })(p);
      return chain.then(function () { return out.join("\n"); });
    });
  }

  // ---- old binary Office files: .xls (BIFF), .doc (Word 97-2003), plus .ods / .odt / .rtf and HTML saved as .xls ----
  function ole(buf) {                          // OLE2 compound file -> function(name) giving the stream bytes
    var u = new Uint8Array(buf), dv = new DataView(buf);
    if (u.length < 512 || dv.getUint32(0, false) !== 0xD0CF11E0) return null;
    var ss = 1 << dv.getUint16(30, true), ms = 1 << dv.getUint16(32, true), cutoff = dv.getUint32(56, true);
    var sec = function (i) { return 512 + i * ss; };
    var fat = [], difat = [], i, j;
    for (i = 0; i < 109; i++) { var d = dv.getInt32(76 + i * 4, true); if (d >= 0) difat.push(d); }
    var dn = dv.getInt32(68, true);
    while (dn >= 0 && difat.length < 100000) { var o = sec(dn); for (i = 0; i < ss / 4 - 1; i++) { var d2 = dv.getInt32(o + i * 4, true); if (d2 >= 0) difat.push(d2); } dn = dv.getInt32(o + ss - 4, true); }
    difat.forEach(function (sd) { var o = sec(sd); for (var k = 0; k < ss / 4; k++) fat.push(dv.getInt32(o + k * 4, true)); });
    function chain(start, table) { var r = [], g = 0; while (start >= 0 && start < table.length && g++ < 1e6) { r.push(start); start = table[start]; } return r; }
    function big(start, size) {
      var out = new Uint8Array(size), pos = 0, ch = chain(start, fat);
      for (var c = 0; c < ch.length && pos < size; c++) { var o = sec(ch[c]), n = Math.min(ss, size - pos); out.set(u.subarray(o, o + n), pos); pos += n; }
      return out;
    }
    var dirBytes = big(dv.getInt32(48, true), chain(dv.getInt32(48, true), fat).length * ss), ents = [];
    var ddv = new DataView(dirBytes.buffer);
    for (i = 0; i + 128 <= dirBytes.length; i += 128) {
      var nl = ddv.getUint16(i + 64, true), nm = "";
      for (j = 0; j < nl / 2 - 1; j++) nm += String.fromCharCode(ddv.getUint16(i + j * 2, true));
      ents.push({ name: nm, type: dirBytes[i + 66], start: ddv.getInt32(i + 116, true), size: ddv.getUint32(i + 120, true) });
    }
    var root = ents[0], mini = null, minifat = null;
    function miniInit() {
      if (mini) return; mini = big(root.start, root.size);
      var mfs = dv.getInt32(60, true), mfb = big(mfs, chain(mfs, fat).length * ss), mdv = new DataView(mfb.buffer); minifat = [];
      for (var k = 0; k + 4 <= mfb.length; k += 4) minifat.push(mdv.getInt32(k, true));
    }
    return function (name) {
      var e = ents.filter(function (x) { return x.type === 2 && x.name === name; })[0]; if (!e) return null;
      if (e.size >= cutoff) return big(e.start, e.size);
      miniInit(); var out = new Uint8Array(e.size), pos = 0, ch = chain(e.start, minifat);
      for (var c = 0; c < ch.length && pos < e.size; c++) { var n = Math.min(ms, e.size - pos); out.set(mini.subarray(ch[c] * ms, ch[c] * ms + n), pos); pos += n; }
      return out;
    };
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function serial(n, withTime) {
    var d = new Date(Math.round((n - 25569) * 86400000));
    if (n < 1) return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function isDateFmt(id, custom) {
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
    var f = custom[id]; if (!f) return false;
    f = f.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    return /[dmyh]/i.test(f) && !/[#0]/.test(f.replace(/[dmyhs]/gi, ""));
  }
  function xlsText(buf) {
    var get = ole(buf), st = get && (get("Workbook") || get("Book")); if (!st) throw new Error("This old Excel file could not be read.");
    var dv = new DataView(st.buffer, st.byteOffset, st.byteLength), pos = 0, recs = [];
    while (pos + 4 <= st.length) { var id = dv.getUint16(pos, true), len = dv.getUint16(pos + 2, true); recs.push({ id: id, o: pos + 4, n: len }); pos += 4 + len; }
    function str16(o, n, hi) { var s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(hi ? dv.getUint16(o + i * 2, true) : st[o + i]); return s; }
    var sst = [], xf = [], fmts = {}, sheets = [], cur = null, bof = 0x600, pendF = null;
    function readSst(r, k) {
      var chunks = [r]; while (recs[k + 1] && recs[k + 1].id === 0x3C) chunks.push(recs[++k]);
      var ci = 0, p = 8, hi = false;
      function len() { return chunks[ci].n; }
      function byte() { while (p >= len() && ci < chunks.length - 1) { ci++; p = 0; } return st[chunks[ci].o + p++]; }
      function u16() { var a = byte(); return a | (byte() << 8); }
      function skip(n) { while (n > 0) { if (p >= len()) { if (ci >= chunks.length - 1) return; ci++; p = 0; } var t = Math.min(n, len() - p); p += t; n -= t; } }
      var uniq = dv.getUint32(r.o + 4, true);
      while (sst.length < uniq && !(ci === chunks.length - 1 && p >= len())) {
        var cch = u16(), fl = byte(), runs = 0, ext = 0, s = "", remain = cch; hi = fl & 1;
        if (fl & 8) runs = u16(); if (fl & 4) { ext = byte() | (byte() << 8) | (byte() << 16) | (byte() * 16777216); }
        while (remain > 0) {
          if (p >= len()) { if (ci >= chunks.length - 1) break; ci++; p = 0; hi = byte() & 1; }
          var n = Math.min(remain, Math.floor((len() - p) / (hi ? 2 : 1)));
          if (n <= 0) { p = len(); continue; }
          s += str16(chunks[ci].o + p, n, hi); p += n * (hi ? 2 : 1); remain -= n;
        }
        skip(runs * 4 + ext); sst.push(s);
      }
      return k;
    }
    function rk(v) {
      var x; if (v & 2) x = (v | 0) >> 2; else { var t = new DataView(new ArrayBuffer(8)); t.setUint32(4, (v & 0xFFFFFFFC) >>> 0, true); x = t.getFloat64(0, true); }
      return v & 1 ? x / 100 : x;
    }
    function put(row, col, xfi, val, isNum) {
      if (!cur) return; var f = xf[xfi], txt;
      if (isNum) txt = f != null && isDateFmt(f, fmts) ? serial(val) : (Number.isInteger(val) ? String(val) : String(+val.toPrecision(12))); else txt = String(val);
      (cur[row] = cur[row] || [])[col] = txt.replace(/[\t\r\n]+/g, " ");
    }
    for (var k = 0; k < recs.length; k++) {
      var r = recs[k], o = r.o;
      switch (r.id) {
        case 0x809: bof = dv.getUint16(o, true); if (dv.getUint16(o + 2, true) === 0x10) { cur = []; sheets.push(cur); } else cur = null; break;
        case 0xE0: xf.push(dv.getUint16(o + 2, true)); break;
        case 0x41: { var cch = dv.getUint16(o + 2, true), fl = st[o + 4]; fmts[dv.getUint16(o, true)] = str16(o + 5, cch, fl & 1); } break;
        case 0xFC: k = readSst(r, k); break;
        case 0xFD: put(dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true), sst[dv.getUint32(o + 6, true)] || "", false); break;
        case 0x203: put(dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true), dv.getFloat64(o + 6, true), true); break;
        case 0x27E: put(dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true), rk(dv.getUint32(o + 6, true)), true); break;
        case 0xBD: { var rw = dv.getUint16(o, true), c0 = dv.getUint16(o + 2, true), cn = (r.n - 6) / 6; for (var q = 0; q < cn; q++) put(rw, c0 + q, dv.getUint16(o + 4 + q * 6, true), rk(dv.getUint32(o + 6 + q * 6, true)), true); } break;
        case 0x204: case 0xD6: { var l = dv.getUint16(o + 6, true); put(dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true), bof >= 0x600 ? str16(o + 9, l, st[o + 8] & 1) : str16(o + 8, l, false), false); } break;
        case 0x205: if (st[o + 7] === 0) put(dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true), st[o + 6] ? "TRUE" : "FALSE", false); break;
        case 0x06:
          if (st[o + 12] === 0xFF && st[o + 13] === 0xFF) { if (st[o + 6] === 0) pendF = [dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true)]; }
          else put(dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true), dv.getFloat64(o + 6, true), true);
          break;
        case 0x207: if (pendF) { var l2 = dv.getUint16(o, true); put(pendF[0], pendF[1], pendF[2], bof >= 0x600 ? str16(o + 3, l2, st[o + 2] & 1) : str16(o + 2, l2, false), false); pendF = null; } break;
      }
    }
    var out = [];
    sheets.forEach(function (sh) { sh.forEach(function (row) { if (!row) return; var c = []; for (var i = 0; i < row.length; i++) c.push(row[i] || ""); while (c.length && c[c.length - 1] === "") c.pop(); if (c.length) out.push(c.join("\t")); }); });
    return out.join("\n");
  }
  function docBinText(buf) {
    var get = ole(buf), wd = get && get("WordDocument"); if (!wd) throw new Error("This old Word file could not be read.");
    var dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (dv.getUint16(0, true) !== 0xA5EC) throw new Error("This old Word file could not be read.");
    var tbl = get((dv.getUint16(10, true) & 0x200) ? "1Table" : "0Table"); if (!tbl) throw new Error("This old Word file could not be read.");
    var tv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength), ccp = dv.getInt32(0x4C, true), fc = dv.getUint32(0x1A2, true), lcb = dv.getUint32(0x1A6, true), p = fc, end = fc + lcb, text = "";
    while (p < end && tbl[p] === 1) p += 3 + tv.getUint16(p + 1, true);
    if (tbl[p] !== 2) throw new Error("This old Word file could not be read.");
    var plc = p + 5, n = Math.floor((tv.getUint32(p + 1, true) - 4) / 12);
    for (var i = 0; i < n && text.length < ccp; i++) {
      var a = tv.getUint32(plc + i * 4, true), b = tv.getUint32(plc + (i + 1) * 4, true), f = tv.getUint32(plc + (n + 1) * 4 + i * 8 + 2, true), cnt = b - a;
      if (f & 0x40000000) { var o = (f & 0x3FFFFFFF) / 2, bytes = wd.subarray(o, o + cnt); text += new TextDecoder("windows-1252").decode(bytes); }
      else text += new TextDecoder("utf-16le").decode(wd.subarray(f, f + cnt * 2));
    }
    text = text.slice(0, ccp);
    var flags = null;
    try {                                      // which paragraph marks belong to a table (and which end a row)
      var pieces = [];
      for (var i2 = 0; i2 < n; i2++) { var f2 = tv.getUint32(plc + (n + 1) * 4 + i2 * 8 + 2, true), c0 = tv.getUint32(plc + i2 * 4, true), c1 = tv.getUint32(plc + (i2 + 1) * 4, true), cp8 = !!(f2 & 0x40000000);
        pieces.push({ cp0: c0, cp1: c1, s: cp8 ? (f2 & 0x3FFFFFFF) / 2 : f2, u: cp8 ? 1 : 2 }); }
      var cpOf = function (b) { for (var q = 0; q < pieces.length; q++) { var pc = pieces[q]; if (b >= pc.s && b < pc.s + (pc.cp1 - pc.cp0) * pc.u) return pc.cp0 + Math.floor((b - pc.s) / pc.u); } return -1; };
      var fl = new Uint8Array(text.length + 1), plcP = dv.getUint32(0x102, true), lcbP = dv.getUint32(0x106, true), np = Math.floor((lcbP - 4) / 8);
      for (var i3 = 0; i3 < np; i3++) {
        var base = tv.getUint32(plcP + (np + 1) * 4 + i3 * 4, true) * 512, crun = wd[base + 511];
        for (var j = 0; j < crun; j++) {
          var fa = dv.getUint32(base + j * 4, true), fb = dv.getUint32(base + (j + 1) * 4, true), bx = wd[base + (crun + 1) * 4 + j * 13];
          if (!bx) continue;
          var off = base + bx * 2, cb = wd[off], q0, qe;
          if (cb === 0) { qe = off + 2 + wd[off + 1] * 2; q0 = off + 2; } else { qe = off + 1 + cb * 2 - 1; q0 = off + 1; }
          var inT = 0, ttp = 0;
          for (var sp = q0 + 2; sp + 2 <= qe;) {
            var op = dv.getUint16(sp, true), spra = op >> 13, sz = [1, 1, 2, 4, 2, 2, -1, 3][spra]; sp += 2;
            if (op === 0x2416) inT = wd[sp]; else if (op === 0x2417) ttp = wd[sp];
            if (op === 0xD608) sz = dv.getUint16(sp, true) + 1; else if (sz < 0) sz = 1 + wd[sp]; sp += sz;
          }
          if (!inT && !ttp) continue;
          var ca = cpOf(fa), cz = cpOf(fb - 1); if (ca < 0 || cz < 0) continue;
          for (var z = ca; z <= cz && z < fl.length; z++) fl[z] = (inT ? 1 : 0) | (ttp ? 2 : 0);
        }
      }
      flags = fl;
    } catch (e) { flags = null; }
    var out = [], row = [], cell = "", stack = [];
    for (var c = 0; c < text.length; c++) {
      var ch = text[c];
      if (ch === "\x13") { stack.push("code"); continue; }
      if (ch === "\x14") { if (stack.length) stack[stack.length - 1] = "result"; continue; }
      if (ch === "\x15") { stack.pop(); continue; }
      if (stack.length && stack[stack.length - 1] === "code") continue;
      if (ch === "\x07") {
        var isRowEnd = flags ? (!(flags[c] & 1) || !!(flags[c] & 2)) : (cell === "" && row.length > 0 && text[c - 1] === "\x07");   // row mark: flagged as row end, or not a table-cell paragraph
        if (isRowEnd) { if (row.length) out.push(row.join("\t")); row = []; cell = ""; }
        else { row.push(cell.replace(/\s+/g, " ").trim()); cell = ""; }
      } else if (ch === "\r") { if (flags ? (flags[c] & 1) : row.length) cell += " "; else { out.push(cell); cell = ""; } }
      else if (ch === "\x0B" || ch === "\x0C") cell += (flags ? (flags[c] & 1) : row.length) ? " " : "\n";
      else if (ch >= " " || ch === "\t") cell += ch;
    }
    if (cell) out.push(cell);
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
  }
  function odfText(buf) {
    return unzip(buf).then(function (get) { return get("content.xml"); }).then(function (x) {
      if (!x) throw new Error("This OpenDocument file could not be read.");
      var out = [];
      function ptext(n) { var s = ""; (function w(m) { for (var i = 0; i < m.childNodes.length; i++) { var c = m.childNodes[i]; if (c.nodeType === 3) s += c.nodeValue; else if (c.nodeType === 1) { var l = ln(c); if (l === "tab") s += "\t"; else if (l === "line-break") s += "\n"; else if (l === "s") s += " ".repeat(+c.getAttribute("text:c") || 1); else w(c); } } })(n); return s; }
      function cellText(c) { var t = ""; for (var i = 0; i < c.childNodes.length; i++) { var m = c.childNodes[i]; if (m.nodeType === 1 && (ln(m) === "p" || ln(m) === "h")) t += (t ? " " : "") + ptext(m); }
        var dvv = c.getAttribute("office:date-value"); if (dvv) return dvv.slice(0, 10); var vv = c.getAttribute("office:value"); if (vv !== null && !t) return vv; return t; }
      (function walk(n) {
        for (var i = 0; i < n.childNodes.length; i++) {
          var c = n.childNodes[i]; if (c.nodeType !== 1) continue; var l = ln(c);
          if (l === "p" || l === "h") out.push(ptext(c));
          else if (l === "table-row") {
            var cells = [], rep = Math.min(+c.getAttribute("table:number-rows-repeated") || 1, 50);
            for (var j = 0; j < c.childNodes.length; j++) { var tc = c.childNodes[j]; if (tc.nodeType !== 1 || (ln(tc) !== "table-cell" && ln(tc) !== "covered-table-cell")) continue; var cr = Math.min(+tc.getAttribute("table:number-columns-repeated") || 1, 60), tx = cellText(tc).replace(/[\t\r\n]+/g, " "); for (var q = 0; q < cr; q++) cells.push(tx); }
            while (cells.length && cells[cells.length - 1] === "") cells.pop();
            if (cells.length) for (var z = 0; z < rep; z++) out.push(cells.join("\t"));
          } else walk(c);
        }
      })(xml(x).documentElement);
      return out.join("\n");
    });
  }
  function rtfText(s) {
    var out = "", stack = [], skip = false, uc = 1, i = 0, skipN = 0, skipDest = { fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, pict: 1, header: 1, footer: 1, themedata: 1, colorschememapping: 1, latentstyles: 1, datastore: 1 };
    while (i < s.length) {
      var ch = s[i];
      if (ch === "{") { stack.push([skip, uc]); i++; }
      else if (ch === "}") { var t = stack.pop(); if (t) { skip = t[0]; uc = t[1]; } i++; }
      else if (ch === "\\") {
        var m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i, i + 40));
        if (m) {
          var w = m[1], v = m[2]; i += m[0].length;
          if (skipDest[w]) skip = true;
          else if (w === "par" || w === "line") { if (!skip) out += "\n"; }
          else if (w === "tab") { if (!skip) out += "\t"; }
          else if (w === "cell") { if (!skip) out += "\t"; }
          else if (w === "row") { if (!skip) out = out.replace(/\t$/, "") + "\n"; }
          else if (w === "uc") uc = +v;
          else if (w === "u") { if (!skip) { var cp = +v; if (cp < 0) cp += 65536; out += String.fromCharCode(cp); } skipN = uc; }
        } else {
          var nx = s[i + 1];
          if (nx === "'") { if (!skip) out += new TextDecoder("windows-1252").decode(new Uint8Array([parseInt(s.substr(i + 2, 2), 16) || 63])); i += 4; }
          else if (nx === "*") { skip = true; i += 2; }
          else { if (!skip && (nx === "\\" || nx === "{" || nx === "}")) out += nx; i += 2; }
        }
      }
      else if (ch === "\r" || ch === "\n") i++;
      else { if (skipN > 0) skipN--; else if (!skip) out += ch; i++; }
    }
    return out.replace(/\t+\n/g, "\n");
  }
  function htmlText(s) {
    var d = new DOMParser().parseFromString(s, "text/html"), out = [];
    var trs = d.querySelectorAll("tr");
    if (trs.length) { for (var i = 0; i < trs.length; i++) { var cs = trs[i].querySelectorAll("td,th"), c = []; for (var j = 0; j < cs.length; j++) c.push(cs[j].textContent.replace(/\s+/g, " ").trim()); while (c.length && c[c.length - 1] === "") c.pop(); if (c.length) out.push(c.join("\t")); } return out.join("\n"); }
    return (d.body ? d.body.innerText || d.body.textContent : "") || "";
  }
  function sniff(buf, ext) {                   // old formats are often something else saved under the old name
    var u = new Uint8Array(buf), head = String.fromCharCode.apply(null, u.subarray(0, 8));
    if (u[0] === 0xD0 && u[1] === 0xCF) return ext === "doc" ? "doc" : "xls";
    if (head.slice(0, 5) === "{\\rtf") return "rtf";
    if (head.slice(0, 2) === "PK") return ext === "doc" ? "docx" : (ext === "odt" || ext === "ods") ? "odf" : ext === "xls" ? "xlsx" : ext;
    var t = String.fromCharCode.apply(null, u.subarray(0, 300)).toLowerCase();
    if (t.indexOf("<html") >= 0 || t.indexOf("<table") >= 0 || t.indexOf("<?xml") >= 0 || t.indexOf("<!doctype") >= 0) return "html";
    return "text";
  }

  function tabs(text) {                        // text copied from a table or saved as CSV -> rows with tab separated cells
    text = String(text || "").replace(/\r\n?/g, "\n");
    var lines = text.split("\n");
    var withTab = lines.filter(function (l) { return l.indexOf("\t") >= 0; }).length;
    if (withTab >= 1) return text;
    var delim = null, best = 1;
    [";", ",", "|"].forEach(function (d) { var n = lines.filter(function (l) { return l.split(d).length - 1 >= 2; }).length; if (n > best) { best = n; delim = d; } });   // the separator most rows have at least twice
    if (delim) {                               // a real CSV: honour "quoted, fields"
      return text.split("\n").map(function (l) {
        var out = [], cur = "", q = false;
        for (var i = 0; i < l.length; i++) { var ch = l[i];
          if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
          else if (ch === delim && !q) { out.push(cur); cur = ""; } else cur += ch; }
        out.push(cur); return out.join("\t");
      }).join("\n");
    }
    var gaps = lines.filter(function (l) { return /\S {2,}\S/.test(l); }).length;
    if (gaps >= 2) return lines.map(function (l) { return l.trim().split(/ {2,}/).join("\t"); }).join("\n");   // columns lined up with spaces (copied from a PDF)
    return text;
  }

  window.DocRead = {
    tabs: tabs,
    ext: function (f) { return (f.name.split(".").pop() || "").toLowerCase(); },
    read: function (f) {
      var ext = (f.name.split(".").pop() || "").toLowerCase();
      if (["pages", "numbers"].indexOf(ext) >= 0) return Promise.reject(new Error("“" + f.name + "”: this format cannot be read. Save it as .docx or .xlsx (or PDF) and try again."));
      return f.arrayBuffer().then(function (buf) {
        if (["doc", "xls", "odt", "ods", "rtf"].indexOf(ext) >= 0) {
          var kind = ext === "rtf" ? "rtf" : sniff(buf, ext);
          try {
            if (kind === "xls") return xlsText(buf);
            if (kind === "doc") return docBinText(buf);
            if (kind === "docx") return docxText(buf);
            if (kind === "xlsx") return xlsxText(buf);
            if (kind === "odf") return odfText(buf);
            if (kind === "rtf") return rtfText(decodeText(buf));
            if (kind === "html") return htmlText(decodeText(buf));
            return tabs(decodeText(buf));
          } catch (e) { throw new Error("“" + f.name + "”: " + (e && e.message || "could not be read") + " Save it as .docx or .xlsx (or PDF) and try again."); }
        }
        if (ext === "docx") return docxText(buf);
        if (ext === "xlsx" || ext === "xlsm") return xlsxText(buf);
        if (ext === "pdf") return pdfText(buf).then(function (t) { if (!t.trim()) throw new Error("“" + f.name + "”: this PDF has no text, it is probably a scan. Scanned pictures cannot be read."); return t; });
        return tabs(decodeText(buf));
      });
    }
  };
})();
