// Shared database file for SeaTools apps (one <script src="../assets/shared.js" defer></script> per app).
//
// The app keeps its data in the browser as always. When a shared file is linked (Edge / Chrome on a PC), the data is also
// kept in ONE file on a network drive, so computers that see the same drive use the same data. No internet is needed.
//
// How it works
//  - The app gives the engine its data as a map of small records: snapshot() -> { recordId: plainObject }.
//  - The engine notices which records changed since the last time (by comparing a hash) and stamps them with the time.
//  - On every sync the shared file is read, merged record by record (the newest change wins, deletions are remembered)
//    and written back. Records that came from the file are handed to the app with apply({ recordId: object | null }).
//  - Nothing is lost when the drive is not reachable: the app keeps working on its own copy and syncs later.
(function () {
  if (window.SeaShared) return;
  var supported = typeof window.showSaveFilePicker === "function" && typeof window.showOpenFilePicker === "function";
  var lang = ((document.documentElement.lang || navigator.language || "en") + "").slice(0, 2).toLowerCase() === "pl" ? "pl" : "en";
  var T = {
    en: { title: "Shared file", intro: "Keep the data of %a in one file on a shared network drive, so every computer that sees the drive uses the same data. No internet is needed.",
          unsupported: "This browser cannot link a file. Use Microsoft Edge or Google Chrome on a PC.", create: "Create a new shared file…", open: "Open an existing shared file…",
          linked: "Linked file", last: "Last synced", never: "not yet", syncNow: "Sync now", reconnect: "Reconnect", stop: "Stop sharing", close: "Close",
          s_off: "Not shared", s_ok: "Shared – synced", s_busy: "Shared – syncing…", s_perm: "Shared – click to reconnect", s_err: "Shared – drive not reachable, will retry", s_unsup: "Shared file not available in this browser",
          note1: "Changes from both computers are merged. If two computers change the very same item at the same moment, the newest change wins, so the computer clocks should show the correct time.",
          note2: "Do not move, rename or delete the file while it is in use. Keep it on a drive that only authorised people can open: it contains your data as plain text.",
          note3: "If the drive is not reachable the app keeps working on this computer and syncs later.",
          wrongApp: "This file belongs to another app (%x). Choose or create a different file.", stopAsk: "Stop sharing? The data stays on this computer and in the file.", unreadable: "The file could not be read: %x" },
    pl: { title: "Wspólny plik", intro: "Trzymaj dane aplikacji %a w jednym pliku na wspólnym dysku sieciowym, żeby wszystkie komputery widzące ten dysk używały tych samych danych. Internet nie jest potrzebny.",
          unsupported: "Ta przeglądarka nie potrafi połączyć pliku. Użyj Microsoft Edge lub Google Chrome na PC.", create: "Utwórz nowy wspólny plik…", open: "Otwórz istniejący wspólny plik…",
          linked: "Połączony plik", last: "Ostatnia synchronizacja", never: "jeszcze nie było", syncNow: "Synchronizuj teraz", reconnect: "Połącz ponownie", stop: "Przestań udostępniać", close: "Zamknij",
          s_off: "Nie udostępniane", s_ok: "Udostępniane – zsynchronizowane", s_busy: "Udostępniane – synchronizacja…", s_perm: "Udostępniane – kliknij, aby połączyć ponownie", s_err: "Udostępniane – dysk niedostępny, spróbuję ponownie", s_unsup: "Wspólny plik niedostępny w tej przeglądarce",
          note1: "Zmiany z obu komputerów są łączone. Jeśli dwa komputery zmienią dokładnie to samo w tej samej chwili, wygrywa nowsza zmiana, więc zegary komputerów powinny pokazywać prawidłowy czas.",
          note2: "Nie przenoś, nie zmieniaj nazwy i nie usuwaj pliku, gdy jest używany. Trzymaj go na dysku dostępnym tylko dla upoważnionych osób: zawiera Twoje dane jako zwykły tekst.",
          note3: "Gdy dysk jest niedostępny, aplikacja działa dalej na tym komputerze i zsynchronizuje się później.",
          wrongApp: "Ten plik należy do innej aplikacji (%x). Wybierz lub utwórz inny plik.", stopAsk: "Przestać udostępniać? Dane zostają na tym komputerze i w pliku.", unreadable: "Nie można odczytać pliku: %x" }
  }[lang];

  // ---------- small helpers ----------
  function stable(o) {                       // JSON with sorted keys, so equal data always gives equal text
    if (o === null || typeof o !== "object") return JSON.stringify(o);
    if (Array.isArray(o)) return "[" + o.map(stable).join(",") + "]";
    return "{" + Object.keys(o).sort().filter(function (k) { return o[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ":" + stable(o[k]); }).join(",") + "}";
  }
  function hash(o) {                         // cyrb53
    var s = stable(o), h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  var mem = {};                              // handles kept in memory when the browser cannot store them
  function dbOpen() {
    return new Promise(function (res, rej) { var r = indexedDB.open("seatools-shared", 1); r.onupgradeneeded = function () { r.result.createObjectStore("h"); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; });
  }
  function idb(mode, fn) { return dbOpen().then(function (db) { return new Promise(function (res, rej) { var q = fn(db.transaction("h", mode).objectStore("h")); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }); }); }
  var idbGet = function (k) { return idb("readonly", function (s) { return s.get(k); }); };
  var idbPut = function (k, v) { return idb("readwrite", function (s) { return s.put(v, k); }); };
  var idbDel = function (k) { return idb("readwrite", function (s) { return s.delete(k); }); };

  // ---------- state ----------
  var cfg = null, handle = null, state = "off", detail = "", lastSync = 0, lastSeen = 0, busy = false, again = false, timer = null, poll = null, meta = {}, listeners = [];
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  function setState(s, d) {
    state = s; detail = d || "";
    var info = SeaShared.info();
    listeners.forEach(function (f) { try { f(info); } catch (e) {} });
    renderDlg();
  }
  function metaKey() { return "seatools-shared-meta-" + cfg.app; }
  function loadMeta() { try { meta = JSON.parse(localStorage.getItem(metaKey()) || "{}") || {}; } catch (e) { meta = {}; } }
  function saveMeta() { try { localStorage.setItem(metaKey(), JSON.stringify(meta)); } catch (e) {} }

  function track(cur) {                      // stamp changed records, remember deletions
    var now = Date.now(), id, m;
    for (id in cur) { m = meta[id]; var h = hash(cur[id]); if (!m || m.del || m.h !== h) meta[id] = { h: h, u: Math.max(now, (m ? m.u : 0) + 1) }; }
    for (id in meta) if (!(id in cur) && !meta[id].del) meta[id] = { del: 1, u: Math.max(now, meta[id].u + 1) };
  }
  function perm(ask) {
    if (!handle) return Promise.resolve(false);
    var o = { mode: "readwrite" };
    if (!handle.queryPermission) return Promise.resolve(true);                // e.g. a test double
    return handle.queryPermission(o).then(function (p) { if (p === "granted") return true; return ask ? handle.requestPermission(o).then(function (q) { return q === "granted"; }) : false; });
  }

  // ---------- the sync ----------
  function sync() {
    if (!cfg || !handle) return Promise.resolve();
    if (busy) { again = true; return Promise.resolve(); }
    busy = true; setState("busy");
    return perm(false).then(function (ok) {
      if (!ok) { setState("perm"); return; }
      return round(0).then(function () { lastSync = Date.now(); setState("ok"); });
    }).catch(function (e) {
      if (e && e.sea) setState("error", e.sea); else setState("error", (e && e.message) || "error");
    }).then(function () {
      busy = false;
      if (again) { again = false; setTimeout(sync, 300); }
    });
  }
  function round(n) {
    var cur = cfg.snapshot();
    track(cur);
    return handle.getFile().then(function (file) {
      return file.text().then(function (text) {
        var R = { app: cfg.app, format: 1, records: {} };
        if (text.trim()) {
          var j; try { j = JSON.parse(text); } catch (e) { throw { sea: T.unreadable.replace("%x", "not a valid file") }; }
          if (!j || typeof j.records !== "object") throw { sea: T.unreadable.replace("%x", "not a SeaTools file") };
          if (j.app && j.app !== cfg.app) throw { sea: T.wrongApp.replace("%x", j.app) };
          R = j;
        }
        var recs = R.records, pull = {}, pm = {}, pulled = false, push = false, pushedIds = [], id;
        var ids = {}; Object.keys(recs).concat(Object.keys(meta)).forEach(function (k) { ids[k] = 1; });
        for (id in ids) {
          var l = meta[id], r = recs[id];
          if (r && (!l || r.u > l.u)) { pull[id] = r.del ? null : r.d; pm[id] = r.del ? { del: 1, u: r.u } : { h: hash(r.d), u: r.u }; pulled = true; }      // remembered only when this round is final
          else if (l && (!r || l.u > r.u)) { recs[id] = l.del ? { u: l.u, del: 1 } : { u: l.u, d: cur[id] }; push = true; pushedIds.push(id); }
        }
        var after = Promise.resolve(file.lastModified);
        if (push || !text.trim()) {
          after = handle.getFile().then(function (f2) {
            if (f2.lastModified !== file.lastModified && n < 3) return "retry";          // somebody wrote meanwhile: start again
            return handle.createWritable().then(function (w) {
              return w.write(JSON.stringify({ app: cfg.app, format: 1, updated: Date.now(), records: recs })).then(function () { return w.close(); });
            }).then(function () { return handle.getFile(); }).then(function (f3) {
              return f3.text().then(function (t3) {                                       // did our records really survive? another computer may have written at the same moment
                var j3 = null; try { j3 = JSON.parse(t3); } catch (e) {}
                var lost = !j3 || pushedIds.some(function (k) { var x = j3.records && j3.records[k]; return !x || x.u < recs[k].u; });
                return lost && n < 3 ? "retry" : f3.lastModified;
              });
            });
          });
        }
        return after.then(function (mod) {
          if (mod === "retry") { saveMeta(); return round(n + 1); }
          lastSeen = mod;
          for (var k0 in pm) meta[k0] = pm[k0];
          if (pulled) {
            cfg.apply(pull);
            var cur2 = cfg.snapshot();                                                    // what the app really holds now
            for (var k in pull) if (meta[k] && !meta[k].del && cur2[k] !== undefined) meta[k].h = hash(cur2[k]);
          }
          saveMeta();
        });
      });
    });
  }

  // ---------- linking ----------
  var TYPES = [{ description: "SeaTools shared file (.json)", accept: { "application/json": [".json"] } }];
  function remember(h) {
    handle = h;
    return idbPut(cfg.app, h).catch(function () { mem[cfg.app] = h; });
  }
  function pick(kind) {
    var p = kind === "create" ? window.showSaveFilePicker({ suggestedName: "SeaTools-" + cfg.app + ".json", types: TYPES }) : window.showOpenFilePicker({ types: TYPES, multiple: false }).then(function (a) { return a[0]; });
    return p.then(function (h) { return remember(h).then(function () { return perm(true); }).then(function (ok) { if (!ok) { setState("perm"); return; } return sync().then(startPolling); }); })
      .catch(function (e) { if (e && e.name !== "AbortError") setState("error", e.message || String(e)); });
  }
  function startPolling() {
    clearInterval(poll);
    poll = setInterval(function () {
      if (!handle || busy || document.hidden || state === "perm") return;
      if (state === "error") { sync(); return; }                                      // the drive was away: try again, it also pushes what was written meanwhile
      handle.getFile().then(function (f) { if (f.lastModified !== lastSeen) sync(); }).catch(function () { setState("error", T.s_err); });
    }, 5000);
  }
  function unlink() {
    clearInterval(poll); handle = null; mem[cfg.app] = null;
    return idbDel(cfg.app).catch(function () {}).then(function () { setState("off"); });
  }

  // ---------- dialog ----------
  var dlg = null;
  function css() {
    if (document.getElementById("ssh-css")) return;
    var s = document.createElement("style"); s.id = "ssh-css";
    s.textContent = "#ssh{border:0;border-radius:16px;padding:0;width:min(520px,calc(100vw - 24px));max-height:calc(100dvh - 40px);background:#fff;color:#14232d;box-shadow:0 20px 60px rgba(0,0,0,.4);font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}" +
      "#ssh::backdrop{background:rgba(8,14,18,.55)}@media (prefers-color-scheme:dark){#ssh{background:#16222b;color:#e6edf2}#ssh .b{background:#0f1920;color:#e6edf2}}" +
      "#ssh .h{display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(128,140,150,.3)}#ssh h2{margin:0;font-size:18px;flex:1}" +
      "#ssh .c{padding:16px}#ssh p{margin:0 0 10px}#ssh small{display:block;color:#6b7a86;font-size:12.5px;margin:6px 0}" +
      "#ssh .st{padding:10px 12px;border-radius:10px;background:rgba(128,140,150,.15);margin:0 0 12px;font-weight:600}#ssh .st.ok{background:rgba(26,138,60,.18)}#ssh .st.bad{background:rgba(211,38,28,.16)}" +
      "#ssh .row{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}#ssh .b{border:0;border-radius:9px;min-height:42px;padding:0 14px;font:600 14.5px inherit;font-family:inherit;background:#eef1f4;color:#14232d;cursor:pointer}" +
      "#ssh .b.pri{background:#0b6bcb;color:#fff}#ssh .b.red{color:#c62828}";
    document.head.appendChild(s);
  }
  function stateText() { return { off: T.s_off, ok: T.s_ok, busy: T.s_busy, perm: T.s_perm, error: T.s_err }[state] || T.s_off; }
  function renderDlg() {
    if (!dlg || !dlg.open) return;
    var linked = !!handle, cls = state === "ok" ? "ok" : (state === "error" || state === "perm") ? "bad" : "";
    var h = '<div class="h"><h2>' + T.title + " – " + esc(cfg.title) + '</h2><button class="b" data-x="close">' + T.close + '</button></div><div class="c">';
    if (!supported) h += '<div class="st bad">' + T.s_unsup + "</div><p>" + T.unsupported + "</p>";
    else {
      h += '<div class="st ' + cls + '">' + esc(stateText()) + (detail && state === "error" ? " – " + esc(detail) : "") + "</div>";
      if (!linked) h += "<p>" + T.intro.replace("%a", esc(cfg.title)) + '</p><div class="row"><button class="b pri" data-x="create">' + T.create + '</button><button class="b" data-x="open">' + T.open + "</button></div>";
      else h += "<p><b>" + T.linked + ":</b> " + esc(handle.name || "") + "<br><b>" + T.last + ":</b> " + (lastSync ? new Date(lastSync).toLocaleTimeString() : T.never) + '</p><div class="row"><button class="b pri" data-x="sync">' + (state === "perm" ? T.reconnect : T.syncNow) + '</button><button class="b red" data-x="stop">' + T.stop + "</button></div>";
      h += "<small>" + T.note1 + "</small><small>" + T.note2 + "</small><small>" + T.note3 + "</small>";
    }
    dlg.innerHTML = h + "</div>";
  }
  function openDlg() {
    css();
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.id = "ssh"; document.body.appendChild(dlg);
      dlg.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-x]");
        if (e.target === dlg) return dlg.close();
        if (!b) return;
        var x = b.dataset.x;
        if (x === "close") dlg.close();
        else if (x === "create" || x === "open") pick(x);
        else if (x === "sync") perm(true).then(function (ok) { if (ok) sync().then(startPolling); else setState("perm"); });
        else if (x === "stop") { if (confirm(T.stopAsk)) unlink(); }
      });
    }
    renderDlg(); if (!dlg.open) dlg.showModal(); renderDlg();
  }

  // ---------- public API ----------
  var changeT = null;
  var SeaShared = window.SeaShared = {
    supported: supported,
    init: function (c) {
      cfg = c; loadMeta(); if (!supported) { setState("unsupported"); return; }
      var got = mem[cfg.app] ? Promise.resolve(mem[cfg.app]) : idbGet(cfg.app).catch(function () { return null; });
      got.then(function (h) {
        if (!h) { setState("off"); return; }
        handle = h; setState("busy");
        perm(false).then(function (ok) { if (!ok) { setState("perm"); startPolling(); return; } sync().then(startPolling); });
      });
      document.addEventListener("visibilitychange", function () { if (!document.hidden && handle && !busy && state !== "perm") sync(); });
    },
    changed: function () { if (!handle) return; clearTimeout(changeT); changeT = setTimeout(sync, 800); },
    sync: sync,
    open: openDlg,
    linked: function () { return !!handle; },
    reconnect: function () { return perm(true).then(function (ok) { if (ok) return sync().then(startPolling); setState("perm"); }); },
    onState: function (f) { listeners.push(f); },
    info: function () { return { supported: supported, linked: !!handle, state: state === "unsupported" ? "off" : state, text: !supported ? T.s_unsup : stateText(), name: handle ? handle.name : "", lastSync: lastSync, detail: detail }; },
    _test: { setHandle: function (h) { return remember(h).then(function () { return sync().then(startPolling); }); } }
  };
})();
