// Printing that also works in an app installed on an iPad / iPhone home screen.
// There window.print() does nothing at all (an iOS limit), so the print layout is turned into a PDF on the device
// and handed to the iOS share sheet, which has Print, Save to Files, Mail…  Everywhere else the normal print dialog is used.
//   SeaPrint.print({ margin: 14 })                       flowing content, A4 portrait, margin in mm
//   SeaPrint.print({ pages: "#printRoot .sheet" })       every matching element is one page of its own size
//   options: prep(doc) – adjust the copy of the document before it is drawn; name – file name without .pdf
(function () {
  if (window.SeaPrint) return;
  var base = (document.currentScript && document.currentScript.src || "").replace(/assets\/print\.js.*$/, "");
  var PX = 96 / 25.4;                                    // CSS px per mm

  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function needsPdf() {
    try { if (/[?&]pdfprint=1/.test(location.search) || localStorage.getItem("sea.pdfprint") === "1") return true; } catch (e) {}
    return isIOS() && (navigator.standalone === true || matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches);
  }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("the PDF maker could not be loaded (open the app once while online)")); }; document.head.appendChild(s); }); }
  function ready() { return window.html2canvas ? Promise.resolve() : loadScript(base + "assets/vendor/html2canvas.min.js"); }

  // In the copy of the page: make the print style sheet the one that applies
  function printMedia(doc) {
    function walk(rules) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.media && r.cssRules) {
          var m = r.media.mediaText;
          if (/\bprint\b/i.test(m) && !/not\s+print/i.test(m)) r.media.mediaText = "all";
          else if (/^\s*(only\s+)?screen\s*$/i.test(m)) r.media.mediaText = "not all";
          else walk(r.cssRules);
        } else if (r.cssRules && r.type !== 1) { try { walk(r.cssRules); } catch (e) {} }
      }
    }
    for (var s = 0; s < doc.styleSheets.length; s++) {
      var sh = doc.styleSheets[s];
      try { var mt = sh.media && sh.media.mediaText; if (mt && /\bprint\b/i.test(mt)) sh.media.mediaText = "all"; walk(sh.cssRules); } catch (e) {}
    }
  }
  // Drawings (SVG) are turned into pictures first, with their colours and fonts written into them
  var SVGP = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing", "display", "visibility", "paint-order", "transform", "transform-origin", "transform-box", "clip-path", "mask"];
  function svgToImg(doc, svg, scale) {
    var win = doc.defaultView, r = svg.getBoundingClientRect(), w = r.width, h = r.height;
    if (w < 2 || h < 2) return Promise.resolve();
    var cs0 = win.getComputedStyle(svg), copy = svg.cloneNode(true), hid0 = cs0.visibility === "hidden";
    var src = [svg].concat([].slice.call(svg.querySelectorAll("*"))), dst = [copy].concat([].slice.call(copy.querySelectorAll("*")));
    for (var i = 0; i < src.length && i < dst.length; i++) {
      var cs = win.getComputedStyle(src[i]), st = "";
      for (var k = 0; k < SVGP.length; k++) { var v = cs.getPropertyValue(SVGP[k]); if (!v || (i === 0 && /^(transform|display|visibility|opacity)/.test(SVGP[k]))) continue;
        if (SVGP[k] === "visibility" && (v !== "hidden" || hid0)) continue;          // a drawing inside a hidden print area is still wanted
        if (SVGP[k] === "display" && v !== "none") continue;
        st += SVGP[k] + ":" + v + ";"; }
      dst[i].setAttribute("style", st); dst[i].removeAttribute("class");
    }
    if (!copy.getAttribute("viewBox")) copy.setAttribute("viewBox", "0 0 " + (svg.width && svg.width.baseVal && svg.width.baseVal.value || w) + " " + (svg.height && svg.height.baseVal && svg.height.baseVal.value || h));
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg"); copy.setAttribute("width", w); copy.setAttribute("height", h);
    copy.style.color = cs0.color; copy.style.overflow = cs0.overflow;
    var xml = new XMLSerializer().serializeToString(copy), url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () {
        var out = doc.createElement("img"), data = url;
        try { var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale)); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); data = c.toDataURL("image/png"); } catch (e) {}
        out.id = svg.id || ""; out.setAttribute("class", svg.getAttribute("class") || "");
        var keep = ["display", "position", "left", "top", "right", "bottom", "float", "vertical-align", "margin-top", "margin-right", "margin-bottom", "margin-left", "z-index", "opacity", "transform", "transform-origin", "grid-area", "align-self", "justify-self", "flex"], css = "";
        keep.forEach(function (p) { var v = cs0.getPropertyValue(p); if (v) css += p + ":" + v + ";"; });
        out.style.cssText = css + "width:" + w + "px!important;height:" + h + "px!important;max-width:none!important;max-height:none!important;min-width:0;min-height:0;box-sizing:content-box;padding:0;border:0";
        if (cs0.display === "inline") out.style.display = "inline-block";
        out.onload = out.onerror = function () { res(); }; out.src = data;
        if (svg.parentNode) svg.parentNode.replaceChild(out, svg);
      };
      im.onerror = function () { res(); };
      im.src = url;
    });
  }
  // Form fields become plain text boxes of the same size, so their text is drawn exactly where the page shows it
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function flatFields(doc) {
    var win = doc.defaultView, els = [].slice.call(doc.querySelectorAll("input,select,textarea"));
    els.forEach(function (el) {
      var type = (el.getAttribute("type") || "").toLowerCase(), tag = el.tagName;
      if (tag === "INPUT" && /^(checkbox|radio|range|file|color|button|submit|reset|hidden|image)$/.test(type)) return;
      var cs = win.getComputedStyle(el); if (cs.display === "none") return;
      var r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
      var txt = tag === "SELECT" ? (el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent : "") : (el.value || "");
      var m = type === "date" && /^(\d{4})-(\d\d)-(\d\d)$/.exec(txt); if (m) txt = m[3] + " " + MON[+m[2] - 1] + " " + m[1];
      var d = doc.createElement("div"), multi = tag === "TEXTAREA", css = "";
      ["font-family", "font-size", "font-weight", "font-style", "letter-spacing", "color", "text-align", "text-transform", "padding-top", "padding-right", "padding-bottom", "padding-left",
        "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
        "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "border-radius", "background-color", "margin-top", "margin-right", "margin-bottom", "margin-left",
        "vertical-align", "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end", "flex-grow", "flex-shrink", "flex-basis", "align-self", "justify-self", "position", "left", "top", "right", "bottom", "float"]
        .forEach(function (p) { var v = cs.getPropertyValue(p); if (v) css += p + ":" + v + ";"; });
      var inner = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
      css += "box-sizing:border-box;width:" + r.width + "px;" + (multi ? "min-height:" + r.height + "px;white-space:pre-wrap;line-height:" + cs.lineHeight + ";" : "height:" + r.height + "px;white-space:nowrap;line-height:" + Math.max(inner, 1) + "px;") + "overflow:hidden;";
      css += "display:" + (/^inline/.test(cs.display) ? "inline-block" : "block") + ";";
      d.setAttribute("style", css); d.textContent = txt;
      if (el.parentNode) el.parentNode.replaceChild(d, el);
    });
  }
  function prepDoc(doc, opts, scale) {
    printMedia(doc);
    // html2canvas writes the on-screen look into every drawing of its copy; put back what the page itself says, so the print rules apply
    var live = document.querySelectorAll("svg"), cl = doc.querySelectorAll("svg");
    if (live.length === cl.length) for (var q = 0; q < cl.length; q++) {
      var A = [live[q]].concat([].slice.call(live[q].querySelectorAll("*"))), Bq = [cl[q]].concat([].slice.call(cl[q].querySelectorAll("*")));
      if (A.length !== Bq.length) continue;
      for (var z = 0; z < A.length; z++) { var sa = A[z].getAttribute("style"); if (sa === null) Bq[z].removeAttribute("style"); else Bq[z].setAttribute("style", sa); }
    }
    var st = doc.createElement("style");
    st.textContent = "html,body{background:#fff!important;height:auto!important;min-height:0!important;overflow:visible!important}#seaPrintUi{display:none!important}";
    doc.head.appendChild(st);
    var ph = doc.querySelectorAll("[placeholder]"); for (var i = 0; i < ph.length; i++) ph[i].removeAttribute("placeholder");
    if (opts.prep) { try { opts.prep(doc); } catch (e) {} }
    flatFields(doc);
    var svgs = [].slice.call(doc.querySelectorAll("svg")).filter(function (v) { return !(v.parentNode && v.parentNode.closest && v.parentNode.closest("svg")); }), chain = Promise.resolve();
    svgs.forEach(function (v) { chain = chain.then(function () { var cs = doc.defaultView.getComputedStyle(v); if (cs.display === "none") return; return svgToImg(doc, v, scale || 2.2); }); });
    return chain;
  }

  // Where a flowing document may be cut into pages
  function measure(doc, pageH) {
    var win = doc.defaultView, total = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, Math.ceil(doc.body.getBoundingClientRect().bottom));
    var atoms = [], forced = [], tables = [], all = doc.body.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i], cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var r = el.getBoundingClientRect(); if (!r.height || !r.width) continue;
      var top = r.top + win.scrollY, bot = r.bottom + win.scrollY, tag = el.tagName;
      if (tag === "THEAD" && el.parentNode && el.parentNode.tagName === "TABLE") { var tr = el.parentNode.getBoundingClientRect(); if (bot - top < pageH / 3) tables.push({ top: tr.top + win.scrollY, bottom: tr.bottom + win.scrollY, hTop: top, hBot: bot }); }
      var ba = cs.breakAfter || cs.pageBreakAfter, bb = cs.breakBefore || cs.pageBreakBefore, bi = cs.breakInside || cs.pageBreakInside;
      if (ba === "page" || ba === "always") forced.push(bot);
      if (bb === "page" || bb === "always") forced.push(top);
      var leaf = !el.firstElementChild && (el.textContent.trim() || /^(INPUT|TEXTAREA|SELECT)$/.test(tag));
      if ((tag === "TR" || tag === "IMG" || tag === "svg" || tag === "CANVAS" || bi === "avoid" || leaf) && bot - top < pageH - 2) atoms.push([top, bot]);
    }
    forced = forced.filter(function (y) { return y > 4 && y < total - 4; }).sort(function (a, b) { return a - b; });
    var pages = [], y0 = 0, guard = 0;
    while (y0 < total - 1 && guard++ < 2000) {
      var head = null;                                   // a table that started on an earlier page: its header row is repeated
      for (var t = 0; t < tables.length; t++) if (y0 > tables[t].hBot + 1 && y0 < tables[t].bottom - 2) { head = tables[t]; break; }
      var room = pageH - (head ? head.hBot - head.hTop : 0), y1 = y0 + room, f = null;
      for (var k = 0; k < forced.length; k++) if (forced[k] > y0 + 2 && forced[k] <= y1 + 0.5) { f = forced[k]; break; }
      if (f !== null) y1 = f;
      else if (y1 >= total) y1 = total;
      else { var moved = true, n = 0; while (moved && n++ < 50) { moved = false; for (var a = 0; a < atoms.length; a++) if (atoms[a][0] < y1 - 0.5 && atoms[a][1] > y1 + 0.5 && atoms[a][0] > y0 + 2) { y1 = atoms[a][0]; moved = true; } } }
      pages.push({ y0: y0, y1: y1, head: head }); y0 = y1;
    }
    return { pages: pages, total: total };
  }

  function toJpeg(canvas) { return new Promise(function (res, rej) { canvas.toBlob(function (b) { if (!b) return rej(new Error("the page picture could not be made")); b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }, rej); }, "image/jpeg", 0.92); }); }

  // A small PDF: one JPEG picture per page
  function buildPdf(pages) {
    var enc = new TextEncoder(), parts = [], len = 0, offs = [];
    function put(x) { var u = typeof x === "string" ? enc.encode(x) : x; parts.push(u); len += u.length; }
    function obj(n, body) { offs[n] = len; put(n + " 0 obj\n" + body + "\nendobj\n"); }
    put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    var kids = pages.map(function (p, i) { return (3 + i * 3) + " 0 R"; }).join(" ");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Count " + pages.length + " /Kids [" + kids + "] >>");
    pages.forEach(function (p, i) {
      var n = 3 + i * 3, f = function (v) { return (Math.round(v * 100) / 100).toString(); };
      var content = "q " + f(p.w) + " 0 0 " + f(p.h) + " " + f(p.x) + " " + f(p.ph - p.y - p.h) + " cm /Im0 Do Q";
      obj(n, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + f(p.pw) + " " + f(p.ph) + "] /Resources << /XObject << /Im0 " + (n + 2) + " 0 R >> >> /Contents " + (n + 1) + " 0 R >>");
      obj(n + 1, "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");
      offs[n + 2] = len;
      put((n + 2) + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + p.iw + " /Height " + p.ih + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + p.jpg.length + " >>\nstream\n");
      put(p.jpg); put("\nendstream\nendobj\n");
    });
    var count = 3 + pages.length * 3, xref = len, x = "xref\n0 " + count + "\n0000000000 65535 f \n";
    for (var k = 1; k < count; k++) x += ("0000000000" + offs[k]).slice(-10) + " 00000 n \n";
    put(x + "trailer\n<< /Size " + count + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    return new Blob(parts, { type: "application/pdf" });
  }

  function ui() {
    var d = document.getElementById("seaPrintUi"); if (d) d.remove();
    d = document.createElement("div"); d.id = "seaPrintUi"; d.setAttribute("data-html2canvas-ignore", "true");
    d.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:rgba(20,28,36,.55);display:flex;align-items:center;justify-content:center;padding:18px;font:16px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
    d.innerHTML = '<div style="background:#fff;color:#111;border-radius:16px;max-width:430px;width:100%;padding:20px 20px 16px;box-shadow:0 12px 40px rgba(0,0,0,.35)"><div id="seaPrintT" style="font-weight:700;font-size:18px;margin-bottom:6px"></div><div id="seaPrintM" style="color:#444;font-size:15px"></div><div id="seaPrintB" style="display:flex;flex-direction:column;gap:9px;margin-top:16px"></div></div>';
    document.body.appendChild(d); return d;
  }
  function btn(label, primary) {             // colours are forced: an app's own button style must not hide the label
    var b = document.createElement("button"); b.type = "button"; b.textContent = label;
    b.style.cssText = "appearance:none;border:0;border-radius:11px;padding:13px 14px;font:600 16px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;cursor:pointer;text-align:center;text-decoration:none;display:block;width:100%;min-height:0;box-shadow:none";
    b.style.setProperty("background", primary ? "#0b6bcb" : "#e9edf1", "important"); b.style.setProperty("color", primary ? "#fff" : "#111", "important");
    return b;
  }

  function makePdf(opts) {
    var name = (opts.name || document.title || "document").replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "document";
    var box = ui(), T = box.querySelector("#seaPrintT"), M = box.querySelector("#seaPrintM"), B = box.querySelector("#seaPrintB");
    T.textContent = "Preparing the PDF…"; M.textContent = "One moment.";
    try { window.dispatchEvent(new Event("beforeprint")); } catch (e) {}      // apps prepare their print layout on this event
    var scale = opts.scale || 2.2, common = { backgroundColor: "#ffffff", logging: false, useCORS: true, scrollX: 0, scrollY: 0, scale: scale, ignoreElements: function (el) { return el.id === "seaPrintUi"; } };
    var pages = [];
    function step(i, n) { M.textContent = "Page " + i + " of " + n; return new Promise(function (r) { setTimeout(r, 30); }); }

    var work = ready().then(function () {
      if (opts.pages) {                                  // fixed sheets (forms)
        var els = [].slice.call(document.querySelectorAll(opts.pages)); if (!els.length) throw new Error("there is nothing to print");
        var chain = Promise.resolve();
        els.forEach(function (el, i) {
          chain = chain.then(function () { return step(i + 1, els.length); }).then(function () {
            return html2canvas(el, Object.assign({}, common, { windowWidth: 1400, windowHeight: 1000, onclone: function (doc) { return prepDoc(doc, opts, scale); } }));
          }).then(function (cv) { return toJpeg(cv).then(function (jpg) { var w = cv.width / scale * 0.75, h = cv.height / scale * 0.75; pages.push({ jpg: jpg, iw: cv.width, ih: cv.height, pw: w, ph: h, x: 0, y: 0, w: w, h: h }); }); });
        });
        return chain;
      }
      var land = !!opts.landscape, mm = opts.margin == null ? 12 : opts.margin, PWmm = land ? 297 : 210, PHmm = land ? 210 : 297;
      var W = Math.round((PWmm - 2 * mm) * PX), pageH = Math.floor((PHmm - 2 * mm) * PX), info = null;
      return html2canvas(document.body, Object.assign({}, common, { scale: 1, windowWidth: W, windowHeight: pageH, x: 0, y: 0, width: W, height: 2, onclone: function (doc) { return prepDoc(doc, opts, 1).then(function () { info = measure(doc, pageH); }); } })).then(function () {
        if (!info || !info.pages.length) throw new Error("there is nothing to print");
        var n = info.pages.length, chain = Promise.resolve();
        var shot = function (y, h) { return html2canvas(document.body, Object.assign({}, common, { windowWidth: W, windowHeight: pageH, x: 0, y: Math.floor(y), width: W, height: Math.max(1, Math.ceil(h)), onclone: function (doc) { return prepDoc(doc, opts, scale); } })); };
        info.pages.forEach(function (pg, i) {
          var h = Math.max(1, Math.ceil(pg.y1 - pg.y0)), hh = pg.head ? Math.ceil(pg.head.hBot - pg.head.hTop) : 0;
          chain = chain.then(function () { return step(i + 1, n); }).then(function () {
            if (!pg.head) return shot(pg.y0, h);
            if (pg.head.cv) return shot(pg.y0, h).then(function (body) { return [pg.head.cv, body]; });
            return shot(pg.head.hTop, hh).then(function (hc) { pg.head.cv = hc; return shot(pg.y0, h).then(function (body) { return [hc, body]; }); });
          }).then(function (res) {
            var cv = res;
            if (Array.isArray(res)) { cv = document.createElement("canvas"); cv.width = res[1].width; cv.height = res[0].height + res[1].height; var cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(res[0], 0, 0); cx.drawImage(res[1], 0, res[0].height); }
            return toJpeg(cv).then(function (jpg) { pages.push({ jpg: jpg, iw: cv.width, ih: cv.height, pw: PWmm * 72 / 25.4, ph: PHmm * 72 / 25.4, x: mm * 72 / 25.4, y: mm * 72 / 25.4, w: W * 0.75, h: cv.height / scale * 0.75 }); });
          });
        });
        return chain;
      });
    }).then(function () {
      var blob = buildPdf(pages), file = null, url = URL.createObjectURL(blob);
      try { file = new File([blob], name + ".pdf", { type: "application/pdf" }); } catch (e) {}
      window.__lastPdf = blob;
      T.textContent = "PDF ready"; M.textContent = pages.length + (pages.length === 1 ? " page. " : " pages. ") + "Tap “Print or share”, then choose Print – or Save to Files to keep the PDF.";
      var canShare = false; try { canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) {}
      if (canShare) { var s = btn("Print or share…", true); s.onclick = function () { navigator.share({ files: [file], title: name }).catch(function (e) { if (e && e.name !== "AbortError") M.textContent = "Sharing did not work here (" + (e.message || e.name) + "). Use “Open the PDF” instead."; }); }; B.appendChild(s); }
      var o = btn("Open the PDF", !canShare), a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; a.style.textDecoration = "none"; a.appendChild(o); B.appendChild(a);
      var sv = btn("Save the PDF file"), a2 = document.createElement("a"); a2.href = url; a2.download = name + ".pdf"; a2.style.textDecoration = "none"; a2.appendChild(sv); B.appendChild(a2);
      var c = btn("Close"); c.onclick = function () { box.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000); }; B.appendChild(c);
      try { window.dispatchEvent(new Event("afterprint")); } catch (e) {}
      return "pdf";
    });
    return work.catch(function (e) {
      T.textContent = "The PDF could not be made"; M.textContent = (e && e.message || String(e)) + ".";
      B.innerHTML = ""; var t = btn("Try the normal print", true); t.onclick = function () { box.remove(); window.print(); }; B.appendChild(t);
      var c = btn("Close"); c.onclick = function () { box.remove(); }; B.appendChild(c);
      try { window.dispatchEvent(new Event("afterprint")); } catch (x) {}
      return "error";
    });
  }

  window.SeaPrint = {
    needsPdf: needsPdf,
    print: function (opts) { opts = opts || {}; if (!needsPdf()) { window.print(); return Promise.resolve("native"); } return makePdf(opts); }
  };
})();
