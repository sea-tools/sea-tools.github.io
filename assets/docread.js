// Reads text out of documents, in the browser, without sending anything anywhere.
//   DocRead.read(file) -> Promise<string>   rows separated by newlines, table cells separated by tabs
// Supports .docx (paragraphs and tables), .xlsx / .xlsm (all sheets), .csv / .tsv / .txt and .pdf with a text layer.
// Old binary formats (.doc, .xls) must be saved as .docx / .xlsx first. Scanned PDFs (pictures) cannot be read.
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
      if (["doc", "xls", "odt", "ods", "rtf", "pages", "numbers"].indexOf(ext) >= 0) return Promise.reject(new Error("“" + f.name + "”: this old format cannot be read. Save it as .docx or .xlsx (or PDF) and try again."));
      return f.arrayBuffer().then(function (buf) {
        if (ext === "docx") return docxText(buf);
        if (ext === "xlsx" || ext === "xlsm") return xlsxText(buf);
        if (ext === "pdf") return pdfText(buf).then(function (t) { if (!t.trim()) throw new Error("“" + f.name + "”: this PDF has no text, it is probably a scan. Scanned pictures cannot be read."); return t; });
        return tabs(decodeText(buf));
      });
    }
  };
})();
