// "Install this app" card, shared by all SeaTools apps (one <script src="../assets/install.js" defer></script> per app).
// It never appears by itself. It opens when:
//  - the app is opened from the "Install" button of its tile on the home page (address ends with ?install=1), or
//  - an app calls window.SeaInstall.run() from its own menu (DP Logbook: Settings → Help).
// Chrome / Edge / Android / Samsung Internet: a real Install button (the browser's own install prompt).
// Safari on iPad / iPhone / Mac cannot be asked to install, so the card shows the steps. Other browsers: a short message.
// After an install the card tells where the app can be found and how to pin it.
(function () {
  var ua = navigator.userAgent || "";
  var standalone = (window.matchMedia && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: minimal-ui)").matches || matchMedia("(display-mode: window-controls-overlay)").matches)) || navigator.standalone === true;
  if (standalone) return;                                              // already running as an installed app

  var lang = ((document.documentElement.lang || navigator.language || "en") + "").slice(0, 2).toLowerCase() === "pl" ? "pl" : "en";
  var T = {
    en: { title: "Install ", via: "Installs in %b on this device only, as its own app with its own icon. Afterwards open it from %w.", install: "Install", later: "Not now", ok: "OK",
          ios: "Tap Share, then “Add to Home Screen”. It is saved on this device only. You will find the icon on your home screen.", mac: "In Safari choose File → Add to Dock. It is saved on this Mac only. You will find it in the Dock and in Launchpad.",
          none: "Nothing to install here. The app may already be installed on this device. You can also use the browser menu: Edge ⋮ → Apps → Install this site as an app; Chrome ⋮ → Save and share → Install page as app.",
          unsupported: "This browser cannot install apps. Open this page in Chrome, Edge or Safari.", here: "this browser",
          wWin: "the Start menu", wMac: "Launchpad", wAndroid: "your home screen or app drawer", wOther: "your apps list",
          doneTitle: " installed",
          doneWin: "Find it in the Start menu: type its name. Right-click it there → Pin to taskbar. For a desktop shortcut drag its icon from the Start menu to the desktop. In Edge you can also tick “Pin to taskbar” and “Create desktop shortcut” in the “App installed” box.",
          doneMac: "Find it in Launchpad or in the Applications folder (Chrome Apps / Edge Apps). To keep it in the Dock: right-click its Dock icon → Options → Keep in Dock.",
          doneAndroid: "Find it on your home screen or in the app drawer. Long-press the icon to move it.", doneOther: "Find it in your apps list." },
    pl: { title: "Zainstaluj ", via: "Instaluje się w %b, tylko na tym urządzeniu, jako osobna aplikacja z własną ikoną. Potem otworzysz ją z: %w.", install: "Zainstaluj", later: "Nie teraz", ok: "OK",
          ios: "Dotknij Udostępnij, potem „Dodaj do ekranu początkowego”. Zapisze się tylko na tym urządzeniu. Ikonę znajdziesz na ekranie głównym.", mac: "W Safari wybierz Plik → Dodaj do Docka. Zapisze się tylko na tym Macu. Znajdziesz ją w Docku i w Launchpadzie.",
          none: "Nie ma tu czego instalować. Aplikacja może być już zainstalowana na tym urządzeniu. Możesz też użyć menu przeglądarki: Edge ⋮ → Aplikacje → Zainstaluj tę witrynę jako aplikację; Chrome ⋮ → Zapisz i udostępnij → Zainstaluj stronę jako aplikację.",
          unsupported: "Ta przeglądarka nie potrafi instalować aplikacji. Otwórz tę stronę w Chrome, Edge lub Safari.", here: "tej przeglądarce",
          wWin: "menu Start", wMac: "Launchpada", wAndroid: "ekranu głównego lub listy aplikacji", wOther: "listy aplikacji",
          doneTitle: " – zainstalowano",
          doneWin: "Znajdziesz ją w menu Start: wpisz jej nazwę. Kliknij ją tam prawym przyciskiem → Przypnij do paska zadań. Skrót na pulpicie: przeciągnij ikonę z menu Start na pulpit. W Edge możesz też zaznaczyć „Przypnij do paska zadań” i „Utwórz skrót na pulpicie” w okienku „Zainstalowano aplikację”.",
          doneMac: "Znajdziesz ją w Launchpadzie lub w folderze Programy (Chrome Apps / Edge Apps). Żeby zostawić w Docku: prawy przycisk na ikonie w Docku → Opcje → Zostaw w Docku.",
          doneAndroid: "Znajdziesz ją na ekranie głównym lub na liście aplikacji. Przytrzymaj ikonę, żeby ją przesunąć.", doneOther: "Znajdziesz ją na liście aplikacji." }
  }[lang];

  var browser = /Edg\//.test(ua) ? "Microsoft Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : T.here;
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);     // iPadOS reports itself as a Mac
  var isMac = !isIOS && /Macintosh/.test(ua), isWin = /Windows/.test(ua), isAndroid = /Android/.test(ua);
  var isMacSafari = isMac && /Safari/.test(ua) && !/Chrome|CriOS|Edg|OPR|Firefox/.test(ua);
  var canHere = (/Chrome\/|CriOS|Edg\/|OPR\/|SamsungBrowser/.test(ua) && !/Firefox/.test(ua)) || isIOS || isMacSafari;
  var where = isWin ? T.wWin : isMac ? T.wMac : isAndroid ? T.wAndroid : T.wOther;
  var doneText = isWin ? T.doneWin : isMac ? T.doneMac : isAndroid ? T.doneAndroid : T.doneOther;

  var explicit = /[?&]install=1(&|$)/.test(location.search);       // opened with the "Install" button of a tile on the home page
  if (explicit && window.history && history.replaceState) history.replaceState(null, "", location.pathname + location.search.replace(/([?&])install=1&?/, "$1").replace(/[?&]$/, "") + location.hash);

  var evt = null, card = null, noneTimer = null, meta = { name: "", icon: "" };
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
  function show(mode, msg, title) {   // mode: "prompt" (Install button) | "steps" (instructions) | "info" (a message with OK)
    close(); css();
    card = document.createElement("div"); card.className = "sti"; card.setAttribute("role", "dialog");
    var name = meta.name || document.title || "";
    var head = title || (T.title + name);
    card.setAttribute("aria-label", head);
    var body = mode === "info" ? msg : mode === "prompt" ? T.via.replace("%b", browser).replace("%w", where) : (isMacSafari ? T.mac : T.ios);
    card.innerHTML = (meta.icon ? '<img alt="" src="' + meta.icon + '">' : "<span></span>") + "<b></b><p></p>" +
      '<div class="acts"><button class="no" type="button"></button>' + (mode === "prompt" ? '<button class="go" type="button"></button>' : "") + "</div>";
    card.querySelector("b").textContent = head;
    card.querySelector("p").textContent = body;
    card.querySelector(".no").textContent = mode === "prompt" ? T.later : T.ok;
    card.querySelector(".no").onclick = close;
    var go = card.querySelector(".go");
    if (go) { go.textContent = T.install; go.onclick = run; }
    document.body.appendChild(card);
  }
  function run() {                     // the Install button, also usable from an app's own menu
    if (evt) { var e = evt; evt = null; close(); e.prompt(); return e.userChoice.catch(function () {}); }
    loadMeta().then(function () {
      if (isIOS || isMacSafari) show("steps");
      else if (canHere) show("info", T.none); else show("info", T.unsupported);
    });
  }
  window.SeaInstall = { run: run, canInstall: function () { return canHere; }, browser: browser };

  addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); evt = e; clearTimeout(noneTimer);                         // kept for the Install button; nothing pops up by itself
    if (explicit) loadMeta().then(function () { if (evt) show("prompt"); });
  });
  addEventListener("appinstalled", function () {
    evt = null;
    loadMeta().then(function () { show("info", doneText, (meta.name || document.title || "") + T.doneTitle); });
  });
  if (explicit) addEventListener("load", function () {   // the user pressed Install: always give an answer
    if (!canHere) loadMeta().then(function () { show("info", T.unsupported); });
    else if (isIOS || isMacSafari) loadMeta().then(function () { setTimeout(function () { show("steps"); }, 300); });
    else noneTimer = setTimeout(function () { if (!evt && !card) loadMeta().then(function () { show("info", T.none); }); }, 3500);
  });
})();
