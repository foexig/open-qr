// open-qr dashboard. Plain JS, no build step, no external requests.
// The page is served with a strict CSP: no inline scripts, no inline style attributes.
"use strict";

(function () {
  const state = { user: null, csrf: null, setupRequired: false };
  const root = document.getElementById("app");

  // ---------- helpers ----------

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  const nf = new Intl.NumberFormat();
  const fmtNum = (n) => nf.format(n || 0);

  function fmtDate(iso, withTime) {
    if (!iso) return "—";
    const d = new Date(iso);
    const opts = withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" };
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  }

  function timeAgo(iso) {
    if (!iso) return "never";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    const d = Math.round(h / 24);
    if (d < 30) return d + " d ago";
    return fmtDate(iso);
  }

  function $(sel, el) { return (el || document).querySelector(sel); }
  function $all(sel, el) { return Array.from((el || document).querySelectorAll(sel)); }

  function toast(message, isError) {
    const box = document.getElementById("toasts");
    const t = document.createElement("div");
    t.className = "toast" + (isError ? " err" : "");
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.remove(), isError ? 6000 : 3000);
  }

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  function errorText(body, status) {
    if (body && typeof body.detail === "string") return body.detail;
    if (body && Array.isArray(body.detail) && body.detail.length) {
      return body.detail.map((e) => {
        const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : "";
        const msg = String(e.msg || "Invalid value").replace(/^Value error, /, "");
        return field && field !== "body" ? field.replace(/_/g, " ") + ": " + msg : msg;
      }).join(" · ");
    }
    if (status === 429) return "Too many attempts. Please wait a few minutes.";
    return "Request failed (" + status + ").";
  }

  async function api(method, path, body) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && state.csrf) headers["X-CSRF-Token"] = state.csrf;
    let res;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
      });
    } catch (e) {
      throw new ApiError(0, "Network error. Is the server running?");
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON body */ }
    if (!res.ok) {
      if (res.status === 401 && state.user) {
        state.user = null;
        state.csrf = null;
        toast("Your session has expired. Please sign in again.", true);
        render();
      }
      throw new ApiError(res.status, errorText(data, res.status));
    }
    return data;
  }

  function setSession(s) {
    state.user = s.user;
    state.csrf = s.csrf_token;
    state.setupRequired = false;
  }

  // ---------- icons ----------

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
  }

  // ---------- theme ----------

  function currentTheme() {
    const t = document.documentElement.getAttribute("data-theme");
    if (t) return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("openqr-theme", next); } catch (e) { /* storage blocked */ }
    $all("[data-theme-toggle]").forEach((b) => { b.innerHTML = themeIcon(); });
  }

  function themeIcon() { return icon(currentTheme() === "dark" ? "sun" : "moon"); }

  // ---------- modal ----------

  function openModal(html, onMount) {
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + "</div>";
    document.body.appendChild(back);
    const close = () => {
      back.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
    $all("[data-close]", back).forEach((b) => b.addEventListener("click", close));
    if (onMount) onMount(back, close);
    const first = $("input, textarea, select, button.btn-primary, button.btn-danger-solid", back);
    if (first) first.focus();
    return close;
  }

  function confirmDialog(title, message, confirmLabel) {
    return new Promise((resolve) => {
      let done = false;
      const close = openModal(
        '<div class="modal-head"><h2>' + esc(title) + "</h2></div>" +
        '<div class="modal-body"><p class="muted">' + esc(message) + "</p></div>" +
        '<div class="modal-foot"><button class="btn" data-close>Cancel</button>' +
        '<button class="btn btn-danger-solid" data-ok>' + esc(confirmLabel) + "</button></div>",
        (el, closeFn) => {
          $("[data-ok]", el).addEventListener("click", () => { done = true; closeFn(); resolve(true); });
          new MutationObserver((_, obs) => {
            if (!document.body.contains(el)) { obs.disconnect(); if (!done) resolve(false); }
          }).observe(document.body, { childList: true });
        }
      );
      void close;
    });
  }

  function codeForm(qr) {
    const v = qr || { name: "", target_url: "https://", description: "", is_active: true };
    return '<div class="form-error hidden" data-error></div>' +
      '<div class="field"><label for="f-name">Name</label>' +
      '<input class="input" id="f-name" name="name" maxlength="120" required value="' + esc(v.name) + '" placeholder="Spring flyer"></div>' +
      '<div class="field"><label for="f-url">Target URL</label>' +
      '<input class="input" id="f-url" name="target_url" type="url" maxlength="2048" required value="' + esc(v.target_url) + '" placeholder="https://example.com/landing">' +
      '<span class="help">Where the QR code sends people. You can change it any time without reprinting.</span></div>' +
      '<div class="field"><label for="f-desc">Description <span class="faint">(optional)</span></label>' +
      '<textarea id="f-desc" name="description" maxlength="2000">' + esc(v.description) + "</textarea></div>" +
      '<label class="switch"><input type="checkbox" name="is_active"' + (v.is_active ? " checked" : "") + "><span></span> Active</label>";
  }

  function readCodeForm(form) {
    return {
      name: form.elements.name.value.trim(),
      target_url: form.elements.target_url.value.trim(),
      description: form.elements.description.value.trim(),
      is_active: form.elements.is_active.checked,
    };
  }

  function showFormError(form, message) {
    const box = $("[data-error]", form);
    box.textContent = message;
    box.classList.remove("hidden");
  }

  function codeModal(qr, onSaved) {
    const editing = !!qr;
    openModal(
      '<form novalidate>' +
      '<div class="modal-head"><h2>' + (editing ? "Edit QR code" : "New QR code") + "</h2></div>" +
      '<div class="modal-body">' + codeForm(qr) + "</div>" +
      '<div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + (editing ? "Save changes" : "Create") + "</button></div>" +
      "</form>",
      (el, close) => {
        const form = $("form", el);
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const btn = $("button[type=submit]", form);
          btn.disabled = true;
          try {
            const data = readCodeForm(form);
            const saved = editing
              ? await api("PATCH", "/api/qr-codes/" + qr.id, data)
              : await api("POST", "/api/qr-codes", data);
            close();
            toast(editing ? "Saved." : "QR code created.");
            onSaved(saved);
          } catch (err) {
            showFormError(form, err.message);
            btn.disabled = false;
          }
        });
      }
    );
  }

  async function deleteCode(qr, after) {
    const ok = await confirmDialog(
      "Delete “" + qr.name + "”?",
      "The short link " + qr.short_url + " will stop working immediately and all scan statistics for it are deleted. This cannot be undone.",
      "Delete"
    );
    if (!ok) return;
    try {
      await api("DELETE", "/api/qr-codes/" + qr.id);
      toast("QR code deleted.");
      after();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard.");
    } catch (e) {
      toast("Could not copy. Select the text and copy it manually.", true);
    }
  }

  // ---------- chart ----------

  function shortLabel(period, unit) {
    const d = new Date(period + "T00:00:00");
    if (unit === "month") return new Intl.DateTimeFormat(undefined, { month: "short" }).format(d);
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
  }

  function longLabel(period, unit) {
    const d = new Date(period + "T00:00:00");
    if (unit === "month") return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d);
    const s = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d);
    return unit === "week" ? "Week of " + s : s;
  }

  // Integer-valued axis: step is 1, 2 or 5 times a power of ten, about five intervals.
  function niceScale(v) {
    if (v <= 4) return { max: 4, step: 1 };
    const raw = v / 5, p = Math.pow(10, Math.floor(Math.log10(raw)));
    let step = 10 * p;
    for (const m of [1, 2, 5]) if (m * p >= raw) { step = m * p; break; }
    step = Math.max(1, step);
    return { max: Math.ceil(v / step) * step, step };
  }

  function barChart(series, unit) {
    const W = 720, H = 220, L = 36, R = 8, T = 10, B = 26;
    const { max, step } = niceScale(Math.max(0, ...series.map((p) => p.count)));
    const cw = W - L - R, ch = H - T - B;
    const n = series.length || 1;
    const slot = cw / n;
    const bw = Math.max(2, Math.min(28, slot * 0.68));
    const y = (v) => T + ch - (v / max) * ch;
    let out = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Scans over time">';
    for (let v = 0; v <= max; v += step) {
      const yy = y(v);
      out += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>';
      out += '<text class="axis-label" x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + fmtNum(v) + "</text>";
    }
    const every = Math.ceil(n / 8);
    series.forEach((p, i) => {
      const x = L + i * slot + (slot - bw) / 2;
      const human = p.count - p.bots;
      const hTop = y(p.count), hBot = y(p.bots);
      if (p.bots > 0) out += '<rect class="bar-bot" x="' + x + '" y="' + hBot + '" width="' + bw + '" height="' + (T + ch - hBot) + '" rx="2"/>';
      if (human > 0) out += '<rect class="bar" x="' + x + '" y="' + hTop + '" width="' + bw + '" height="' + (hBot - hTop) + '" rx="2"/>';
      out += '<rect class="hit" x="' + (L + i * slot) + '" y="' + T + '" width="' + slot + '" height="' + ch + '"><title>' +
        esc(longLabel(p.period, unit)) + ": " + fmtNum(p.count) + " scans" + (p.bots ? " (" + fmtNum(p.bots) + " likely bots)" : "") + "</title></rect>";
      if (i % every === 0) {
        out += '<text class="axis-label" x="' + (L + i * slot + slot / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(shortLabel(p.period, unit)) + "</text>";
      }
    });
    return out + "</svg>";
  }

  const LEGEND = '<div class="legend"><span><i class="l-h"></i>Scans</span><span><i class="l-b"></i>Likely bots / previews</span></div>';
  const SCAN_NOTE = '<div class="note">Scans count every request to the short link. Link previews, crawlers and repeat scans are included, so this is not a count of unique people. Likely bots are flagged where the user agent identifies them.</div>';

  function hbars(items) {
    if (!items.length) return '<p class="muted small">No data yet.</p>';
    const total = items.reduce((s, i) => s + i.count, 0) || 1;
    return '<div class="hbars">' + items.map((i) => {
      const pct = Math.round((i.count / total) * 100);
      return '<div><div class="hbar-top"><span>' + esc(i.label || "Unknown") + '</span><span class="muted">' +
        fmtNum(i.count) + " · " + pct + '%</span></div><div class="hbar-track"><div class="hbar-fill" data-pct="' + pct + '"></div></div></div>';
    }).join("") + "</div>";
  }

  // Widths are applied via CSSOM, which the CSP allows (unlike style="" attributes).
  function applyBarWidths(el) {
    $all("[data-pct]", el).forEach((b) => { b.style.width = b.getAttribute("data-pct") + "%"; });
  }

  // ---------- layout ----------

  const NAV = [
    { href: "#/", key: "home", label: "Overview", icon: "home" },
    { href: "#/codes", key: "codes", label: "QR codes", icon: "qr" },
    { href: "#/settings", key: "settings", label: "Settings", icon: "gear" },
  ];

  function navHtml(active) {
    return '<nav class="nav">' + NAV.map((n) =>
      '<a href="' + n.href + '"' + (n.key === active ? ' class="active"' : "") + ">" + icon(n.icon) + "<span>" + n.label + "</span></a>"
    ).join("") + "</nav>";
  }

  function shell(active, content) {
    const brand = '<a class="brand" href="#/"><img src="/static/favicon.svg" alt="">open-qr</a>';
    return '<div class="shell">' +
      '<aside class="sidebar">' + brand + navHtml(active) +
      '<div class="sidebar-foot"><div class="user-chip">Signed in as <strong>' + esc(state.user.username) + "</strong></div>" +
      '<div class="row"><button class="btn btn-sm btn-ghost" data-theme-toggle title="Toggle theme" aria-label="Toggle theme">' + themeIcon() + "</button>" +
      '<button class="btn btn-sm btn-ghost" data-logout>' + icon("logout") + "Sign out</button></div></div></aside>" +
      '<div><header class="topbar">' + brand + navHtml(active) + '<span class="spacer"></span>' +
      '<button class="btn btn-icon btn-ghost" data-theme-toggle aria-label="Toggle theme">' + themeIcon() + "</button></header>" +
      '<main class="main" id="main">' + content + "</main></div></div>";
  }

  function bindShell() {
    $all("[data-theme-toggle]").forEach((b) => b.addEventListener("click", toggleTheme));
    $all("[data-logout]").forEach((b) => b.addEventListener("click", logout));
  }

  async function logout() {
    try { await api("POST", "/api/auth/logout"); } catch (e) { /* session may already be gone */ }
    state.user = null;
    state.csrf = null;
    location.hash = "#/";
    render();
  }

  // ---------- auth views ----------

  function authCard(inner) {
    return '<div class="auth"><div class="card"><div class="row"><span class="brand"><img src="/static/favicon.svg" alt="">open-qr</span>' +
      '<span class="spacer"></span></div>' + inner + "</div></div>";
  }

  function renderLogin() {
    root.innerHTML = authCard(
      "<h1>Sign in</h1><p>Manage your dynamic QR codes.</p>" +
      '<form novalidate><div class="form-error hidden" data-error></div>' +
      '<div class="field"><label for="l-user">Username</label><input class="input" id="l-user" name="username" autocomplete="username" required></div>' +
      '<div class="field"><label for="l-pass">Password</label><input class="input" id="l-pass" name="password" type="password" autocomplete="current-password" required></div>' +
      '<button class="btn btn-primary" type="submit">Sign in</button></form>'
    );
    const form = $("form", root);
    $("#l-user").focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button", form);
      btn.disabled = true;
      try {
        setSession(await api("POST", "/api/auth/login", {
          username: form.elements.username.value.trim(),
          password: form.elements.password.value,
        }));
        render();
      } catch (err) {
        showFormError(form, err.message);
        btn.disabled = false;
      }
    });
  }

  function renderSetup() {
    root.innerHTML = authCard(
      "<h1>Create the admin account</h1>" +
      "<p>This instance has no users yet. Enter the one-time setup token from the server log " +
      "(or run <code>docker compose exec app python -m app.cli setup-info</code>).</p>" +
      '<form novalidate><div class="form-error hidden" data-error></div>' +
      '<div class="field"><label for="s-token">Setup token</label><input class="input mono" id="s-token" name="token" autocomplete="off" required></div>' +
      '<div class="field"><label for="s-user">Username</label><input class="input" id="s-user" name="username" autocomplete="username" required pattern="[A-Za-z0-9_.\\-]{3,64}">' +
      '<span class="help">3–64 characters: letters, digits, dot, dash, underscore.</span></div>' +
      '<div class="field"><label for="s-mail">Email <span class="faint">(optional)</span></label><input class="input" id="s-mail" name="email" type="email" autocomplete="email"></div>' +
      '<div class="field"><label for="s-pass">Password</label><input class="input" id="s-pass" name="password" type="password" autocomplete="new-password" required minlength="10">' +
      '<span class="help">At least 10 characters. A long passphrase is best.</span></div>' +
      '<div class="field"><label for="s-pass2">Repeat password</label><input class="input" id="s-pass2" name="password2" type="password" autocomplete="new-password" required></div>' +
      '<button class="btn btn-primary" type="submit">Create account</button></form>'
    );
    const form = $("form", root);
    $("#s-token").focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = form.elements;
      if (f.password.value !== f.password2.value) return showFormError(form, "The passwords do not match.");
      const btn = $("button", form);
      btn.disabled = true;
      try {
        setSession(await api("POST", "/api/auth/setup", {
          setup_token: f.token.value.trim(),
          username: f.username.value.trim(),
          email: f.email.value.trim() || null,
          password: f.password.value,
        }));
        toast("Welcome! Your admin account is ready.");
        render();
      } catch (err) {
        if (err.status === 409) { state.setupRequired = false; return render(); }
        showFormError(form, err.message);
        btn.disabled = false;
      }
    });
  }

  // ---------- overview ----------

  function statCard(label, value, hint) {
    return '<div class="card stat"><div class="label">' + esc(label) + '</div><div class="value">' + value + "</div>" +
      (hint ? '<div class="hint">' + esc(hint) + "</div>" : "") + "</div>";
  }

  function codeListItem(qr, rank) {
    return "<li>" + (rank ? '<span class="rank">' + rank + "</span>" : "") +
      '<img class="thumb" loading="lazy" alt="" src="/api/qr-codes/' + qr.id + '/image.svg?size=128&border=2">' +
      '<div class="grow"><a class="title" href="#/codes/' + qr.id + '">' + esc(qr.name) + '</a><span class="meta">' + esc(qr.target_url) + "</span></div>" +
      '<div class="num"><strong>' + fmtNum(qr.scan_count) + '</strong><div class="meta">scans</div></div></li>';
  }

  async function viewOverview(main) {
    const d = await api("GET", "/api/stats/overview?days=30");
    const s = d.scans;
    const empty = d.total_codes === 0;
    main.innerHTML =
      '<div class="page-head"><div><h1>Overview</h1><div class="sub">All your QR codes at a glance.</div></div>' +
      '<div class="head-actions"><button class="btn btn-primary" data-new>' + icon("plus") + "New QR code</button></div></div>" +
      '<div class="stack">' +
      '<div class="grid grid-4">' +
      statCard("QR codes", fmtNum(d.total_codes), fmtNum(d.active_codes) + " active") +
      statCard("Total scans", fmtNum(s.total), s.likely_bots ? fmtNum(s.likely_bots) + " likely bots" : "") +
      statCard("This month", fmtNum(s.this_month), fmtNum(s.this_week) + " this week") +
      statCard("Today", fmtNum(s.today), "Last scan " + timeAgo(s.last_scan_at)) +
      "</div>" +
      (empty
        ? '<div class="card empty"><h2>No QR codes yet</h2><p>Create your first dynamic QR code. You can change where it points at any time.</p>' +
          '<button class="btn btn-primary" data-new>' + icon("plus") + "Create QR code</button></div>"
        : '<div class="card"><div class="card-head"><h2>Scans, last 30 days</h2>' + LEGEND + "</div>" +
          '<div class="card-pad">' + barChart(d.daily, "day") + "</div>" + SCAN_NOTE + "</div>" +
          '<div class="grid grid-2">' +
          '<div class="card"><div class="card-head"><h2>Recently created</h2><a href="#/codes" class="small">View all</a></div>' +
          '<ul class="list">' + d.recent.map((q) => codeListItem(q)).join("") + "</ul></div>" +
          '<div class="card"><div class="card-head"><h2>Top 5 by scans</h2></div>' +
          (d.top.length
            ? '<ul class="list">' + d.top.map((q, i) => codeListItem(q, i + 1)).join("") + "</ul>"
            : '<div class="empty small">No scans yet.</div>') +
          "</div></div>") +
      "</div>";
    $all("[data-new]", main).forEach((b) => b.addEventListener("click", () =>
      codeModal(null, (qr) => { location.hash = "#/codes/" + qr.id; })));
  }

  // ---------- list ----------

  const listState = { q: "", sort: "created" };

  async function viewCodes(main) {
    main.innerHTML =
      '<div class="page-head"><div><h1>QR codes</h1><div class="sub">Create, edit and download your codes.</div></div>' +
      '<div class="head-actions"><button class="btn btn-primary" data-new>' + icon("plus") + "New QR code</button></div></div>" +
      '<div class="card"><div class="card-head">' +
      '<input class="input search" type="search" placeholder="Search name or URL…" aria-label="Search" value="' + esc(listState.q) + '" data-search>' +
      '<select class="input search" aria-label="Sort" data-sort>' +
      '<option value="created">Newest first</option><option value="name">Name A–Z</option><option value="scans">Most scans</option>' +
      '</select></div><div data-table><div class="empty">Loading…</div></div></div>';
    $("[data-sort]", main).value = listState.sort;
    $("[data-new]", main).addEventListener("click", () => codeModal(null, (qr) => { location.hash = "#/codes/" + qr.id; }));

    const tableBox = $("[data-table]", main);
    let seq = 0;
    async function load() {
      const mine = ++seq;
      const params = new URLSearchParams({ sort: listState.sort });
      if (listState.q) params.set("q", listState.q);
      let codes;
      try {
        codes = await api("GET", "/api/qr-codes?" + params);
      } catch (err) {
        if (mine === seq) tableBox.innerHTML = '<div class="empty">' + esc(err.message) + "</div>";
        return;
      }
      if (mine !== seq) return;
      if (!codes.length) {
        tableBox.innerHTML = listState.q
          ? '<div class="empty">No QR codes match “' + esc(listState.q) + "”.</div>"
          : '<div class="empty"><h2>No QR codes yet</h2><p>Create one to get started.</p></div>';
        return;
      }
      tableBox.innerHTML = '<div class="table-wrap"><table><thead><tr>' +
        '<th></th><th>Name</th><th class="hide-sm">Target</th><th>Status</th><th class="num">Scans</th><th class="hide-sm">Created</th><th></th>' +
        "</tr></thead><tbody>" + codes.map((q) =>
          "<tr>" +
          '<td><a href="#/codes/' + q.id + '"><img class="thumb" loading="lazy" alt="" src="/api/qr-codes/' + q.id + '/image.svg?size=128&border=2"></a></td>' +
          '<td class="cell-name"><a href="#/codes/' + q.id + '">' + esc(q.name) + '</a><div class="faint small mono">/r/' + esc(q.code) + "</div></td>" +
          '<td class="cell-url hide-sm" title="' + esc(q.target_url) + '">' + esc(q.target_url) + "</td>" +
          "<td>" + (q.is_active ? '<span class="badge badge-on">Active</span>' : '<span class="badge badge-off">Inactive</span>') + "</td>" +
          '<td class="num">' + fmtNum(q.scan_count) + "</td>" +
          '<td class="hide-sm muted">' + fmtDate(q.created_at) + "</td>" +
          '<td class="cell-actions"><button class="btn btn-sm" data-edit="' + q.id + '">Edit</button> ' +
          '<button class="btn btn-sm btn-danger" data-del="' + q.id + '">Delete</button></td>' +
          "</tr>"
        ).join("") + "</tbody></table></div>";
      const byId = new Map(codes.map((c) => [String(c.id), c]));
      $all("[data-edit]", tableBox).forEach((b) => b.addEventListener("click", () =>
        codeModal(byId.get(b.dataset.edit), load)));
      $all("[data-del]", tableBox).forEach((b) => b.addEventListener("click", () =>
        deleteCode(byId.get(b.dataset.del), load)));
    }

    let timer = null;
    $("[data-search]", main).addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { listState.q = e.target.value.trim(); load(); }, 250);
    });
    $("[data-sort]", main).addEventListener("change", (e) => { listState.sort = e.target.value; load(); });
    await load();
  }

  // ---------- detail ----------

  async function viewDetail(main, id) {
    let qr, st;
    try {
      [qr, st] = await Promise.all([
        api("GET", "/api/qr-codes/" + id),
        api("GET", "/api/qr-codes/" + id + "/stats?days=30"),
      ]);
    } catch (err) {
      if (err.status === 404 || err.status === 422) {
        main.innerHTML = '<div class="card empty"><h2>QR code not found</h2><p>It may have been deleted.</p><a class="btn" href="#/codes">Back to list</a></div>';
        return;
      }
      throw err;
    }
    let unit = "day";
    const series = () => (unit === "day" ? st.daily : unit === "week" ? st.weekly : st.monthly);

    main.innerHTML =
      '<a class="back" href="#/codes">' + icon("back") + "All QR codes</a>" +
      '<div class="page-head"><div><h1>' + esc(qr.name) + "</h1>" +
      '<div class="sub">Created ' + fmtDate(qr.created_at) + " · updated " + fmtDate(qr.updated_at, true) + "</div></div>" +
      '<div class="head-actions"><label class="switch"><input type="checkbox" data-active' + (qr.is_active ? " checked" : "") + "><span></span>" +
      '<span data-active-label>' + (qr.is_active ? "Active" : "Inactive") + "</span></label>" +
      '<button class="btn" data-edit>Edit</button></div></div>' +
      '<div class="detail">' +
      '<div class="stack qr-col">' +
      '<div class="card card-pad"><div class="qr-big"><img alt="QR code for ' + esc(qr.short_url) + '" src="/api/qr-codes/' + qr.id + '/image.svg?size=600"></div>' +
      '<div class="short-url"><input class="input" readonly value="' + esc(qr.short_url) + '" aria-label="Short URL">' +
      '<button class="btn btn-icon" data-copy title="Copy short URL" aria-label="Copy short URL">' + icon("copy") + "</button></div>" +
      '<p class="small muted">Points to <a href="' + esc(qr.target_url) + '" target="_blank" rel="noopener noreferrer">' + esc(qr.target_url) + "</a></p>" +
      (qr.description ? '<p class="small">' + esc(qr.description) + "</p>" : "") +
      (qr.is_active ? "" : '<p class="small form-error">This code is inactive. Scans show an “inactive” page and are not redirected.</p>') +
      "</div>" +
      '<div class="card card-pad"><h2>Download</h2><form data-dl class="stack small" novalidate>' +
      '<div class="row">' +
      '<div class="field"><label for="d-fmt">Format</label><select id="d-fmt" name="fmt"><option value="png">PNG</option><option value="svg">SVG (vector)</option></select></div>' +
      '<div class="field"><label for="d-size">Size (px)</label><select id="d-size" name="size"><option>256</option><option>512</option><option selected>1024</option><option>2048</option><option>4096</option></select></div>' +
      "</div><div class=\"row\">" +
      '<div class="field"><label for="d-ec">Error correction</label><select id="d-ec" name="ec">' +
      '<option value="L">L – 7%</option><option value="M" selected>M – 15%</option><option value="Q">Q – 25%</option><option value="H">H – 30%</option></select></div>' +
      '<div class="field"><label for="d-border">Quiet zone</label><select id="d-border" name="border"><option>0</option><option>2</option><option selected>4</option><option>6</option><option>8</option></select></div>' +
      "</div>" +
      '<a class="btn btn-primary" data-dl-link href="#">' + icon("download") + "Download</a>" +
      '<span class="help faint">Higher error correction survives damage or a logo overlay but makes the pattern denser. Keep a quiet zone of 4 for reliable scanning.</span>' +
      "</form></div>" +
      '<div class="card card-pad danger-zone"><h2>Delete</h2><p class="small muted">Removes the code and its statistics. Printed copies stop working.</p>' +
      '<button class="btn btn-danger" data-del>Delete QR code</button></div>' +
      "</div>" +
      '<div class="stack">' +
      '<div class="grid grid-4">' +
      statCard("Total scans", fmtNum(st.total), st.likely_bots ? fmtNum(st.likely_bots) + " likely bots" : "") +
      statCard("Today", fmtNum(st.today)) +
      statCard("This week", fmtNum(st.this_week)) +
      statCard("This month", fmtNum(st.this_month)) +
      "</div>" +
      '<div class="card"><div class="card-head"><div><h2>Scans</h2><div class="faint small">Last scan: ' +
      (st.last_scan_at ? fmtDate(st.last_scan_at, true) : "never") + " · times in " + esc(st.timezone) + "</div></div>" +
      '<div class="seg" role="group" aria-label="Chart range"><button data-unit="day" class="on">Daily</button><button data-unit="week">Weekly</button><button data-unit="month">Monthly</button></div></div>' +
      '<div class="card-pad"><div data-chart></div>' + LEGEND + "</div>" + SCAN_NOTE + "</div>" +
      '<div class="grid grid-3">' +
      '<div class="card card-pad"><h2>Devices</h2><br>' + hbars(st.devices) + "</div>" +
      '<div class="card card-pad"><h2>Browsers</h2><br>' + hbars(st.browsers) + "</div>" +
      '<div class="card card-pad"><h2>Referrers</h2><br>' + hbars(st.referrers) + "</div>" +
      "</div></div></div>";

    applyBarWidths(main);
    const chartBox = $("[data-chart]", main);
    const drawChart = () => { chartBox.innerHTML = barChart(series(), unit); };
    drawChart();
    $all("[data-unit]", main).forEach((b) => b.addEventListener("click", () => {
      unit = b.dataset.unit;
      $all("[data-unit]", main).forEach((x) => x.classList.toggle("on", x === b));
      drawChart();
    }));

    const reload = () => viewDetail(main, id).catch(showError);
    $("[data-copy]", main).addEventListener("click", () => copyText(qr.short_url));
    $("[data-edit]", main).addEventListener("click", () => codeModal(qr, reload));
    $("[data-del]", main).addEventListener("click", () => deleteCode(qr, () => { location.hash = "#/codes"; }));

    const toggle = $("[data-active]", main);
    toggle.addEventListener("change", async () => {
      toggle.disabled = true;
      try {
        await api("PATCH", "/api/qr-codes/" + qr.id, { is_active: toggle.checked });
        toast(toggle.checked ? "QR code activated." : "QR code deactivated.");
        reload();
      } catch (err) {
        toggle.checked = !toggle.checked;
        toggle.disabled = false;
        toast(err.message, true);
      }
    });

    const dl = $("[data-dl]", main);
    const link = $("[data-dl-link]", main);
    const updateLink = () => {
      const f = dl.elements;
      const p = new URLSearchParams({ size: f.size.value, ec: f.ec.value, border: f.border.value, download: "1" });
      link.href = "/api/qr-codes/" + qr.id + "/image." + f.fmt.value + "?" + p;
    };
    dl.addEventListener("change", updateLink);
    updateLink();
  }

  // ---------- settings ----------

  async function viewSettings(main) {
    const u = state.user;
    main.innerHTML =
      '<div class="page-head"><div><h1>Settings</h1><div class="sub">Your account.</div></div></div>' +
      '<div class="grid grid-2">' +
      '<div class="card card-pad"><h2>Account</h2><br>' +
      '<p class="small"><span class="muted">Username</span><br><strong>' + esc(u.username) + "</strong></p>" +
      '<p class="small"><span class="muted">Email</span><br>' + (u.email ? esc(u.email) : "—") + "</p>" +
      '<p class="small"><span class="muted">Role</span><br>' + (u.is_admin ? "Administrator" : "User") + "</p>" +
      '<p class="small"><span class="muted">Member since</span><br>' + fmtDate(u.created_at) + "</p>" +
      '<button class="btn" data-logout2>' + icon("logout") + "Sign out</button></div>" +
      '<div class="card card-pad"><h2>Change password</h2><br>' +
      '<form novalidate><div class="form-error hidden" data-error></div>' +
      '<input type="text" name="username" autocomplete="username" value="' + esc(u.username) + '" class="hidden" tabindex="-1" aria-hidden="true">' +
      '<div class="field"><label for="p-cur">Current password</label><input class="input" id="p-cur" name="current" type="password" autocomplete="current-password" required></div>' +
      '<div class="field"><label for="p-new">New password</label><input class="input" id="p-new" name="next" type="password" autocomplete="new-password" required minlength="10">' +
      '<span class="help">At least 10 characters. Other signed-in devices will be signed out.</span></div>' +
      '<div class="field"><label for="p-new2">Repeat new password</label><input class="input" id="p-new2" name="next2" type="password" autocomplete="new-password" required></div>' +
      '<button class="btn btn-primary" type="submit">Update password</button></form></div>' +
      "</div>";
    $("[data-logout2]", main).addEventListener("click", logout);
    const form = $("form", main);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = form.elements;
      if (f.next.value !== f.next2.value) return showFormError(form, "The new passwords do not match.");
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      try {
        await api("POST", "/api/auth/change-password", { current_password: f.current.value, new_password: f.next.value });
        form.reset();
        $("[data-error]", form).classList.add("hidden");
        toast("Password updated.");
      } catch (err) {
        showFormError(form, err.message);
      }
      btn.disabled = false;
    });
  }

  // ---------- router ----------

  function showError(err) {
    const main = document.getElementById("main");
    if (err instanceof ApiError && err.status === 401) return; // handled in api()
    if (main) main.innerHTML = '<div class="card empty"><h2>Something went wrong</h2><p>' + esc(err.message) + "</p></div>";
    else toast(err.message, true);
  }

  function route() {
    const h = location.hash.replace(/^#/, "") || "/";
    let m;
    if (h === "/" ) return { key: "home", view: viewOverview };
    if (h === "/codes") return { key: "codes", view: viewCodes };
    if ((m = h.match(/^\/codes\/(\d+)$/))) return { key: "codes", view: (el) => viewDetail(el, m[1]) };
    if (h === "/settings") return { key: "settings", view: viewSettings };
    return { key: "home", view: viewOverview };
  }

  function render() {
    if (state.setupRequired) return renderSetup();
    if (!state.user) return renderLogin();
    const r = route();
    root.innerHTML = shell(r.key, '<div class="boot">Loading…</div>');
    bindShell();
    window.scrollTo(0, 0);
    r.view(document.getElementById("main")).catch(showError);
  }

  async function boot() {
    try {
      const s = await api("GET", "/api/auth/status");
      state.setupRequired = s.setup_required;
      if (s.authenticated) { state.user = s.user; state.csrf = s.csrf_token; }
    } catch (err) {
      root.innerHTML = '<div class="auth"><div class="card"><h1>Cannot reach the server</h1><p>' + esc(err.message) + "</p></div></div>";
      return;
    }
    window.addEventListener("hashchange", render);
    render();
  }

  boot();
})();
