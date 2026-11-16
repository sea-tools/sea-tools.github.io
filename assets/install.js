// "Install this app" card, shared by all SeaTools apps (one <script src="../assets/install.js" defer></script> per app).
// - Chrome / Edge / Android Chrome / Samsung Internet: a real Install button (the browser's own install prompt).
// - Safari, iPad / iPhone: these browsers cannot be asked to install, so the card shows the steps instead.
// - Browsers that cannot install apps (e.g. Firefox on PC): nothing is shown.
// The card is never shown inside an installed app, and "Not now" hides it for 30 days.
(function () {
  var ua = navigator.userAgent || "";
  var standalone = (window.matchMedia && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: minimal-ui)").matches || matchMedia("(display-mode: window-controls-overlay)").matches)) || navigator.standalone === true;
  if (standalone) return;

  var lang = ((document.documentElement.lang || navigator.language || "en") + "").slice(0, 2).toLowerCase() === "pl" ? "pl" : "en";
  var T = {
    en: { none: "Nothing to install here. The app may already be installed on this device. You can also use the browser menu: Edge ⋮ → Apps → Install this site as an app; Chrome ⋮ → Save and share → Install page as app.",
          unsupported: "This browser cannot install apps. Open this page in Chrome, Edge or Safari.", title: "Install ", via: "Installs in %b on this device only, as its own app with its own icon.", install: "Install", later: "Not now", ok: "Got it",
          ios: "Tap Share, then “Add to Home Screen”. It is saved on this device only.", mac: "In Safari choose File → Add to Dock. It is saved on this Mac only.",
          here: "this browser" },
    pl: { none: "Nie ma tu czego instalować. Aplikacja może być już zainstalowana na tym urządzeniu. Możesz też użyć menu przeglądarki: Edge ⋮ → Aplikacje → Zainstaluj tę witrynę jako aplikację; Chrome ⋮ → Zapisz i udostępnij → Zainstaluj stronę jako aplikację.",
          unsupported: "Ta przeglądarka nie potrafi instalować aplikacji. Otwórz tę stronę w Chrome, Edge lub Safari.", title: "Zainstaluj ", via: "Instaluje się w %b, tylko na tym urządzeniu, jako osobna aplikacja z własną ikoną.", install: "Zainstaluj", later: "Nie teraz", ok: "OK",
          ios: "Dotknij Udostępnij, potem „Dodaj do ekranu początkowego”. Zapisze się tylko na tym urządzeniu.", mac: "W Safari wybierz Plik → Dodaj do Docka. Zapisze się tylko na tym Macu.",
          here: "tej przeglądarce" }
  }[lang];

  var browser = /Edg\//.test(ua) ? "Microsoft Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : T.here;
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);     // iPadOS reports itself as a Mac
  var isMacSafari = !isIOS && /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|CriOS|Edg|OPR|Firefox/.test(ua);

  var explicit = /[?&]install=1(&|$)/.test(location.search);       // opened with the "Install" button of a tile on the home page
  if (explicit && history.replaceState) history.replaceState(null, "", location.pathname + location.search.replace(/([?&])install=1&?/, "$1").replace(/[?&]$/, "") + location.hash);
  var canHere = /Chrome\/|CriOS|Edg\/|OPR\/|SamsungBrowser/.test(ua) && !/Firefox/.test(ua) || isIOS || isMacSafari;
  var app = (location.pathname.replace(/^\/|\/$/g, "").split("/").pop() || "home");
  var KEY = "seatools-install-hidden-" + app;
  function hidden() { try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < 30 * 864e5; } catch (e) { return false; } }
  function hide30() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} }

  var evt = null, card = null, meta = { name: "", icon: "" };
  function loadMeta() {
    var l = document.querySelector('link[rel="manifest"]');
    if (!l) return Promise.resolve();
    return fetch(l.href).then(function (r) { return r.json(); }).then(function (m) {
      meta.name = m.name || m.short_name || "";
      if (m.icons && m.icons[0]) meta.icon = new URL(m.icons[0].src, l.href).href;
    }).catch(function () {});
  }

  function css() {
    if (document.getElementById("sti-css")) return;
    var s = document.createElement("style"); s.id = "sti-css";
    s.textContent = ".sti{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483000;width:min(460px,calc(100vw - 24px));" +
      "background:#14232d;color:#fff;border-radius:16px;padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.4);display:grid;grid-template-columns:44px 1fr;gap:4px 12px;" +
      "font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}" +
      ".sti img{width:44px;height:44px;border-radius:10px;grid-row:1 / span 2;object-fit:cover}.sti b{font-size:15px;align-self:end}.sti p{margin:0;color:#c5d1d9;font-size:13px;grid-column:2}" +
      ".sti .acts{grid-column:1 / -1;display:flex;gap:8px;justify-content:flex-end;margin-top:8px}" +
      ".sti button{min-height:40px;border:0;border-radius:10px;padding:0 16px;font:600 14px inherit;font-family:inherit;cursor:pointer}" +
      ".sti .go{background:#fff;color:#14232d}.sti .no{background:rgba(255,255,255,.14);color:#fff}@media print{.sti{display:none!important}}";
    document.head.appendChild(s);
  }
  function close() { if (card) { card.remove(); card = null; } }
  function show(mode, msg) {       // mode: "prompt" (real install button) | "steps" (instructions only) | "info" (a message with OK)
    if (card) return;
    css();
    card = document.createElement("div"); card.className = "sti"; card.setAttribute("role", "dialog");
    var name = meta.name || document.title || "";
    card.setAttribute("aria-label", T.title + name);
    var body = mode === "info" ? msg : mode === "prompt" ? T.via.replace("%b", browser) : (isMacSafari ? T.mac : T.ios);
    card.innerHTML = (meta.icon ? '<img alt="" src="' + meta.icon + '">' : "<span></span>") + "<b></b><p></p>" +
      '<div class="acts"><button class="no" type="button"></button>' + (mode === "prompt" ? '<button class="go" type="button"></button>' : "") + "</div>";
    card.querySelector("b").textContent = T.title + name;
    card.querySelector("p").textContent = body;
    card.querySelector(".no").textContent = mode === "prompt" ? T.later : T.ok;
    card.querySelector(".no").onclick = function () { if (mode !== "info") hide30(); close(); };
    var go = card.querySelector(".go");
    if (go) { go.textContent = T.install; go.onclick = run; }
    document.body.appendChild(card);
  }
  function run() {                 // the Install button, also usable from an app's own menu
    if (evt) { var e = evt; evt = null; close(); e.prompt(); return e.userChoice.catch(function () {}); }
    if (isIOS || isMacSafari) show("steps");
  }
  window.SeaInstall = { run: run, canInstall: function () { return !!evt || isIOS || isMacSafari; }, browser: browser };

  var noneTimer = null;
  addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); evt = e; clearTimeout(noneTimer);
    if (explicit) loadMeta().then(function () { if (evt) show("prompt"); });
    else if (!hidden()) loadMeta().then(function () { setTimeout(function () { if (evt) show("prompt"); }, 2500); });
  });
  addEventListener("appinstalled", function () { evt = null; close(); });
  if ((isIOS || isMacSafari) && (explicit || !hidden())) {
    addEventListener("load", function () { loadMeta().then(function () { setTimeout(function () { show("steps"); }, explicit ? 300 : 4000); }); });
  }
  if (explicit) {                  // the user asked to install: never leave them without an answer
    addEventListener("load", function () {
      if (!canHere) { loadMeta().then(function () { show("info", T.unsupported); }); }
      else if (!isIOS && !isMacSafari) { noneTimer = setTimeout(function () { if (!evt && !card) loadMeta().then(function () { show("info", T.none); }); }, 3500); }
    });
  }
})();
