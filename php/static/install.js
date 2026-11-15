// open-qr installer: step wizard + animated terminal log. No dependencies.
(function () {
  "use strict";

  var API = "index.php?r=api/install/";

  // ------------------------------------------------------------ i18n

  var T = {
    de: {
      setup: "Einrichtung", step_check: "Prüfen", step_admin: "Admin", step_db: "Datenbank", step_done: "Fertig",
      welcome_title: "Willkommen bei open-qr",
      welcome_lead: "Dein eigener QR-Code-Generator mit änderbaren Zielen und Scan-Statistik. Drei kurze Schritte, dann geht's los.",
      next: "Weiter", back: "Zurück", install: "Installieren", optional: "optional", recommended: "empfohlen",
      admin_title: "Dein Admin-Konto",
      admin_lead: "Damit meldest du dich später an. Das Passwort wird nur gehasht gespeichert.",
      username: "Benutzername", username_hint: "3–64 Zeichen: Buchstaben, Ziffern, . _ -",
      email: "E-Mail", password: "Passwort", password2: "Passwort wiederholen", password_hint: "Mindestens 10 Zeichen",
      db_title: "Adresse & Datenbank",
      db_lead: "Die Adresse steckt später in jedem QR-Code. Bei SQLite musst du nichts weiter einrichten.",
      base_url: "Öffentliche Adresse", base_url_hint: "Kurz-Links sehen so aus:",
      timezone: "Zeitzone für Statistiken",
      sqlite_hint: "Eine Datei im Ordner data/. Null Konfiguration.",
      mysql_hint: "Zugangsdaten aus dem Strato-Datenbank-Menü.",
      db_name: "Datenbank", db_user: "Benutzer",
      done_title: "Alles bereit!", done_lead: "open-qr läuft. Du bist schon angemeldet. So geht es weiter:",
      g1_t: "QR-Code anlegen", g1: "Name und Ziel-URL eingeben – fertig ist der Code.",
      g2_t: "Drucken & teilen", g2: "Als PNG oder SVG herunterladen. Der Code zeigt auf deinen Kurz-Link.",
      g3_t: "Ziel jederzeit ändern", g3: "Der gedruckte Code bleibt gleich, nur das Ziel wechselt.",
      g4_t: "Scans verfolgen", g4: "Tage, Wochen, Geräte – ohne Tracking-Cookies.",
      open_dashboard: "Zum Dashboard", footer: "Open Source",
      c_php: "PHP-Version", c_pdo_sqlite: "SQLite-Treiber", c_pdo_mysql: "MySQL-Treiber", c_zlib: "zlib (PNG-Export)",
      c_mbstring: "mbstring", c_data_writable: "Ordner data/ beschreibbar", c_argon2: "Argon2id-Passwort-Hashing",
      c_https: "HTTPS aktiv", c_rewrite: "Saubere URLs (mod_rewrite)", c_protect: "data/ & lib/ geschützt",
      pw_weak: "Schwach", pw_ok: "Okay", pw_good: "Gut", pw_strong: "Stark",
      e_username: "Benutzername: 3–64 Zeichen, nur Buchstaben, Ziffern, . _ -",
      e_email: "Diese E-Mail-Adresse sieht ungültig aus.",
      e_password: "Das Passwort braucht mindestens 10 Zeichen.",
      e_password2: "Die Passwörter stimmen nicht überein.",
      e_base_url: "Bitte die vollständige Adresse eingeben, z. B. https://qr.example.com",
      e_mysql: "Bitte Host, Datenbank und Benutzer ausfüllen.",
      e_network: "Server nicht erreichbar. Läuft PHP?",
      n_fail: "Der Server erfüllt nicht alle Voraussetzungen. Bei Strato: PHP-Version in der Hosting-Verwaltung auf 8.1 oder neuer stellen.",
      n_rewrite: "Saubere URLs funktionieren nicht – Kurz-Links (/r/…) gehen so nicht. Prüfe, ob die versteckte Datei .htaccess mit hochgeladen wurde.",
      n_protect: "Achtung: data/ oder lib/ ist öffentlich lesbar. Die .htaccess-Dateien fehlen oder werden ignoriert.",
      n_https: "Tipp: Aktiviere SSL für deine Domain (bei Strato kostenlos), sonst werden Logins unverschlüsselt übertragen.",
      t_boot: "open-qr Installer", t_checking: "Server wird geprüft", t_checks_ok: "Alle Voraussetzungen erfüllt",
      t_checks_fail: "Voraussetzungen fehlen", t_wait_admin: "Warte auf Admin-Konto …", t_admin_ok: "Admin-Konto vorgemerkt",
      t_wait_db: "Warte auf Datenbank-Auswahl …", t_installing: "Installation läuft",
      s_db: "Datenbank verbunden", s_schema: "Tabellen angelegt", s_admin: "Admin erstellt", s_protect: "data/ abgesichert",
      s_config: "Konfiguration geschrieben", s_login: "Angemeldet",
      t_done: "open-qr ist bereit.", t_open: "Dashboard", t_failed: "Installation abgebrochen"
    },
    en: {
      setup: "Setup", step_check: "Check", step_admin: "Admin", step_db: "Database", step_done: "Done",
      welcome_title: "Welcome to open-qr",
      welcome_lead: "Your own QR code generator with editable targets and scan stats. Three short steps and you're live.",
      next: "Next", back: "Back", install: "Install", optional: "optional", recommended: "recommended",
      admin_title: "Your admin account",
      admin_lead: "You'll sign in with this. The password is only stored as a hash.",
      username: "Username", username_hint: "3–64 characters: letters, digits, . _ -",
      email: "Email", password: "Password", password2: "Repeat password", password_hint: "At least 10 characters",
      db_title: "Address & database",
      db_lead: "The address ends up in every QR code. With SQLite there is nothing else to set up.",
      base_url: "Public address", base_url_hint: "Short links will look like this:",
      timezone: "Time zone for statistics",
      sqlite_hint: "A single file in data/. Zero configuration.",
      mysql_hint: "Credentials from your host's database panel.",
      db_name: "Database", db_user: "User",
      done_title: "All set!", done_lead: "open-qr is running and you're already signed in. Here's how it works:",
      g1_t: "Create a QR code", g1: "Enter a name and a target URL – done.",
      g2_t: "Print & share", g2: "Download as PNG or SVG. The code points at your short link.",
      g3_t: "Change the target anytime", g3: "The printed code stays the same, only the destination changes.",
      g4_t: "Track scans", g4: "Days, weeks, devices – no tracking cookies.",
      open_dashboard: "Open dashboard", footer: "Open source",
      c_php: "PHP version", c_pdo_sqlite: "SQLite driver", c_pdo_mysql: "MySQL driver", c_zlib: "zlib (PNG export)",
      c_mbstring: "mbstring", c_data_writable: "data/ folder writable", c_argon2: "Argon2id password hashing",
      c_https: "HTTPS active", c_rewrite: "Clean URLs (mod_rewrite)", c_protect: "data/ & lib/ protected",
      pw_weak: "Weak", pw_ok: "Okay", pw_good: "Good", pw_strong: "Strong",
      e_username: "Username: 3–64 characters, letters, digits, . _ - only",
      e_email: "This email address looks invalid.",
      e_password: "The password needs at least 10 characters.",
      e_password2: "The passwords do not match.",
      e_base_url: "Enter the full address, e.g. https://qr.example.com",
      e_mysql: "Please fill in host, database and user.",
      e_network: "Server not reachable. Is PHP running?",
      n_fail: "The server does not meet all requirements. Switch your hosting to PHP 8.1 or newer.",
      n_rewrite: "Clean URLs don't work, so short links (/r/…) won't either. Check that the hidden .htaccess file was uploaded.",
      n_protect: "Warning: data/ or lib/ is publicly readable. The .htaccess files are missing or ignored.",
      n_https: "Tip: enable SSL for your domain, otherwise logins travel unencrypted.",
      t_boot: "open-qr installer", t_checking: "Checking server", t_checks_ok: "All requirements met",
      t_checks_fail: "Requirements missing", t_wait_admin: "Waiting for admin account …", t_admin_ok: "Admin account noted",
      t_wait_db: "Waiting for database choice …", t_installing: "Installing",
      s_db: "Database connected", s_schema: "Tables created", s_admin: "Admin created", s_protect: "data/ locked down",
      s_config: "Configuration written", s_login: "Signed in",
      t_done: "open-qr is ready.", t_open: "Dashboard", t_failed: "Installation aborted"
    }
  };

  var lang = "en";
  try { lang = localStorage.getItem("openqr-lang") || ""; } catch (e) { /* storage blocked */ }
  if (!T[lang]) lang = /^de\b/i.test(navigator.language || "") ? "de" : "en";

  function t(key) { return T[lang][key] || T.en[key] || key; }

  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-lang]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.lang === lang)); });
    renderChecks();
    updateMeter();
  }

  // ------------------------------------------------------------ terminal

  var term = document.getElementById("term");
  var cursor = document.createElement("span");
  cursor.className = "cursor";
  term.appendChild(cursor);
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var queue = Promise.resolve();

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, reduced ? 0 : ms); }); }
  function scroll() { term.scrollTop = term.scrollHeight; }

  // Queue an async terminal action so output never interleaves.
  function run(fn) { queue = queue.then(fn, fn); return queue; }

  function span(text, cls) {
    var s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text || "";
    term.insertBefore(s, cursor);
    return s;
  }

  async function typeInto(el, text, speed) {
    for (var i = 0; i < text.length; i++) {
      el.textContent += text[i];
      if (i % 2 === 0) { scroll(); await sleep(speed); }
    }
  }

  // segments: [[text, cls], ...]; typed when speed > 0, otherwise printed at once
  function print(segments, speed) {
    return run(async function () {
      for (var i = 0; i < segments.length; i++) {
        var s = span("", segments[i][1]);
        if (speed) await typeInto(s, segments[i][0], speed);
        else s.textContent = segments[i][0];
      }
      span("\n");
      scroll();
    });
  }

  function cmd(text) {
    return run(async function () {
      span("❯ ", "t-prompt");
      await typeInto(span("", "t-cmd"), text, 18);
      span("\n");
      await sleep(180);
    });
  }

  // A line with a spinner until `promise` settles; resolves with the promise's value.
  function task(label, promise) {
    var result;
    return run(async function () {
      var ico = span("", "spin");
      span(" " + label);
      var tail = span("");
      scroll();
      try {
        result = await promise;
        ico.className = "t-ok";
        ico.textContent = "✓";
      } catch (e) {
        ico.className = "t-err";
        ico.textContent = "✗";
        tail.className = "t-err";
        tail.textContent = "  " + (e && e.message ? e.message : e);
        span("\n");
        throw e;
      }
      span("\n");
    }).then(function () { return result; });
  }

  async function progress(promise) {
    var line = span("");
    var bar = 28;
    var pos = 0;
    var finished = false;
    promise.then(function () { finished = true; }, function () { finished = true; });
    while (!finished || pos < bar) {
      // Creep towards ~85% while waiting, then fill up once the server is done.
      if (finished) pos = Math.min(bar, pos + 3);
      else if (pos < bar * 0.85) pos += 1;
      line.innerHTML = "";
      var a = document.createElement("span"); a.className = "bar-fill"; a.textContent = "█".repeat(pos);
      var b = document.createElement("span"); b.className = "bar-track"; b.textContent = "░".repeat(bar - pos);
      var c = document.createElement("span"); c.className = "t-dim"; c.textContent = " " + String(Math.round(pos / bar * 100)).padStart(3) + "%";
      line.append("  ", a, b, c);
      scroll();
      await sleep(finished ? 25 : 90);
      if (reduced && finished) pos = bar;
    }
    span("\n");
  }

  var BANNER = [
    " ┌─┐┌─┐┌─┐┌┐┌   ┌─┐ ┬─┐",
    " │ │├─┘├┤ │││───│─┼┐├┬┘",
    " └─┘┴  └─┘┘└┘   └─┘└┴└─"
  ].join("\n");

  // ------------------------------------------------------------ api

  async function api(path, opts) {
    var res;
    try {
      res = await fetch(API + path, Object.assign({ cache: "no-store", credentials: "same-origin" }, opts || {}));
    } catch (e) {
      throw new Error(t("e_network"));
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      var err = new Error(detailText(data && data.detail) || ("HTTP " + res.status));
      err.status = res.status;
      err.field = Array.isArray(data && data.detail) && data.detail[0] && data.detail[0].loc ? data.detail[0].loc.slice(-1)[0] : null;
      throw err;
    }
    return data;
  }

  function detailText(d) {
    if (!d) return "";
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map(function (x) { return x.msg; }).join(" · ");
    return String(d);
  }

  async function probe(url) {
    try {
      var r = await fetch(url, { cache: "no-store", credentials: "omit", redirect: "manual" });
      return r;
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------ steps

  var state = { check: null, client: {}, step: 1 };

  function go(step) {
    state.step = step;
    document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("hidden", Number(v.dataset.view) !== step); });
    document.querySelectorAll(".steps li").forEach(function (li) {
      var n = Number(li.dataset.step);
      li.classList.toggle("active", n === step);
      li.classList.toggle("done", n < step);
    });
    var first = document.querySelector('.view[data-view="' + step + '"] input:not([type=radio])');
    if (first && window.innerWidth > 920) first.focus();
  }

  document.querySelectorAll("[data-back]").forEach(function (b) {
    b.addEventListener("click", function () { go(Number(b.dataset.back)); });
  });

  // ------------------------------------------------------------ step 1: checks

  var checksEl = document.getElementById("checks");
  var noticeEl = document.getElementById("check-notice");

  function checkRows() {
    var rows = [];
    if (state.check) {
      state.check.items.forEach(function (i) {
        if (i.id === "pdo_mysql" && !i.ok) return; // optional, only mention when present
        var status = i.ok ? "ok" : (i.required || (i.id === "pdo_sqlite" && !state.check.drivers.mysql) ? "fail" : "warn");
        rows.push({ id: i.id, status: status, value: i.id === "php" ? i.value : "" });
      });
    }
    if ("rewrite" in state.client) rows.push({ id: "rewrite", status: state.client.rewrite ? "ok" : "warn", value: "" });
    if ("protect" in state.client) rows.push({ id: "protect", status: state.client.protect ? "ok" : "warn", value: "" });
    return rows;
  }

  function renderChecks() {
    if (!state.check) return;
    checksEl.innerHTML = "";
    checkRows().forEach(function (r) {
      var li = document.createElement("li");
      li.className = r.status;
      var ico = document.createElement("span"); ico.className = "ico"; ico.textContent = r.status === "ok" ? "✓" : r.status === "warn" ? "!" : "✗";
      var label = document.createElement("span"); label.textContent = t("c_" + r.id);
      var val = document.createElement("span"); val.className = "val"; val.textContent = r.value;
      li.append(ico, label, val);
      checksEl.appendChild(li);
    });
    var notes = [];
    var bad = false;
    if (!state.check.ok) { notes.push(t("n_fail")); bad = true; }
    if (state.client.rewrite === false) notes.push(t("n_rewrite"));
    if (state.client.protect === false) { notes.push(t("n_protect")); bad = true; }
    if (!state.check.items.find(function (i) { return i.id === "https"; }).ok) notes.push(t("n_https"));
    noticeEl.classList.toggle("hidden", notes.length === 0);
    noticeEl.classList.toggle("bad", bad);
    noticeEl.textContent = notes.join(" ");
  }

  async function boot() {
    applyLang();
    print([[BANNER, "t-art"]]);
    print([["  " + t("t_boot"), "t-dim"]]);
    print([[""]]);
    await cmd("open-qr doctor");

    try {
      state.check = await task(t("t_checking"), api("check"));
    } catch (e) {
      noticeEl.textContent = e.message;
      noticeEl.className = "notice bad";
      return;
    }
    document.getElementById("version").textContent = "open-qr v" + state.check.version;

    var r1 = await probe("api/ping");
    var ping = null;
    if (r1 && r1.ok) { try { ping = await r1.json(); } catch (e) { /* html */ } }
    state.client.rewrite = !!(ping && ping.status === "ok");
    var r2 = await probe("data/README.txt");
    var r3 = await probe("lib/app.php");
    state.client.protect = !(r2 && r2.status === 200) && !(r3 && r3.status === 200);

    // Print every check line with a little delay, filling the panel list in sync.
    var rows = checkRows();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var mark = r.status === "ok" ? ["  ✓ ", "t-ok"] : r.status === "warn" ? ["  ! ", "t-warn"] : ["  ✗ ", "t-err"];
      print([mark, [t("c_" + r.id), ""], [r.value ? "  " + r.value : "", "t-dim"]]);
      await run(function () { return sleep(110); });
    }
    renderChecks();
    await print([[""]]);
    if (state.check.ok) {
      await print([["  " + t("t_checks_ok"), "t-ok"]], 12);
      document.getElementById("to-admin").disabled = false;
    } else {
      await print([["  " + t("t_checks_fail"), "t-err"]], 12);
    }
    prefillDb();
  }

  document.getElementById("to-admin").addEventListener("click", function () {
    go(2);
    print([[""], ["# " + t("t_wait_admin"), "t-dim"]]);
  });

  // ------------------------------------------------------------ step 2: admin

  var formAdmin = document.getElementById("form-admin");
  var adminErr = document.getElementById("admin-error");
  var pw = formAdmin.elements.password;

  function score(p) {
    var s = 0;
    if (p.length >= 10) s++;
    if (p.length >= 14) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
    if (/\d/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    return p.length < 10 ? Math.min(s, 1) : s;
  }

  function updateMeter() {
    var p = pw.value;
    var s = score(p);
    var bar = document.getElementById("meter-bar");
    var text = document.getElementById("meter-text");
    var colors = ["#ff6b7a", "#ff6b7a", "#ffb347", "#d6e05a", "#3ddc97", "#3ddc97"];
    bar.style.width = (p ? Math.max(8, s * 20) : 0) + "%";
    bar.style.background = colors[s];
    if (!p) text.textContent = t("password_hint");
    else if (p.length < 10) text.textContent = t("password_hint");
    else text.textContent = t(s <= 2 ? "pw_ok" : s === 3 ? "pw_good" : "pw_strong");
  }
  pw.addEventListener("input", updateMeter);

  function fail(errEl, input, msg) {
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
    if (input) { input.classList.add("invalid"); input.focus(); }
    return false;
  }

  document.querySelectorAll("input").forEach(function (i) {
    i.addEventListener("input", function () { i.classList.remove("invalid"); });
  });

  function validateAdmin() {
    var f = formAdmin.elements;
    adminErr.classList.add("hidden");
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(f.username.value.trim())) return fail(adminErr, f.username, t("e_username"));
    var mail = f.email.value.trim();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return fail(adminErr, f.email, t("e_email"));
    if (f.password.value.length < 10) return fail(adminErr, f.password, t("e_password"));
    if (f.password.value !== f.password2.value) return fail(adminErr, f.password2, t("e_password2"));
    return true;
  }

  formAdmin.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!validateAdmin()) return;
    print([["  ✓ ", "t-ok"], [t("t_admin_ok") + ": ", ""], [formAdmin.elements.username.value.trim(), "t-hi"]]);
    print([["# " + t("t_wait_db"), "t-dim"]]);
    go(3);
  });

  // ------------------------------------------------------------ step 3: database

  var formDb = document.getElementById("form-db");
  var dbErr = document.getElementById("db-error");
  var preview = document.getElementById("short-preview");
  var tzSel = document.getElementById("tz");

  function cleanBase() { return formDb.elements.base_url.value.trim().replace(/\/+$/, ""); }

  function updatePreview() { preview.textContent = (cleanBase() || "https://…") + "/r/aB3xK9p"; }
  formDb.elements.base_url.addEventListener("input", updatePreview);

  function prefillDb() {
    if (state.check) formDb.elements.base_url.value = state.check.base_url;
    updatePreview();

    var here = "UTC";
    try { here = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { /* old browser */ }
    var zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch (e) { zones = [here]; }
    if (zones.indexOf("UTC") < 0) zones.unshift("UTC");
    if (zones.indexOf(here) < 0) zones.push(here);
    tzSel.innerHTML = "";
    zones.forEach(function (z) {
      var o = document.createElement("option");
      o.value = z; o.textContent = z.replace(/_/g, " ");
      if (z === here) o.selected = true;
      tzSel.appendChild(o);
    });

    if (state.check) {
      formDb.querySelectorAll('input[name="driver"]').forEach(function (r) {
        r.disabled = !state.check.drivers[r.value];
        r.closest(".choice").classList.toggle("hidden", r.disabled);
      });
      if (!state.check.drivers.sqlite && state.check.drivers.mysql) {
        formDb.querySelector('input[value="mysql"]').checked = true;
      }
      toggleMysql();
    }
  }

  function driver() { return formDb.querySelector('input[name="driver"]:checked').value; }
  function toggleMysql() { document.getElementById("mysql").classList.toggle("hidden", driver() !== "mysql"); }
  formDb.querySelectorAll('input[name="driver"]').forEach(function (r) { r.addEventListener("change", toggleMysql); });

  var FIELD_STEP = { username: 2, email: 2, password: 2 };

  formDb.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    dbErr.classList.add("hidden");
    var f = formDb.elements;
    if (!/^https?:\/\/[^\s/?#]+[^\s?#]*$/i.test(cleanBase())) return fail(dbErr, f.base_url, t("e_base_url"));
    var db = { driver: driver() };
    if (db.driver === "mysql") {
      db.host = f.db_host.value.trim();
      db.port = Number(f.db_port.value) || 3306;
      db.name = f.db_name.value.trim();
      db.user = f.db_user.value.trim();
      db.password = f.db_password.value;
      if (!db.host || !db.name || !db.user) return fail(dbErr, !db.host ? f.db_host : !db.name ? f.db_name : f.db_user, t("e_mysql"));
    }
    if (!validateAdmin()) { go(2); return; }

    var a = formAdmin.elements;
    var payload = {
      base_url: cleanBase(),
      timezone: tzSel.value,
      username: a.username.value.trim(),
      email: a.email.value.trim() || null,
      password: a.password.value,
      db: db
    };

    var btn = document.getElementById("install-btn");
    btn.disabled = true;
    btn.classList.add("busy");
    formDb.querySelectorAll("button").forEach(function (b) { b.disabled = true; });

    print([[""]]);
    await cmd("open-qr install --db=" + db.driver + " --admin=" + payload.username);
    var req = api("run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    try {
      await run(function () { return progress(req); });
      var res = await req;
      for (var i = 0; i < res.log.length; i++) {
        var s = res.log[i];
        await run(function () { return sleep(260); });
        print([["  ✓ ", "t-ok"], [t("s_" + s.step), ""], ["  " + s.detail, "t-dim"]]);
      }
      await print([[""]]);
      await print([["  " + t("t_done"), "t-ok t-hi"]], 22);
      await print([["  → " + t("t_open") + ": ", "t-dim"], [res.base_url + "/", "t-prompt"]]);
      try { localStorage.setItem("openqr-lang", lang); } catch (e) { /* storage blocked */ }
      go(4);
    } catch (e) {
      await run(function () { return sleep(50); });
      print([["  ✗ " + t("t_failed") + ": ", "t-err"], [e.message, "t-err"]]);
      btn.classList.remove("busy");
      formDb.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
      var field = e.field;
      if (field && FIELD_STEP[field]) {
        go(2);
        fail(adminErr, a[field], e.message);
      } else {
        fail(dbErr, field && f[field] ? f[field] : null, e.message);
      }
    }
  });

  // ------------------------------------------------------------ language switch

  document.querySelectorAll("[data-lang]").forEach(function (b) {
    b.addEventListener("click", function () {
      lang = b.dataset.lang;
      try { localStorage.setItem("openqr-lang", lang); } catch (e) { /* storage blocked */ }
      applyLang();
      updatePreview();
    });
  });

  boot();
})();
