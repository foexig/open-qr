// open-qr dashboard. Plain JS, no build step, no external requests.
// The page is served with a strict CSP: no inline scripts, no inline style attributes.
// All paths are relative ("api/…", "static/…") so the app also works below a sub-path.
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
      }).join("; ");
    }
    if (status === 413) return "The file is too large.";
    if (status === 429) return "Too many attempts. Please wait a few minutes.";
    return "Request failed (" + status + ").";
  }

  // Low-level request: returns the Response for non-JSON bodies (SVG text, raw uploads).
  async function request(method, path, opts) {
    const o = opts || {};
    const headers = { Accept: o.accept || "application/json" };
    if (o.type) headers["Content-Type"] = o.type;
    if (method !== "GET" && state.csrf) headers["X-CSRF-Token"] = state.csrf;
    let res;
    try {
      res = await fetch(path, { method, headers, body: o.body, credentials: "same-origin" });
    } catch (e) {
      throw new ApiError(0, "Network error. Is the server running?");
    }
    if (!res.ok) {
      let data = null;
      try { data = await res.json(); } catch (e) { /* non-JSON body */ }
      if (res.status === 401 && state.user) {
        state.user = null;
        state.csrf = null;
        toast("Your session has expired. Please sign in again.", true);
        render();
      }
      throw new ApiError(res.status, errorText(data, res.status));
    }
    return res;
  }

  async function api(method, path, body) {
    const res = await request(method, path, body === undefined
      ? {}
      : { type: "application/json", body: JSON.stringify(body) });
    if (res.status === 204) return null;
    try { return await res.json(); } catch (e) { return null; }
  }

  function setSession(s) {
    state.user = s.user;
    state.csrf = s.csrf_token;
    state.setupRequired = false;
  }

  // Thumbnails are cached for a few minutes; the version makes a restyle show up at once.
  function imgUrl(qr, ext, params) {
    const p = new URLSearchParams(params);
    p.set("v", String(new Date(qr.updated_at).getTime() || 0) + (qr.has_logo ? "l" : ""));
    return "api/qr-codes/" + qr.id + "/image." + ext + "?" + p;
  }

  // ---------- icons ----------

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
    alert: '<path d="M12 3 2 20h20zM12 10v4M12 17v.5"/>',
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
  }

  // A printer's registration mark doubles as the logo.
  const REG_MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="6.5"/><path d="M12 1.5v21M1.5 12h21"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/></svg>';

  // Crop marks and registration targets drawn just outside the box they sit in.
  // Nested <svg x="100%"> places a corner without knowing the box size in pixels.
  function proofMarks() {
    const corner = (x, y, sx, sy) =>
      '<svg x="' + x + '" y="' + y + '" width="1" height="1" overflow="visible">' +
      '<line class="cut" x1="' + (-26 * sx) + '" y1="0" x2="' + (-7 * sx) + '" y2="0"/>' +
      '<line class="cut" x1="0" y1="' + (-26 * sy) + '" x2="0" y2="' + (-7 * sy) + '"/></svg>';
    const reg = (x, y, dx, dy) =>
      '<svg x="' + x + '" y="' + y + '" width="1" height="1" overflow="visible">' +
      '<circle class="reg" cx="' + dx + '" cy="' + dy + '" r="5"/>' +
      '<line class="reg" x1="' + (dx - 8) + '" y1="' + dy + '" x2="' + (dx + 8) + '" y2="' + dy + '"/>' +
      '<line class="reg" x1="' + dx + '" y1="' + (dy - 8) + '" x2="' + dx + '" y2="' + (dy + 8) + '"/></svg>';
    return '<svg class="proof-marks" aria-hidden="true">' +
      corner(0, 0, 1, 1) + corner("100%", 0, -1, 1) + corner(0, "100%", 1, -1) + corner("100%", "100%", -1, -1) +
      reg("50%", 0, 0, -16) + reg("50%", "100%", 0, 16) + "</svg>";
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

  const themeButton = () =>
    '<button class="btn btn-sm btn-icon" data-theme-toggle title="Switch light/dark" aria-label="Switch light or dark theme">' + themeIcon() + "</button>";

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
      openModal(
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
    });
  }

  function codeForm(qr) {
    const v = qr || { name: "", target_url: "https://", description: "", is_active: true };
    return '<div class="form-error hidden" data-error></div>' +
      '<div class="field"><label for="f-name">Name</label>' +
      '<input class="input" id="f-name" name="name" maxlength="120" required value="' + esc(v.name) + '" placeholder="Spring flyer"></div>' +
      '<div class="field"><label for="f-url">Target URL</label>' +
      '<input class="input" id="f-url" name="target_url" type="url" maxlength="2048" required value="' + esc(v.target_url) + '" placeholder="https://example.com/landing">' +
      '<span class="help">Where the code sends people. You can change it later without reprinting.</span></div>' +
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
      '<button type="submit" class="btn btn-primary">' + (editing ? "Save changes" : "Create QR code") + "</button></div>" +
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
              ? await api("PATCH", "api/qr-codes/" + qr.id, data)
              : await api("POST", "api/qr-codes", data);
            close();
            toast(editing ? "Changes saved." : "QR code created.");
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
      "The short link " + qr.short_url + " stops working immediately and its scan statistics are deleted. This cannot be undone.",
      "Delete QR code"
    );
    if (!ok) return;
    try {
      await api("DELETE", "api/qr-codes/" + qr.id);
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
    // Bot traffic is hatched like a tint screen instead of getting a second colour.
    let out = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Scans over time">' +
      '<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line class="hatch-line" x1="0" y1="0" x2="0" y2="5"/></pattern></defs>';
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
      if (p.bots > 0) out += '<rect class="bar-bot" x="' + x + '" y="' + hBot + '" width="' + bw + '" height="' + (T + ch - hBot) + '"/>';
      if (human > 0) out += '<rect class="bar" x="' + x + '" y="' + hTop + '" width="' + bw + '" height="' + (hBot - hTop) + '"/>';
      out += '<rect class="hit" x="' + (L + i * slot) + '" y="' + T + '" width="' + slot + '" height="' + ch + '"><title>' +
        esc(longLabel(p.period, unit)) + ": " + fmtNum(p.count) + " scans" + (p.bots ? " (" + fmtNum(p.bots) + " likely bots)" : "") + "</title></rect>";
      if (i % every === 0) {
        out += '<text class="axis-label" x="' + (L + i * slot + slot / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(shortLabel(p.period, unit)) + "</text>";
      }
    });
    return out + "</svg>";
  }

  const LEGEND = '<div class="legend"><span><i class="l-h"></i>Scans</span><span><i class="l-b"></i>Likely bots and link previews</span></div>';
  const SCAN_NOTE = '<div class="note">Every request to the short link counts as a scan, including link previews, crawlers and repeat scans, so this is not a count of people. Bots are flagged when their user agent says so.</div>';

  function hbars(items) {
    if (!items.length) return '<p class="muted small">No scans yet.</p>';
    const total = items.reduce((s, i) => s + i.count, 0) || 1;
    return '<div class="hbars">' + items.map((i) => {
      const pct = Math.round((i.count / total) * 100);
      return '<div><div class="hbar-top"><span>' + esc(i.label || "Unknown") + '</span><span class="muted">' +
        fmtNum(i.count) + " (" + pct + '%)</span></div><div class="hbar-track"><div class="hbar-fill" data-pct="' + pct + '"></div></div></div>';
    }).join("") + "</div>";
  }

  // Widths are applied via CSSOM, which the CSP allows (unlike style="" attributes).
  function applyBarWidths(el) {
    $all("[data-pct]", el).forEach((b) => { b.style.width = b.getAttribute("data-pct") + "%"; });
  }

  // ---------- layout ----------

  const NAV = [
    { href: "#/", key: "home", label: "Overview" },
    { href: "#/codes", key: "codes", label: "QR codes" },
    { href: "#/settings", key: "settings", label: "Settings" },
  ];

  function masthead(active) {
    const tabs = active === undefined ? "" : '<nav class="tabs" aria-label="Main">' + NAV.map((n) =>
      '<a href="' + n.href + '"' + (n.key === active ? ' class="active" aria-current="page"' : "") + ">" + n.label + "</a>"
    ).join("") + "</nav>";
    const tools = state.user
      ? '<span class="mast-user">' + esc(state.user.username) + "</span>" + themeButton() +
        '<button class="btn btn-sm" data-logout>' + icon("logout") + "Sign out</button>"
      : themeButton();
    return '<header class="masthead"><div class="masthead-in">' +
      '<a class="brand" href="#/">' + REG_MARK + "open-qr</a>" + tabs +
      '<div class="mast-tools">' + tools + "</div></div></header>";
  }

  function shell(active, content) {
    return masthead(active) + '<main class="main" id="main">' + content + "</main>";
  }

  function bindShell() {
    $all("[data-theme-toggle]").forEach((b) => b.addEventListener("click", toggleTheme));
    $all("[data-logout]").forEach((b) => b.addEventListener("click", logout));
  }

  async function logout() {
    try { await api("POST", "api/auth/logout"); } catch (e) { /* session may already be gone */ }
    state.user = null;
    state.csrf = null;
    location.hash = "#/";
    render();
  }

  // ---------- auth views ----------

  function authPage(inner) {
    root.innerHTML = '<div class="auth-wrap">' + masthead() +
      '<div class="auth"><div class="proof"><div class="auth-card">' + proofMarks() + inner + "</div></div></div></div>";
    bindShell();
  }

  function renderLogin() {
    authPage(
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
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      try {
        setSession(await api("POST", "api/auth/login", {
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
    authPage(
      "<h1>Create the admin account</h1>" +
      "<p>This instance has no users yet. Enter the one-time setup token from the server log " +
      "(or run <code>docker compose exec app python -m app.cli setup-info</code>).</p>" +
      '<form novalidate><div class="form-error hidden" data-error></div>' +
      '<div class="field"><label for="s-token">Setup token</label><input class="input mono" id="s-token" name="token" autocomplete="off" required></div>' +
      '<div class="field"><label for="s-user">Username</label><input class="input" id="s-user" name="username" autocomplete="username" required pattern="[A-Za-z0-9_.\\-]{3,64}">' +
      '<span class="help">3 to 64 characters: letters, digits, dot, dash, underscore.</span></div>' +
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
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      try {
        setSession(await api("POST", "api/auth/setup", {
          setup_token: f.token.value.trim(),
          username: f.username.value.trim(),
          email: f.email.value.trim() || null,
          password: f.password.value,
        }));
        toast("Your admin account is ready.");
        render();
      } catch (err) {
        if (err.status === 409) { state.setupRequired = false; return render(); }
        showFormError(form, err.message);
        btn.disabled = false;
      }
    });
  }

  // ---------- overview ----------

  function fig(label, value, hint) {
    return '<div class="fig"><div class="fig-label">' + esc(label) + '</div><div class="fig-value">' + value + "</div>" +
      '<div class="fig-hint">' + (hint ? esc(hint) : "&nbsp;") + "</div></div>";
  }

  function codeListItem(qr, rank) {
    return "<li>" + (rank ? '<span class="rank">' + rank + "</span>" : "") +
      '<img class="thumb" loading="lazy" alt="" src="' + imgUrl(qr, "svg", { size: 128, border: 2 }) + '">' +
      '<div class="grow"><a class="title" href="#/codes/' + qr.id + '">' + esc(qr.name) + '</a><span class="meta">' + esc(qr.target_url) + "</span></div>" +
      '<div class="num"><strong>' + fmtNum(qr.scan_count) + '</strong><div class="meta">scans</div></div></li>';
  }

  const newButton = (label) => '<button class="btn btn-primary" data-new>' + icon("plus") + (label || "New QR code") + "</button>";

  function bindNew(main) {
    $all("[data-new]", main).forEach((b) => b.addEventListener("click", () =>
      codeModal(null, (qr) => { location.hash = "#/codes/" + qr.id; })));
  }

  async function viewOverview(main) {
    const d = await api("GET", "api/stats/overview?days=30");
    const s = d.scans;
    const empty = d.total_codes === 0;
    main.innerHTML =
      '<div class="page-head"><div><h1>Overview</h1><div class="sub">Scans across all your codes, last 30 days.</div></div>' +
      '<div class="head-actions">' + newButton() + "</div></div>" +
      '<div class="stack">' +
      '<div class="sheet figures">' +
      fig("QR codes", fmtNum(d.total_codes), fmtNum(d.active_codes) + " active") +
      fig("Total scans", fmtNum(s.total), s.likely_bots ? fmtNum(s.likely_bots) + " likely bots" : "") +
      fig("This month", fmtNum(s.this_month), fmtNum(s.this_week) + " this week") +
      fig("Today", fmtNum(s.today), "Last scan " + timeAgo(s.last_scan_at)) +
      "</div>" +
      (empty
        ? '<div class="sheet empty"><h2>No QR codes yet</h2><p>Create your first code. You can change where it points at any time, even after printing.</p>' +
          newButton("Create QR code") + "</div>"
        : '<div class="sheet"><div class="sheet-head"><h2>Scans per day</h2>' + LEGEND + "</div>" +
          '<div class="sheet-pad">' + barChart(d.daily, "day") + "</div>" + SCAN_NOTE + "</div>" +
          '<div class="cols cols-2">' +
          '<div class="sheet"><div class="sheet-head"><h2>Recently created</h2><a href="#/codes">All QR codes</a></div>' +
          '<ul class="list">' + d.recent.map((q) => codeListItem(q)).join("") + "</ul></div>" +
          '<div class="sheet"><div class="sheet-head"><h2>Most scanned</h2></div>' +
          (d.top.length
            ? '<ul class="list">' + d.top.map((q, i) => codeListItem(q, i + 1)).join("") + "</ul>"
            : '<div class="empty small">No scans yet. Print a code and try it with your phone.</div>') +
          "</div></div>") +
      "</div>";
    bindNew(main);
  }

  // ---------- list ----------

  const listState = { q: "", sort: "created" };

  async function viewCodes(main) {
    main.innerHTML =
      '<div class="page-head"><div><h1>QR codes</h1><div class="sub">Create, style and download your codes.</div></div>' +
      '<div class="head-actions">' + newButton() + "</div></div>" +
      '<div class="sheet"><div class="toolbar">' +
      '<input class="input" type="search" placeholder="Search name or URL" aria-label="Search" value="' + esc(listState.q) + '" data-search>' +
      '<select aria-label="Sort" data-sort>' +
      '<option value="created">Newest first</option><option value="name">Name A–Z</option><option value="scans">Most scans</option>' +
      '</select></div><div data-table><div class="empty">Loading…</div></div></div>';
    $("[data-sort]", main).value = listState.sort;
    bindNew(main);

    const tableBox = $("[data-table]", main);
    let seq = 0;
    async function load() {
      const mine = ++seq;
      const params = new URLSearchParams({ sort: listState.sort });
      if (listState.q) params.set("q", listState.q);
      let codes;
      try {
        codes = await api("GET", "api/qr-codes?" + params);
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
        '<th><span class="hidden">Preview</span></th><th>Name</th><th class="hide-sm">Target</th><th>Status</th><th class="num">Scans</th><th class="hide-sm">Created</th><th><span class="hidden">Actions</span></th>' +
        "</tr></thead><tbody>" + codes.map((q) =>
          "<tr>" +
          '<td><a href="#/codes/' + q.id + '" aria-label="Open ' + esc(q.name) + '"><img class="thumb" loading="lazy" alt="" src="' + imgUrl(q, "svg", { size: 128, border: 2 }) + '"></a></td>' +
          '<td class="cell-name"><a href="#/codes/' + q.id + '">' + esc(q.name) + '</a><div class="faint small mono">/r/' + esc(q.code) + "</div></td>" +
          '<td class="cell-url hide-sm" title="' + esc(q.target_url) + '">' + esc(q.target_url) + "</td>" +
          "<td>" + (q.is_active ? '<span class="status">Active</span>' : '<span class="status status-off">Inactive</span>') + "</td>" +
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

  // ---------- studio: style vocabulary ----------

  const DEFAULT_STYLE = {
    dots: "square", eye_frame: "square", eye_ball: "square",
    fg: "#000000", fg2: null, gradient: "none", eye_color: null, bg: "#ffffff",
  };

  const PRESETS = [
    { name: "Classic", style: {} },
    { name: "Ink dots", style: { dots: "dots", eye_frame: "circle", eye_ball: "circle", fg: "#1b2230" } },
    { name: "Riso", style: { dots: "rounded", eye_frame: "rounded", eye_ball: "rounded", fg: "#0078bf", eye_color: "#d9007e" } },
    { name: "Blueprint", style: { dots: "tiny", fg: "#0b3d91", bg: "#e8f1fb" } },
    { name: "Candy", style: { dots: "dots", eye_frame: "leaf", eye_ball: "circle", fg: "#d9007e", fg2: "#765ba7", gradient: "linear" } },
    { name: "Barcode", style: { dots: "bars-v", fg: "#1b2230" } },
  ].map((p) => ({ name: p.name, style: Object.assign({}, DEFAULT_STYLE, p.style) }));

  // Riso drum colours, named the way a print shop would.
  const INKS = [
    ["Black", "#000000"], ["Midnight", "#1b2230"], ["Blue", "#0078bf"], ["Teal", "#00838a"],
    ["Green", "#00a95c"], ["Magenta", "#d9007e"], ["Fluorescent pink", "#ff48b0"], ["Bright red", "#f15060"],
    ["Purple", "#765ba7"], ["Orange", "#ff6c2f"],
  ];
  const PAPERS = [["White", "#ffffff"], ["Grey stock", "#eef1f4"], ["Yellow", "#ffe800"], ["Pale blue", "#e8f1fb"]];

  const DOTS = [
    ["square", "Square"], ["dots", "Dots"], ["rounded", "Rounded"], ["diamond", "Diamond"],
    ["bars-v", "Vertical bars"], ["bars-h", "Horizontal bars"], ["tiny", "Tiny squares"],
  ];
  const FRAMES = [["square", "Square"], ["rounded", "Rounded"], ["circle", "Circle"], ["leaf", "Leaf"]];
  const BALLS = [["square", "Square"], ["rounded", "Rounded"], ["circle", "Circle"], ["diamond", "Diamond"]];

  const normStyle = (s) => {
    const o = Object.assign({}, DEFAULT_STYLE, s || {});
    for (const k of ["fg", "fg2", "eye_color", "bg"]) if (o[k]) o[k] = o[k].toLowerCase();
    if (o.gradient === "none") o.fg2 = null;
    return o;
  };
  const sameStyle = (a, b) => Object.keys(DEFAULT_STYLE).every((k) => a[k] === b[k]);

  // One module of the data pattern, drawn the way the server draws it (roughly).
  // Bars are merged along runs, so they need the whole grid.
  function modulesSvg(cells, kind) {
    let out = "";
    const on = (x, y) => cells.has(x + "," + y);
    if (kind === "bars-v" || kind === "bars-h") {
      const v = kind === "bars-v";
      const seen = new Set();
      cells.forEach((key) => {
        if (seen.has(key)) return;
        let [x, y] = key.split(",").map(Number);
        let len = 0;
        while (on(v ? x : x + len, v ? y + len : y)) { seen.add((v ? x : x + len) + "," + (v ? y + len : y)); len++; }
        out += v
          ? '<rect x="' + (x + 0.15) + '" y="' + (y + 0.05) + '" width="0.7" height="' + (len - 0.1) + '" rx="0.35"/>'
          : '<rect x="' + (x + 0.05) + '" y="' + (y + 0.15) + '" width="' + (len - 0.1) + '" height="0.7" ry="0.35"/>';
      });
      return out;
    }
    cells.forEach((key) => {
      const [x, y] = key.split(",").map(Number);
      if (kind === "dots") out += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.42"/>';
      else if (kind === "rounded") out += '<rect x="' + (x + 0.05) + '" y="' + (y + 0.05) + '" width="0.9" height="0.9" rx="0.32"/>';
      else if (kind === "diamond") out += '<path d="M' + (x + 0.5) + " " + y + "l.5 .5-.5 .5-.5-.5z" + '"/>';
      else if (kind === "tiny") out += '<rect x="' + (x + 0.22) + '" y="' + (y + 0.22) + '" width="0.56" height="0.56"/>';
      else out += '<rect x="' + x + '" y="' + y + '" width="1.02" height="1.02"/>';
    });
    return out;
  }

  // Rounded rectangle with selectable corners (tl, tr, br, bl), used for leaf eyes.
  function roundRect(x, y, w, h, r, corners) {
    const c = corners.map((on) => (on ? r : 0));
    return "M" + (x + c[0]) + " " + y + "H" + (x + w - c[1]) + (c[1] ? "a" + c[1] + " " + c[1] + " 0 0 1 " + c[1] + " " + c[1] : "") +
      "V" + (y + h - c[2]) + (c[2] ? "a" + c[2] + " " + c[2] + " 0 0 1 -" + c[2] + " " + c[2] : "") +
      "H" + (x + c[3]) + (c[3] ? "a" + c[3] + " " + c[3] + " 0 0 1 -" + c[3] + " -" + c[3] : "") +
      "V" + (y + c[0]) + (c[0] ? "a" + c[0] + " " + c[0] + " 0 0 1 " + c[0] + " -" + c[0] : "") + "Z";
  }

  function frameSvg(x, y, kind, flip) {
    const leaf = flip ? [false, true, false, true] : [true, false, true, false];
    if (kind === "circle") return '<circle cx="' + (x + 3.5) + '" cy="' + (y + 3.5) + '" r="3" fill="none" stroke-width="1"/>';
    const r = kind === "rounded" ? 1.6 : kind === "leaf" ? 2.6 : 0;
    const corners = kind === "leaf" ? leaf : [true, true, true, true];
    return '<path d="' + roundRect(x + 0.5, y + 0.5, 6, 6, r, corners) + '" fill="none" stroke-width="1"/>';
  }

  function ballSvg(x, y, kind) {
    if (kind === "circle") return '<circle cx="' + (x + 1.5) + '" cy="' + (y + 1.5) + '" r="1.5"/>';
    if (kind === "diamond") return '<path d="M' + (x + 1.5) + " " + (y - 0.2) + "l1.7 1.7-1.7 1.7-1.7-1.7z" + '"/>';
    const r = kind === "rounded" ? 0.8 : 0;
    return '<rect x="' + x + '" y="' + y + '" width="3" height="3" rx="' + r + '"/>';
  }

  // A fixed 21×21 pseudo-random pattern for the preset thumbnails: real-looking, stable.
  const MINI = (function () {
    const cells = new Set();
    let seed = 7;
    const inEye = (x, y) => (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < 21; x++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        if (!inEye(x, y) && seed % 100 < 48) cells.add(x + "," + y);
      }
    }
    return cells;
  })();

  let gradSeq = 0;
  function miniQr(s) {
    const id = "mg" + (++gradSeq);
    const grad = s.gradient !== "none" && s.fg2;
    let defs = "";
    if (grad) {
      defs = s.gradient === "radial"
        ? '<defs><radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="10.5" cy="10.5" r="12"><stop offset="0" stop-color="' + s.fg + '"/><stop offset="1" stop-color="' + s.fg2 + '"/></radialGradient></defs>'
        : '<defs><linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="21" y2="21"><stop offset="0" stop-color="' + s.fg + '"/><stop offset="1" stop-color="' + s.fg2 + '"/></linearGradient></defs>';
    }
    const ink = grad ? "url(#" + id + ")" : s.fg;
    const eye = s.eye_color || ink;
    const eyes = [[0, 0, false], [14, 0, true], [0, 14, true]].map(([x, y, flip]) =>
      '<g stroke="' + eye + '" fill="' + eye + '">' + frameSvg(x, y, s.eye_frame, flip) + ballSvg(x + 2, y + 2, s.eye_ball) + "</g>"
    ).join("");
    const bg = s.bg === "transparent" ? "" : '<rect x="-2" y="-2" width="25" height="25" fill="' + s.bg + '"/>';
    return '<svg viewBox="-2 -2 25 25" aria-hidden="true">' + defs + bg +
      '<g fill="' + ink + '">' + modulesSvg(MINI, s.dots) + "</g>" + eyes + "</svg>";
  }

  // Control tiles: a tiny sample of each shape in currentColor.
  const TILE_CELLS = new Set(["0,0", "0,1", "1,1", "1,2", "2,0", "2,2"]);
  function dotTile(kind) {
    return '<svg viewBox="-0.3 -0.3 3.6 3.6" fill="currentColor" aria-hidden="true">' + modulesSvg(TILE_CELLS, kind) + "</svg>";
  }
  function frameTile(kind) {
    return '<svg viewBox="-0.2 -0.2 7.4 7.4" stroke="currentColor" fill="none" aria-hidden="true">' + frameSvg(0, 0, kind, false) + "</svg>";
  }
  function ballTile(kind) {
    return '<svg viewBox="-0.6 -0.6 4.2 4.2" fill="currentColor" aria-hidden="true">' + ballSvg(0, 0, kind) + "</svg>";
  }

  // WCAG relative luminance and contrast; scanners have similar needs.
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  const contrast = (a, b) => {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  function styleWarnings(s) {
    const bg = s.bg === "transparent" ? "#ffffff" : s.bg;
    const inks = [s.fg];
    if (s.gradient !== "none" && s.fg2) inks.push(s.fg2);
    if (s.eye_color) inks.push(s.eye_color);
    const warns = [];
    const worst = Math.min(...inks.map((c) => contrast(c, bg)));
    if (worst < 4) {
      warns.push("Low contrast (" + worst.toFixed(1) + ":1). Many phones need at least 4:1 between ink and background to scan reliably.");
    }
    if (inks.some((c) => luminance(c) > luminance(bg))) {
      warns.push("Light ink on a dark background. Some older scanner apps cannot read inverted codes.");
    }
    if (s.bg === "transparent") {
      warns.push("Transparent background. Place the code on a light, plain surface so it stays readable.");
    }
    return warns;
  }

  // ---------- studio ----------

  function inkRow(key, list, extra) {
    return '<div class="inks" role="group">' + (extra || "") +
      list.map(([name, hex]) =>
        '<button type="button" class="ink" data-ink="' + key + '" data-val="' + hex + '" data-bg="' + hex + '" title="' + name + '" aria-label="' + name + '"></button>'
      ).join("") +
      '<label class="ink-custom" title="Custom colour" data-custom="' + key + '"><input type="color" data-color="' + key + '" aria-label="Custom colour"></label></div>';
  }

  function tileRow(key, list, draw) {
    return '<div class="tiles" role="group">' + list.map(([val, name]) =>
      '<button type="button" class="tile" data-tile="' + key + '" data-val="' + val + '" title="' + name + '" aria-label="' + name + '">' + draw(val) + "</button>"
    ).join("") + "</div>";
  }

  function studioHtml(qr) {
    return '<section class="studio" aria-label="Style">' +
      '<div class="proof-bed"><div class="proof-pin">' +
      '<div class="proof"><div class="proof-art" data-art><img alt="Preview of the styled QR code for ' + esc(qr.short_url) + '" data-proof>' + proofMarks() + "</div></div>" +
      '<div class="proof-meta"><span data-proof-state>Saved style</span><span data-proof-spec></span></div>' +
      '<div data-warns></div>' +
      "</div></div>" +
      '<div class="controls">' +
      '<div class="ctl-group"><h3>Start from a preset</h3><div class="presets">' +
      PRESETS.map((p, i) => '<button type="button" class="preset" data-preset="' + i + '">' + miniQr(p.style) + esc(p.name) + "</button>").join("") +
      "</div></div>" +
      '<div class="ctl-group"><h3>Shape</h3>' +
      '<div class="ctl-sub">Modules</div>' + tileRow("dots", DOTS, dotTile) +
      '<div class="ctl-sub">Corner frames</div>' + tileRow("eye_frame", FRAMES, frameTile) +
      '<div class="ctl-sub">Corner centres</div>' + tileRow("eye_ball", BALLS, ballTile) +
      "</div>" +
      '<div class="ctl-group"><h3>Ink</h3>' +
      '<div class="ctl-sub"><span>Main ink</span><span class="ink-hex" data-hex="fg"></span></div>' + inkRow("fg", INKS) +
      '<div class="ctl-sub">Blend</div>' +
      '<div class="seg" role="group" aria-label="Blend">' +
      '<button type="button" data-grad="none">Solid</button><button type="button" data-grad="linear">Linear</button><button type="button" data-grad="radial">Radial</button></div>' +
      '<div data-fg2><div class="ctl-sub"><span>Second ink</span><span class="ink-hex" data-hex="fg2"></span></div>' + inkRow("fg2", INKS) + "</div>" +
      '<div class="ctl-sub"><span>Corner ink</span><span class="ink-hex" data-hex="eye_color"></span></div>' +
      inkRow("eye_color", INKS, '<button type="button" class="ink auto" data-ink="eye_color" data-val="" title="Same as main ink" aria-label="Same as main ink"></button>') +
      '<div class="ctl-sub"><span>Paper</span><span class="ink-hex" data-hex="bg"></span></div>' +
      inkRow("bg", PAPERS).replace('<label class="ink-custom"',
        '<button type="button" class="ink clear" data-ink="bg" data-val="transparent" title="Transparent" aria-label="Transparent"></button><label class="ink-custom"') +
      "</div>" +
      '<div class="ctl-group"><h3>Logo <small>PNG or JPEG, up to 512 KB</small></h3>' +
      '<div class="logo-row"><input type="file" id="logo-file" accept="image/png,image/jpeg" data-logo-file>' +
      '<label for="logo-file" class="btn btn-sm">' + icon("upload") + '<span data-logo-label>Add logo</span></label>' +
      '<button type="button" class="btn btn-sm btn-danger" data-logo-del>Remove logo</button>' +
      '<span class="help" data-logo-help></span></div></div>' +
      '<div class="ctl-foot"><button type="button" class="btn btn-primary" data-save>Save style</button>' +
      '<button type="button" class="btn" data-discard>Discard changes</button>' +
      '<span class="dirty-flag" data-dirty>Unsaved changes</span><span class="spacer"></span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-classic>Reset to classic</button></div>' +
      '<form class="export" data-dl novalidate><h3>Download</h3><div class="export-grid">' +
      '<div class="field"><label for="d-fmt">Format</label><select id="d-fmt" name="fmt"><option value="png">PNG</option><option value="svg">SVG</option></select></div>' +
      '<div class="field"><label for="d-size">Size (px)</label><select id="d-size" name="size"><option>256</option><option>512</option><option selected>1024</option><option>2048</option><option>4096</option></select></div>' +
      '<div class="field"><label for="d-ec">Error correction</label><select id="d-ec" name="ec">' +
      '<option value="L">L (7%)</option><option value="M" selected>M (15%)</option><option value="Q">Q (25%)</option><option value="H">H (30%)</option></select></div>' +
      '<div class="field"><label for="d-border">Quiet zone</label><select id="d-border" name="border"><option>0</option><option>2</option><option selected>4</option><option>6</option><option>8</option></select></div>' +
      "</div>" +
      '<a class="btn btn-primary" data-dl-link href="#">' + icon("download") + "Download</a>" +
      '<span class="help" data-dl-help></span>' +
      "</form></div></section>";
  }

  function mountStudio(main, qr, onSaved) {
    let saved = normStyle(qr.style);
    let draft = Object.assign({}, saved);
    let hasLogo = !!qr.has_logo;
    let current = qr;

    const art = $("[data-art]", main);
    const img = $("[data-proof]", main);
    const dl = $("[data-dl]", main);
    const link = $("[data-dl-link]", main);

    // Swatch colours go in through CSSOM, never as style="" (CSP).
    $all("[data-bg]", main).forEach((b) => { b.style.background = b.dataset.bg; });

    // --- live proof ---
    let seq = 0, timer = null;
    function scheduleProof(now) {
      clearTimeout(timer);
      timer = setTimeout(drawProof, now ? 0 : 150);
    }
    async function drawProof() {
      const mine = ++seq;
      art.classList.add("busy");
      const f = dl.elements;
      try {
        const res = await request("POST", "api/qr-codes/" + qr.id + "/preview.svg", {
          type: "application/json",
          accept: "image/svg+xml",
          body: JSON.stringify({ style: draft, ec: hasLogo ? "H" : f.ec.value, border: Number(f.border.value) }),
        });
        const svg = await res.text();
        if (mine !== seq) return;
        img.onload = () => {
          art.classList.remove("register");
          void art.offsetWidth; // restart the animation
          art.classList.add("register");
        };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      } catch (err) {
        if (mine === seq) toast(err.message, true);
      } finally {
        if (mine === seq) art.classList.remove("busy");
      }
    }

    // --- control state ---
    function sync() {
      const dirty = !sameStyle(draft, saved);
      $all("[data-tile]", main).forEach((b) => b.setAttribute("aria-pressed", String(draft[b.dataset.tile] === b.dataset.val)));
      $all("[data-preset]", main).forEach((b) => b.setAttribute("aria-pressed", String(sameStyle(draft, PRESETS[b.dataset.preset].style))));
      $all("[data-grad]", main).forEach((b) => b.setAttribute("aria-pressed", String(draft.gradient === b.dataset.grad)));
      $("[data-fg2]", main).classList.toggle("hidden", draft.gradient === "none");
      for (const key of ["fg", "fg2", "eye_color", "bg"]) {
        const val = draft[key] || "";
        let matched = false;
        $all('[data-ink="' + key + '"]', main).forEach((b) => {
          const on = b.dataset.val === val;
          matched = matched || on;
          b.setAttribute("aria-pressed", String(on));
        });
        $('[data-custom="' + key + '"]', main).classList.toggle("on", !matched && !!val);
        const picker = $('[data-color="' + key + '"]', main);
        if (/^#[0-9a-f]{6}$/.test(val)) picker.value = val;
        $('[data-hex="' + key + '"]', main).textContent =
          key === "eye_color" && !val ? "same as main" : val === "transparent" ? "none" : val;
      }
      art.classList.toggle("transparent", draft.bg === "transparent");
      $("[data-proof-state]", main).textContent = dirty ? "Proof of unsaved changes" : "Saved style";
      $("[data-dirty]", main).classList.toggle("hidden", !dirty);
      $("[data-save]", main).disabled = !dirty;
      $("[data-discard]", main).classList.toggle("hidden", !dirty);
      $("[data-classic]", main).disabled = sameStyle(draft, DEFAULT_STYLE);
      $("[data-warns]", main).innerHTML = styleWarnings(draft).map((w) =>
        '<div class="warn" role="status">' + icon("alert") + "<span>" + esc(w) + "</span></div>").join("");

      $("[data-logo-label]", main).textContent = hasLogo ? "Replace logo" : "Add logo";
      $("[data-logo-del]", main).classList.toggle("hidden", !hasLogo);
      $("[data-logo-help]", main).textContent = hasLogo ? "Error correction is locked to H so the code still scans." : "";

      const f = dl.elements;
      if (hasLogo) f.ec.value = "H";
      f.ec.disabled = hasLogo;
      $("[data-proof-spec]", main).textContent =
        "EC " + (hasLogo ? "H" : f.ec.value) + ", quiet zone " + f.border.value;
      const p = { size: f.size.value, ec: hasLogo ? "H" : f.ec.value, border: f.border.value, download: "1" };
      link.href = imgUrl(current, f.fmt.value, p);
      link.setAttribute("aria-disabled", String(dirty));
      if (dirty) link.setAttribute("tabindex", "-1"); else link.removeAttribute("tabindex");
      $("[data-dl-help]", main).textContent = dirty
        ? "Save or discard your changes first. Downloads use the saved style."
        : "Higher error correction survives scratches and logos but makes the pattern denser. Keep a quiet zone of 4 for reliable scanning.";
    }

    function change(patch) {
      draft = normStyle(Object.assign({}, draft, patch));
      sync();
      scheduleProof();
    }

    $all("[data-preset]", main).forEach((b) => b.addEventListener("click", () =>
      change(PRESETS[b.dataset.preset].style)));
    $all("[data-tile]", main).forEach((b) => b.addEventListener("click", () =>
      change({ [b.dataset.tile]: b.dataset.val })));
    $all("[data-ink]", main).forEach((b) => b.addEventListener("click", () =>
      change({ [b.dataset.ink]: b.dataset.val || null })));
    $all("[data-color]", main).forEach((inp) => inp.addEventListener("input", () =>
      change({ [inp.dataset.color]: inp.value })));
    $all("[data-grad]", main).forEach((b) => b.addEventListener("click", () => {
      const g = b.dataset.grad;
      const patch = { gradient: g };
      if (g !== "none" && !draft.fg2) patch.fg2 = draft.fg === "#d9007e" ? "#765ba7" : "#d9007e";
      change(patch);
    }));
    $("[data-classic]", main).addEventListener("click", () => change(DEFAULT_STYLE));
    $("[data-discard]", main).addEventListener("click", () => change(saved));

    $("[data-save]", main).addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        current = await api("PATCH", "api/qr-codes/" + qr.id, { style: draft });
        saved = normStyle(current.style);
        draft = Object.assign({}, saved);
        toast("Style saved.");
        onSaved(current);
      } catch (err) {
        toast(err.message, true);
      }
      sync();
    });

    // --- logo: stored right away, it is not part of the draft ---
    const fileInput = $("[data-logo-file]", main);
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      if (!["image/png", "image/jpeg"].includes(file.type)) return toast("The logo must be a PNG or JPEG file.", true);
      if (file.size > 512 * 1024) return toast("The logo must be at most 512 KB.", true);
      try {
        current = await request("PUT", "api/qr-codes/" + qr.id + "/logo", { type: file.type, body: file })
          .then((r) => r.json());
        hasLogo = true;
        toast("Logo added.");
        onSaved(current);
        sync();
        scheduleProof(true);
      } catch (err) {
        toast(err.message, true);
      }
    });
    $("[data-logo-del]", main).addEventListener("click", async () => {
      try {
        current = await api("DELETE", "api/qr-codes/" + qr.id + "/logo");
        hasLogo = false;
        toast("Logo removed.");
        onSaved(current);
        sync();
        scheduleProof(true);
      } catch (err) {
        toast(err.message, true);
      }
    });

    dl.addEventListener("change", (e) => {
      sync();
      if (e.target.name === "ec" || e.target.name === "border") scheduleProof();
    });
    link.addEventListener("click", (e) => { if (link.getAttribute("aria-disabled") === "true") e.preventDefault(); });

    sync();
    scheduleProof(true);
  }

  // ---------- detail ----------

  async function viewDetail(main, id) {
    let qr, st;
    try {
      [qr, st] = await Promise.all([
        api("GET", "api/qr-codes/" + id),
        api("GET", "api/qr-codes/" + id + "/stats?days=30"),
      ]);
    } catch (err) {
      if (err.status === 404 || err.status === 422) {
        main.innerHTML = '<div class="sheet empty"><h2>QR code not found</h2><p>It may have been deleted.</p><a class="btn" href="#/codes">Back to QR codes</a></div>';
        return;
      }
      throw err;
    }
    let unit = "day";
    const series = () => (unit === "day" ? st.daily : unit === "week" ? st.weekly : st.monthly);

    main.innerHTML =
      '<a class="back" href="#/codes">' + icon("back") + "All QR codes</a>" +
      '<div class="page-head"><div><h1>' + esc(qr.name) + "</h1>" +
      '<div class="sub" data-updated></div></div>' +
      '<div class="head-actions"><label class="switch"><input type="checkbox" data-active' + (qr.is_active ? " checked" : "") + "><span></span>" +
      (qr.is_active ? "Active" : "Inactive") + "</label>" +
      '<button class="btn" data-edit>Edit details</button></div></div>' +
      '<div class="link-line"><span class="short"><span>' + esc(qr.short_url) + "</span>" +
      '<button class="btn btn-sm btn-icon btn-ghost" data-copy title="Copy short link" aria-label="Copy short link">' + icon("copy") + "</button></span>" +
      '<span>sends people to</span><a class="target" href="' + esc(qr.target_url) + '" target="_blank" rel="noopener noreferrer">' + esc(qr.target_url) + "</a></div>" +
      (qr.description ? '<p class="muted">' + esc(qr.description) + "</p>" : "") +
      (qr.is_active ? "" : '<div class="inactive-banner">This code is inactive. Scans show an “inactive” page and are not redirected.</div>') +
      studioHtml(qr) +
      '<div class="stack">' +
      '<div class="sheet figures">' +
      fig("Total scans", fmtNum(st.total), st.likely_bots ? fmtNum(st.likely_bots) + " likely bots" : "") +
      fig("Today", fmtNum(st.today)) +
      fig("This week", fmtNum(st.this_week)) +
      fig("This month", fmtNum(st.this_month)) +
      "</div>" +
      '<div class="sheet"><div class="sheet-head"><div><h2>Scans</h2><div class="faint small">Last scan ' +
      (st.last_scan_at ? fmtDate(st.last_scan_at, true) : "never") + ", times in " + esc(st.timezone) + "</div></div>" +
      '<div class="seg" role="group" aria-label="Chart range"><button data-unit="day" class="on">Daily</button><button data-unit="week">Weekly</button><button data-unit="month">Monthly</button></div></div>' +
      '<div class="sheet-pad"><div data-chart></div>' + LEGEND + "</div>" + SCAN_NOTE + "</div>" +
      '<div class="cols cols-3">' +
      '<div class="sheet sheet-pad"><h2>Devices</h2>' + hbars(st.devices) + "</div>" +
      '<div class="sheet sheet-pad"><h2>Browsers</h2>' + hbars(st.browsers) + "</div>" +
      '<div class="sheet sheet-pad"><h2>Referrers</h2>' + hbars(st.referrers) + "</div>" +
      "</div>" +
      '<div class="sheet sheet-pad danger-zone"><div><h2>Delete this QR code</h2><p class="small muted">Removes the code and its statistics. Printed copies stop working.</p></div>' +
      '<button class="btn btn-danger" data-del>Delete QR code</button></div>' +
      "</div>";

    const showUpdated = (q) => {
      $("[data-updated]", main).textContent = "Created " + fmtDate(q.created_at) + ", last changed " + fmtDate(q.updated_at, true);
    };
    showUpdated(qr);
    mountStudio(main, qr, (q) => { qr = q; showUpdated(q); });

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
        await api("PATCH", "api/qr-codes/" + qr.id, { is_active: toggle.checked });
        toast(toggle.checked ? "QR code activated." : "QR code deactivated.");
        reload();
      } catch (err) {
        toggle.checked = !toggle.checked;
        toggle.disabled = false;
        toast(err.message, true);
      }
    });
  }

  // ---------- settings ----------

  async function viewSettings(main) {
    const u = state.user;
    main.innerHTML =
      '<div class="page-head"><div><h1>Settings</h1><div class="sub">Your account and password.</div></div></div>' +
      '<div class="cols cols-2">' +
      '<div class="sheet"><div class="sheet-head"><h2>Account</h2></div><div class="sheet-pad">' +
      '<p class="small"><span class="muted">Username</span><br><strong>' + esc(u.username) + "</strong></p>" +
      '<p class="small"><span class="muted">Email</span><br>' + (u.email ? esc(u.email) : "Not set") + "</p>" +
      '<p class="small"><span class="muted">Role</span><br>' + (u.is_admin ? "Administrator" : "User") + "</p>" +
      '<p class="small"><span class="muted">Member since</span><br>' + fmtDate(u.created_at) + "</p>" +
      '<button class="btn" data-logout2>' + icon("logout") + "Sign out</button></div></div>" +
      '<div class="sheet"><div class="sheet-head"><h2>Change password</h2></div><div class="sheet-pad">' +
      '<form novalidate><div class="form-error hidden" data-error></div>' +
      '<input type="text" name="username" autocomplete="username" value="' + esc(u.username) + '" class="hidden" tabindex="-1" aria-hidden="true">' +
      '<div class="field"><label for="p-cur">Current password</label><input class="input" id="p-cur" name="current" type="password" autocomplete="current-password" required></div>' +
      '<div class="field"><label for="p-new">New password</label><input class="input" id="p-new" name="next" type="password" autocomplete="new-password" required minlength="10">' +
      '<span class="help">At least 10 characters. Your other devices will be signed out.</span></div>' +
      '<div class="field"><label for="p-new2">Repeat new password</label><input class="input" id="p-new2" name="next2" type="password" autocomplete="new-password" required></div>' +
      '<button class="btn btn-primary" type="submit">Change password</button></form></div></div>' +
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
        await api("POST", "api/auth/change-password", { current_password: f.current.value, new_password: f.next.value });
        form.reset();
        $("[data-error]", form).classList.add("hidden");
        toast("Password changed.");
      } catch (err) {
        showFormError(form, err.message);
      }
      btn.disabled = false;
    });
  }

  // ---------- router ----------

  function showError(err) {
    const main = document.getElementById("main");
    if (err instanceof ApiError && err.status === 401) return; // handled in request()
    if (main) main.innerHTML = '<div class="sheet empty"><h2>Something went wrong</h2><p>' + esc(err.message) + "</p></div>";
    else toast(err.message, true);
  }

  function route() {
    const h = location.hash.replace(/^#/, "") || "/";
    let m;
    if (h === "/") return { key: "home", view: viewOverview };
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
      const s = await api("GET", "api/auth/status");
      state.setupRequired = s.setup_required;
      if (s.authenticated) { state.user = s.user; state.csrf = s.csrf_token; }
    } catch (err) {
      root.innerHTML = '<div class="auth"><div class="auth-card"><h1>Cannot reach the server</h1><p>' + esc(err.message) + "</p></div></div>";
      return;
    }
    window.addEventListener("hashchange", render);
    render();
  }

  boot();
})();
