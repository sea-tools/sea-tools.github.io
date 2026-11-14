// Anonymous visit counter (GoatCounter): no cookies, no personal data.
// Counts page opens and home-screen installs. Only the site owner sees the numbers.
(function () {
  var CODE = "sea-tools"; // GoatCounter site code, e.g. "sea-tools". Empty = counting off.
  if (!CODE) return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", "https://" + CODE + ".goatcounter.com/count");
  document.head.appendChild(s);
  addEventListener("appinstalled", function () {
    var app = location.pathname.replace(/^\/|\/$/g, "").replace(/\/index\.html$/, "") || "home";
    if (window.goatcounter && window.goatcounter.count) {
      window.goatcounter.count({ path: "install/" + app, title: "Installed: " + app, event: true });
    }
  });
})();
