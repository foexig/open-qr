// Applied before first paint to avoid a theme flash.
(function () {
  var t = null;
  try { t = localStorage.getItem("openqr-theme"); } catch (e) { /* storage blocked */ }
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
})();
