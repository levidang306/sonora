"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (n, cls = "") => `<svg class="ic ${cls}"><use href="#i-${n}"/></svg>`;
const fmtT = (s) => { if (!isFinite(s) || s == null) return "–:––"; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
const fmtB = (b) => { if (!b) return "0 B"; const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${b.toFixed(i > 2 ? 1 : 0)} ${u[i]}`; };
const short = (p) => (p || "").replace(/^\/Users\/[^/]+/, "~").replace(/^C:\\Users\\[^\\]+/i, "~");
const cover = (t) => `/api/tracks/${t.id}/cover`;
const tag = (q, extra = "") => q ? `<span class="tag ${esc(q.tier)}" title="${q.tier === "lossless" ? "Lossless / bản gốc" : q.tier === "good" ? "Nén, chất lượng tốt" : "Chất lượng thấp hoặc không xác định"}">${esc(q.label)}${extra}</span>` : `<span class="tag"><span class="spin"></span>Checking</span>`;

async function api(url, opts = {}) {
  if (opts.json !== undefined) { opts.body = JSON.stringify(opts.json); opts.headers = { "Content-Type": "application/json" }; opts.method = opts.method || "POST"; }
  const r = await fetch(url, opts);
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : null;
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600); }
function modal(html, cls = "") {
  const m = document.createElement("div"); m.className = "modal-veil";
  m.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(m); return m;
}
function ask(title, value = "", ok = "Save") {
  return new Promise((res) => {
    const m = modal(`<h3>${esc(title)}</h3><input class="input" style="width:100%" value="${esc(value)}"><div class="modal-actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>${esc(ok)}</button></div>`);
    const inp = m.querySelector("input"); inp.focus(); inp.select();
    const done = (v) => { m.remove(); res(v); };
    m.querySelector("[data-x]").onclick = () => done(null);
    m.querySelector("[data-ok]").onclick = () => done(inp.value.trim() || null);
    inp.onkeydown = (e) => { if (e.key === "Enter") done(inp.value.trim() || null); if (e.key === "Escape") done(null); };
  });
}
function confirmBox(title, body, ok = "OK") {
  return new Promise((res) => {
    const m = modal(`<h3>${esc(title)}</h3><p class="muted">${body}</p><div class="modal-actions"><button class="btn ghost" data-x>Cancel</button><button class="btn danger" data-ok>${esc(ok)}</button></div>`);
    m.querySelector("[data-x]").onclick = () => { m.remove(); res(false); };
    m.querySelector("[data-ok]").onclick = () => { m.remove(); res(true); };
  });
}
function termsGate() {
  if (S.st.settings.accepted_terms) return;
  const m = modal(`<div class="eyebrow">Trước khi bắt đầu</div><h3 style="font-size:22px;margin:8px 0 12px">Sonora là trình phát nhạc local</h3>
    <p>Tính năng <b>import từ link</b> chỉ dành cho nội dung bạn <b>sở hữu hoặc được phép tải</b>: nhạc của chính bạn, nhạc Creative Commons, hoặc bài nghệ sĩ bật nút tải.</p>
    <p class="muted">Tải nhạc có bản quyền khi chưa được phép có thể vi phạm luật bản quyền và điều khoản sử dụng của SoundCloud, YouTube, Spotify. Với link Spotify, Sonora chỉ lấy thông tin bài hát từ Spotify và tìm bản tương ứng trên YouTube Music — không phá DRM của Spotify. Bạn tự chịu trách nhiệm về nội dung mình tải.</p>
    <p class="muted" style="font-size:12px">Sonora is a local music player. Only import content you own or have permission to download. You are responsible for complying with copyright law and each service's terms.</p>
    <div class="modal-actions"><button class="btn" data-ok>Tôi hiểu và đồng ý</button></div>`, "wide");
  m.querySelector("[data-ok]").onclick = async () => { await api("/api/settings", { json: { accepted_terms: true } }); S.st.settings.accepted_terms = true; m.remove(); };
}
async function checkUpdates() {
  try { S.upd = await api("/api/update-check"); } catch { return; }
  renderSidebar();
  if (route().view === "settings") renderSettings();
}
const store = { get(k, d) { try { const v = localStorage.getItem("sonora." + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem("sonora." + k, JSON.stringify(v)); } catch {} } };

const S = {
  st: null, tracks: [], q: "", tier: "", sel: new Set(),
  preview: null, pq: null, psel: new Set(), jobs: [],
  queue: [], qi: -1, cur: null, mode: null, shuffle: store.get("shuffle", false), repeat: store.get("repeat", "off"),
};
const audio = $("#audio");
audio.volume = store.get("vol", 0.9);
$("#vol").value = audio.volume;

/* ================================================================ routing */
function route() {
  const h = location.hash.replace(/^#\/?/, "") || "all";
  const [view, ...rest] = h.split("/");
  return { view, arg: decodeURIComponent(rest.join("/")) };
}
window.addEventListener("hashchange", () => { S.sel.clear(); render(); });

const TITLES = { all: "All music", favorites: "Favorites", recent: "Recently added", playlists: "Playlists", folders: "Local folders", import: "Import preview", downloads: "Downloads", settings: "Settings" };

async function refreshState() { S.st = await api("/api/state"); renderSidebar(); renderTop(); }

function renderSidebar() {
  const r = route(), st = S.st; if (!st) return;
  const a = (href, icon, label, extra = "", cls = "") => `<a href="#/${href}" class="${cls} ${("#/" + href) === location.hash || (href === "all" && !location.hash) ? "active" : ""}">${icon ? ic(icon) : ""}<span class="t">${esc(label)}</span>${extra}</a>`;
  const running = st.running ? `<span class="pill">${st.running}</span>` : "";
  $("#nav").innerHTML = `
    <div class="nav-label">Library</div>
    ${a("all", "grid", "All music", `<span class="n">${st.tracks}</span>`)}
    ${a("favorites", "heart", "Favorites")}
    ${a("recent", "clock", "Recently added")}
    <div class="nav-label">Collection <button id="newPl" title="New playlist">${ic("plus", "sm")}</button></div>
    ${a("playlists", "list", "Playlists")}
    ${st.playlists.map((p) => a(`playlist/${p.id}`, "", p.name, `<span class="n">${p.n}</span>`, "sub")).join("")}
    ${a("folders", "folder", "Local folders")}
    <div class="nav-label">Import</div>
    ${a("downloads", "download", "Downloads", running)}
    ${a("settings", "settings", "Settings")}`;
  $("#newPl").onclick = newPlaylist;
  $("#sourceCard").innerHTML = `<strong>Local-first</strong><span>Files stay on your device. Không tự convert, không cần tài khoản.</span><code>${esc(short(st.settings.storage))}</code>`
    + (S.upd?.app_update ? `<a class="upd" href="${esc(S.upd.app_url)}" target="_blank" rel="noopener">${ic("download", "sm")} Sonora ${esc(S.upd.app_latest)} đã có — tải về</a>` : "")
    + `<small class="ver">v${esc(st.version)} · engine ${esc(st.engine)}${S.upd?.engine_update ? ` · <a href="#/settings">cập nhật</a>` : ""}</small>`;
}

function renderTop() {
  const r = route(), st = S.st;
  let crumb = TITLES[r.view] || "";
  if (r.view === "playlist") crumb = `Playlists</span> / <b>${esc(st?.playlists.find((p) => p.id == r.arg)?.name || "")}`;
  else if (r.view === "folder") crumb = `Local folders</span> / <b>${esc(r.arg.split(/[\\/]/).pop())}`;
  else if (r.view === "track") crumb = `Library</span> / <b>Track detail`;
  else crumb = `Library</span> / <b>${esc(crumb)}`;
  $("#crumb").innerHTML = `<span>${crumb}</b>`;
  if (st) $("#storagePill").innerHTML = `<b>${fmtB(st.size)}</b> · ${fmtB(st.free)} free`;
}

/* ================================================================ views */
const LIB_VIEWS = ["all", "favorites", "recent", "playlist", "folder"];

async function render() {
  const r = route();
  renderSidebar(); renderTop();
  hideMenu();
  const main = $("#main");
  if (LIB_VIEWS.includes(r.view)) return renderLibrary(r);
  if (r.view === "import") return renderImport();
  if (r.view === "downloads") return renderDownloads();
  if (r.view === "settings") return renderSettings();
  if (r.view === "playlists") return renderPlaylists();
  if (r.view === "folders") return renderFolders();
  if (r.view === "track") return renderTrack(+r.arg);
  main.innerHTML = "";
}

async function loadTracks(r) {
  const p = new URLSearchParams({ view: r.view, q: S.q, tier: S.tier });
  if (r.view === "playlist") p.set("pid", r.arg);
  if (r.view === "folder") p.set("folder", r.arg);
  S.tracks = await api("/api/tracks?" + p);
  return S.tracks;
}

function importBox() {
  return `<div class="drop" id="dropzone">
    <div class="drop-icon">${ic("upload")}</div>
    <div class="txt"><strong>Import music</strong><small>Kéo thả file / folder, hoặc dán link SoundCloud, Spotify, YouTube, Bandcamp…</small></div>
    <div class="actions"><button class="btn ghost sm" id="addFolder">${ic("folder", "sm")} Folder</button><button class="btn" id="addFiles">${ic("plus", "sm")} Add music</button></div>
    <form class="urlbar" id="urlForm"><label class="field">${ic("link", "sm")}<input id="urlIn" placeholder="https://soundcloud.com/… hoặc https://open.spotify.com/playlist/…" autocomplete="off" /></label><button class="btn ghost" type="submit">Preview</button></form>
  </div>`;
}
function bindImportBox() {
  $("#addFiles").onclick = () => $("#fileInput").click();
  $("#addFolder").onclick = () => $("#folderInput").click();
  $("#urlForm").onsubmit = (e) => { e.preventDefault(); startPreview($("#urlIn").value.trim()); };
}

function trackRows(list, { playlist } = {}) {
  if (!list.length) return "";
  return `<div class="table">
    <div class="row head"><span></span><span>#</span><span></span><span>Title</span><span class="album">Album</span><span style="text-align:right">Quality</span><span style="text-align:right">Time</span><span></span></div>
    ${list.map((t, i) => `<div class="row ${S.cur?.id === t.id && S.mode === "lib" ? "playing" : ""}" data-i="${i}" data-id="${t.id}">
      <input class="check" type="checkbox" ${S.sel.has(t.id) ? "checked" : ""} aria-label="Select">
      <button class="play" title="Play">${ic(S.cur?.id === t.id && S.mode === "lib" && !audio.paused ? "pause" : "play")}</button>
      <div class="thumb" style="background-image:url('${cover(t)}')"></div>
      <div class="track"><b data-detail="${t.id}">${esc(t.title)}</b><small>${esc(t.artist)}</small></div>
      <span class="album">${esc(t.album)}</span>
      <div class="qcell">${tag({ label: t.q_label, tier: t.q_tier })}${t.source_label && t.source_label !== t.q_label ? `<small>from ${esc(t.source_label)}</small>` : ""}</div>
      <span class="duration">${fmtT(t.duration)}</span>
      <button class="icon-btn more" title="More">${ic("more")}</button>
    </div>`).join("")}
  </div>`;
}
function bindRows(list, ctx = {}) {
  $$(".row[data-id]").forEach((row) => {
    const i = +row.dataset.i, t = list[i];
    row.querySelector(".play").onclick = () => (S.cur?.id === t.id && S.mode === "lib") ? togglePlay() : playLib(list, i);
    row.ondblclick = (e) => { if (!e.target.closest("button,input")) playLib(list, i); };
    row.querySelector(".check").onchange = (e) => { e.target.checked ? S.sel.add(t.id) : S.sel.delete(t.id); renderBulk(); };
    row.querySelector("[data-detail]").onclick = () => (location.hash = `#/track/${t.id}`);
    row.querySelector(".more").onclick = (e) => trackMenu(e.currentTarget, t, ctx);
  });
}
function renderBulk() {
  let bar = $("#bulk");
  if (!S.sel.size) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement("div"); bar.id = "bulk"; bar.className = "sticky-foot"; $("#main").appendChild(bar); }
  bar.innerHTML = `<span><b>${S.sel.size}</b> <span class="muted">selected</span></span><div style="display:flex;gap:8px"><button class="btn ghost sm" id="bClear">Clear</button><button class="btn ghost sm" id="bPl">${ic("list", "sm")} Add to playlist</button><button class="btn sm" id="bPlaySel">${ic("play", "sm")} Play</button></div>`;
  $("#bClear").onclick = () => { S.sel.clear(); $$(".row .check").forEach((c) => (c.checked = false)); renderBulk(); };
  $("#bPlaySel").onclick = () => { const l = S.tracks.filter((t) => S.sel.has(t.id)); playLib(l, 0); };
  $("#bPl").onclick = (e) => playlistMenu(e.currentTarget, [...S.sel]);
}

async function renderLibrary(r) {
  const main = $("#main");
  const list = await loadTracks(r);
  const st = S.st;
  let head = "";
  if (r.view === "all") {
    head = `<div class="eyebrow">Your private music shelf</div><h1 class="headline">Bring your sound<br>home.</h1>
      <p class="sub">Tổng hợp nhạc từ nhiều nguồn, giữ nguyên chất lượng gốc và nghe ngay trên thiết bị của bạn.</p>${importBox()}
      <div class="section-head"><h2>${S.q || S.tier ? "Results" : "All music"}</h2><span>${list.length} tracks · ${fmtB(list.reduce((a, t) => a + (t.size || 0), 0))}</span></div>`;
  } else if (r.view === "playlist") {
    const pl = st.playlists.find((p) => p.id == r.arg);
    if (!pl) { main.innerHTML = `<div class="empty"><b>Playlist not found</b></div>`; return; }
    head = `<div class="page-head"><div class="art cover" style="width:150px;height:150px;padding:0">${list[0] ? `<img src="${cover(list[0])}" onerror="this.remove()">` : ""}</div><div>
      <div class="eyebrow">Playlist</div><h1>${esc(pl.name)}</h1><div class="meta">${list.length} tracks · ${fmtT(list.reduce((a, t) => a + (t.duration || 0), 0))}</div>
      <div class="actions"><button class="btn" id="plPlay" ${list.length ? "" : "disabled"}>${ic("play", "sm")} Play</button><button class="btn ghost" id="plRen">Rename</button><button class="btn danger" id="plDel">Delete playlist</button></div></div></div>`;
  } else {
    const label = r.view === "folder" ? r.arg.split(/[\\/]/).pop() : TITLES[r.view];
    head = `<div class="page-head"><div><div class="eyebrow">${r.view === "folder" ? "Local folder" : "Library"}</div><h1>${esc(label)}</h1>
      <div class="meta">${list.length} tracks${r.view === "folder" ? ` · <code>${esc(short(r.arg))}</code>` : ""}</div>
      <div class="actions"><button class="btn" id="plPlay" ${list.length ? "" : "disabled"}>${ic("play", "sm")} Play all</button>${r.view === "folder" ? `<button class="btn ghost" id="openF">${ic("external", "sm")} Open folder</button>` : ""}</div></div></div>`;
  }
  const empty = {
    all: S.q || S.tier ? `<div class="empty"><b>Không có bài nào khớp</b>Thử từ khoá hoặc bộ lọc khác.</div>` : `<div class="empty"><b>Thư viện đang trống</b>Dán một link ở trên hoặc kéo thả file nhạc vào cửa sổ này.</div>`,
    favorites: `<div class="empty"><b>Chưa có bài yêu thích</b>Bấm ♡ ở player hoặc menu ⋯ của bài hát.</div>`,
    recent: `<div class="empty"><b>Chưa có gì mới trong 14 ngày</b></div>`,
    playlist: `<div class="empty"><b>Playlist trống</b>Chọn bài trong All music → Add to playlist.</div>`,
    folder: `<div class="empty"><b>Folder trống</b></div>`,
  }[r.view];
  main.innerHTML = head + (list.length ? trackRows(list) : empty);
  if (r.view === "all") bindImportBox();
  bindRows(list, { playlist: r.view === "playlist" ? +r.arg : null });
  $("#plPlay") && ($("#plPlay").onclick = () => playLib(list, 0));
  $("#openF") && ($("#openF").onclick = () => api("/api/open", { json: { path: r.arg } }));
  if (r.view === "playlist") {
    $("#plRen").onclick = async () => { const n = await ask("Đổi tên playlist", st.playlists.find((p) => p.id == r.arg).name); if (n) { await api(`/api/playlists/${r.arg}`, { method: "PATCH", json: { name: n } }); await refreshState(); render(); } };
    $("#plDel").onclick = async () => { if (await confirmBox("Xoá playlist?", "File nhạc vẫn giữ nguyên trong thư viện.", "Delete")) { await api(`/api/playlists/${r.arg}`, { method: "DELETE" }); await refreshState(); location.hash = "#/playlists"; } };
  }
  renderBulk();
}

async function renderPlaylists() {
  await refreshState();
  const pls = S.st.playlists;
  $("#main").innerHTML = `<div class="page-head"><div><div class="eyebrow">Collection</div><h1>Playlists</h1><div class="meta">${pls.length} playlists</div>
    <div class="actions"><button class="btn" id="np">${ic("plus", "sm")} New playlist</button></div></div></div>
    ${pls.length ? `<div class="table">${pls.map((p) => `<a class="row" style="grid-template-columns:40px 1fr auto;text-decoration:none" href="#/playlist/${p.id}"><div class="thumb" style="display:grid;place-items:center;color:var(--muted)">${ic("list")}</div><div class="track"><b>${esc(p.name)}</b><small>${p.n} tracks</small></div><span class="duration">›</span></a>`).join("")}</div>`
      : `<div class="empty"><b>Chưa có playlist</b>Tạo playlist rồi thêm bài từ thư viện.</div>`}`;
  $("#np").onclick = newPlaylist;
}

async function renderFolders() {
  await refreshState();
  const f = S.st.folders;
  $("#main").innerHTML = `<div class="page-head"><div><div class="eyebrow">Collection</div><h1>Local folders</h1><div class="meta">Thư mục chứa nhạc trong thư viện · thêm thư mục khác trong Settings</div>
    <div class="actions"><button class="btn ghost" id="scanBtn">${ic("refresh", "sm")} Scan library</button><button class="btn ghost" id="openRoot">${ic("external", "sm")} Open storage</button></div></div></div>
    ${f.length ? `<div class="table">${f.map((x) => `<a class="row" style="grid-template-columns:40px 1fr auto;text-decoration:none" href="#/folder/${encodeURIComponent(x.path)}"><div class="thumb" style="display:grid;place-items:center;color:var(--muted)">${ic("folder")}</div><div class="track"><b>${esc(x.name)}</b><small>${esc(short(x.path))}</small></div><span class="duration">${x.n} tracks</span></a>`).join("")}</div>`
      : `<div class="empty"><b>Chưa có folder nào</b></div>`}`;
  $("#scanBtn").onclick = scanLib;
  $("#openRoot").onclick = () => api("/api/open", { json: {} });
}

async function renderTrack(id) {
  let t;
  try { t = await api(`/api/tracks/${id}`); } catch { $("#main").innerHTML = `<div class="empty"><b>Không tìm thấy bài</b></div>`; return; }
  const conv = t.source_label && t.source_label !== t.q_label;
  const tierTxt = { lossless: "Lossless / bản gốc — không mất dữ liệu.", good: "Nén có mất dữ liệu, chất lượng nghe tốt.", low: "Nén mạnh hoặc không rõ nguồn." }[t.q_tier];
  $("#main").innerHTML = `<div class="page-head"><div class="art cover ${t.has_cover ? "has-img" : ""}" style="width:190px;height:190px;padding:0">${t.has_cover ? `<img src="${cover(t)}">` : ""}</div><div style="min-width:0">
      <div class="eyebrow">Track</div><h1>${esc(t.title)}</h1><div class="meta">${esc(t.artist)}${t.album ? " · " + esc(t.album) : ""}${t.genre ? " · " + esc(t.genre) : ""}</div>
      <div class="actions"><button class="btn" id="tdPlay">${ic("play", "sm")} Play</button><button class="btn ghost" id="tdFav">${ic("heart", "sm")} ${t.favorite ? "Unfavorite" : "Favorite"}</button><button class="btn ghost" id="tdPl">${ic("list", "sm")} Add to playlist</button></div></div></div>
    <div class="notice ${t.q_tier === "lossless" ? "info" : t.q_tier === "good" ? "info" : "warn"}">${ic(t.q_tier === "low" ? "alert" : "info")}<div>${tag({ label: t.q_label, tier: t.q_tier })} &nbsp;${tierTxt}${conv ? `<br>File này được convert từ nguồn <b>${esc(t.source_label)}</b> — chất lượng thực tế không cao hơn nguồn.` : ""}</div></div>
    <div class="specs">
      <div class="spec"><small>Codec</small><b>${esc((t.codec || "?").toUpperCase())}</b></div>
      <div class="spec"><small>Bitrate</small><b>${t.bitrate ? t.bitrate + " kbps" : "–"}</b></div>
      <div class="spec"><small>Sample rate</small><b>${t.sample_rate ? (t.sample_rate / 1000).toFixed(1) + " kHz" : "–"}</b></div>
      <div class="spec"><small>Bit depth</small><b>${t.bit_depth ? t.bit_depth + "-bit" : "–"}</b></div>
      <div class="spec"><small>Duration</small><b>${fmtT(t.duration)}</b></div>
      <div class="spec"><small>File size</small><b>${fmtB(t.size)}</b></div>
      <div class="spec"><small>Source quality</small><b>${esc(t.source_label || "Local file")}</b></div>
      <div class="spec"><small>Added</small><b>${new Date(t.added_at * 1000).toLocaleDateString()}</b></div>
    </div>
    <div class="section-head"><h2>Saved at</h2>${t.source_url ? `<span><a href="${esc(t.source_url)}" target="_blank" rel="noopener">Source ↗</a></span>` : ""}</div>
    <div class="pathbox"><span>${esc(t.path)}</span><button class="btn ghost sm" id="tdReveal">${ic("external", "sm")} Show in folder</button></div>`;
  $("#tdPlay").onclick = () => playLib([t], 0);
  $("#tdFav").onclick = async () => { await toggleFav(t.id); renderTrack(id); };
  $("#tdPl").onclick = (e) => playlistMenu(e.currentTarget, [t.id]);
  $("#tdReveal").onclick = () => api(`/api/tracks/${t.id}/reveal`, { method: "POST" });
}

/* ================================================================ import preview */
const QUALITIES = [
  { k: "original", b: "Original", s: "Giữ nguyên, không convert" },
  { k: "flac", b: "FLAC", s: "Lossless container" },
  { k: "wav", b: "WAV", s: "PCM, không nén" },
  { k: "aac", b: "AAC", s: "M4A 256k" },
  { k: "mp3", b: "MP3", s: "320k" },
];

async function startPreview(url) {
  if (!url) return $("#urlIn")?.focus();
  try {
    const { id } = await api("/api/preview", { json: { url } });
    S.preview = { id, url, status: "loading", tracks: [] };
    S.psel = new Set(); S.pq = S.st?.settings.default_quality || "original"; S.pInit = false;
    location.hash = "#/import";
    pollPreview();
  } catch (e) { toast(e.message); }
}
async function pollPreview() {
  clearTimeout(pollPreview.t);
  if (!S.preview) return;
  try { S.preview = await api(`/api/preview/${S.preview.id}`); } catch { return; }
  const p = S.preview;
  if (!S.pInit && p.tracks.length) { p.tracks.forEach((t) => S.psel.add(t.i)); S.pInit = true; }
  if (route().view === "import") renderImport(true);
  if (["loading", "probing"].includes(p.status)) pollPreview.t = setTimeout(pollPreview, 1000);
}

function qualityNotice(p, sel) {
  const tracks = p.tracks.filter((t) => sel.has(t.i));
  const qs = tracks.map((t) => t.quality).filter(Boolean);
  const lossy = qs.filter((q) => q.tier !== "lossless");
  const labels = [...new Set(lossy.map((q) => q.label))].slice(0, 3).join(", ");
  const out = [];
  if (p.source === "spotify")
    out.push(["info", "info", `<b>Spotify không cho tải audio</b> (có DRM). Sonora lấy metadata + ảnh bìa từ Spotify, rồi tìm bản khớp trên <b>YouTube Music</b> để tải. Âm thanh là bản YouTube Music (thường Opus/AAC ~128–160k), không phải bản stream của Spotify. Bài có ⚠ có thể là phiên bản khác.`]);
  if (S.pq === "original") {
    if (lossy.length) out.push(["info", "info", `<b>Original</b> = giữ nguyên luồng tốt nhất nguồn cung cấp (${esc(labels)}${lossy.length > 3 ? "…" : ""}), không convert. Đây là chất lượng tối đa tải được, nhưng <b>không phải file master</b> nghệ sĩ upload.`]);
  } else if (["flac", "wav"].includes(S.pq) && lossy.length) {
    out.push(["warn", "alert", `<b>Không giữ được chất lượng gốc:</b> ${lossy.length} bài có nguồn nén (${esc(labels)}). Đổi sang ${S.pq.toUpperCase()} <b>không làm hay hơn</b>, chỉ làm file to gấp 5–10 lần. Badge sau khi import vẫn hiện chất lượng thực của nguồn.`]);
  } else if (["aac", "mp3"].includes(S.pq)) {
    const ll = qs.length - lossy.length;
    if (ll) out.push(["warn", "alert", `${ll} bài có nguồn lossless — convert sang ${S.pq.toUpperCase()} sẽ <b>mất chất lượng lossless</b>.`]);
    if (lossy.length) out.push(["warn", "alert", `Nén lại từ nguồn đã nén (${esc(labels)}) → ${S.pq.toUpperCase()} <b>giảm thêm một chút chất lượng</b> và không thể tốt hơn nguồn. Chọn <b>Original</b> để giữ nguyên.`]);
  }
  return out.map(([c, i, h]) => `<div class="notice ${c}">${ic(i)}<div>${h}</div></div>`).join("");
}

function renderImport(fromPoll) {
  const main = $("#main"), p = S.preview;
  if (!p) {
    main.innerHTML = `<div class="page-head"><div><div class="eyebrow">Import</div><h1>Add music</h1></div></div>${importBox()}`;
    bindImportBox(); return;
  }
  if (fromPoll && main.dataset.pv === p.id && document.activeElement?.closest?.("#main")) {
    // chỉ cập nhật phần động để không phá focus / scroll
  }
  main.dataset.pv = p.id;
  if (p.status === "error") {
    main.innerHTML = `<div class="page-head"><div><div class="eyebrow">Import preview</div><h1>Không đọc được link</h1></div></div>
      <div class="notice bad">${ic("alert")}<div>${esc(p.error)}</div></div>${importBox()}`;
    bindImportBox(); $("#urlIn").value = p.url; return;
  }
  if (p.status === "loading") {
    main.innerHTML = `<div class="page-head"><div><div class="eyebrow">Import preview</div><h1><span class="spin" style="width:22px;height:22px;border-width:3px"></span> Đang đọc link…</h1><div class="meta">${esc(p.url)}</div></div></div>
      ${p.url.includes("spotify") ? `<div class="notice info">${ic("info")}<div>Spotify API đôi khi chậm (10–30 giây) — vẫn đang chạy.</div></div>` : ""}`;
    return;
  }
  const probing = p.tracks.filter((t) => !t.quality).length;
  const selCount = p.tracks.filter((t) => S.psel.has(t.i)).length;
  const dest = `${short(S.st.settings.storage)}/${p.tracks.length > 1 ? p.title : p.source === "spotify" ? "Spotify" : "Singles"}`;
  const tiers = p.tracks.reduce((a, t) => { if (t.quality) a[t.quality.tier] = (a[t.quality.tier] || 0) + 1; return a; }, {});
  const scrollY = window.scrollY;
  main.innerHTML = `
    <div class="page-head"><div class="art cover ${p.cover ? "has-img" : ""}" style="width:150px;height:150px;padding:0">${p.cover ? `<img src="${esc(p.cover)}" referrerpolicy="no-referrer">` : ""}</div><div style="min-width:0">
      <div class="eyebrow">Import preview · <span class="tag src ${esc(p.source)}">${esc(p.source)}</span></div>
      <h1>${esc(p.title)}</h1><div class="meta">${esc(p.subtitle || "")} ${probing ? `· <span class="spin"></span> đang kiểm tra chất lượng ${p.tracks.length - probing}/${p.tracks.length}` : ""}</div>
      <div class="legend">${tiers.lossless ? `<span><i style="background:var(--green)"></i>${tiers.lossless} lossless/original</span>` : ""}${tiers.good ? `<span><i style="background:var(--yellow)"></i>${tiers.good} compressed · good</span>` : ""}${tiers.low ? `<span><i style="background:var(--red)"></i>${tiers.low} low / unknown</span>` : ""}</div>
    </div></div>
    <div class="section-head" style="margin-top:6px"><h2>Chất lượng khi lưu</h2><span>Mặc định không convert</span></div>
    <div class="qpicker">${QUALITIES.map((q) => `<button class="qopt ${S.pq === q.k ? "on" : ""}" data-q="${q.k}"><b>${q.b}${q.k === "original" ? " ✓" : ""}</b><small>${q.s}</small></button>`).join("")}</div>
    ${qualityNotice(p, S.psel)}
    <div class="dest">${ic("folder", "sm")} Lưu vào <code>${esc(dest)}</code></div>
    <div class="table">
      <div class="row head" style="grid-template-columns:28px 34px 40px minmax(0,1fr) auto 50px"><input class="check" type="checkbox" id="pAll" ${selCount === p.tracks.length ? "checked" : ""} title="Select all"><span></span><span></span><span>Track</span><span style="text-align:right">Source quality</span><span style="text-align:right">Time</span></div>
      ${p.tracks.map((t) => `<div class="row ${S.mode === "preview" && S.cur?.pi === t.i && S.cur?.pid === p.id ? "playing" : ""}" style="grid-template-columns:28px 34px 40px minmax(0,1fr) auto 50px" data-pi="${t.i}">
        <input class="check" type="checkbox" ${S.psel.has(t.i) ? "checked" : ""}>
        <button class="play" title="Nghe thử bản sẽ tải về" ${t.status === "nomatch" ? "disabled" : ""}>${ic(S.mode === "preview" && S.cur?.pi === t.i && S.cur?.pid === p.id && !audio.paused ? "pause" : "play")}</button>
        <div class="thumb" style="background-image:url('${esc(t.cover || "")}')"></div>
        <div class="track"><b>${esc(t.title)}</b>${t.warn ? `<small class="warn">⚠ ${esc(t.warn)} (${fmtT(t.match_duration)} vs ${fmtT(t.duration)})</small>` : t.match_title ? `<small>${esc(t.artist)} · khớp: ${esc(t.match_title)}</small>` : `<small>${esc(t.artist)}${t.error ? " · " + esc(t.error) : ""}</small>`}</div>
        <div class="qcell">${tag(t.quality)}${t.quality?.original ? "<small>artist's original file</small>" : ""}</div>
        <span class="duration">${fmtT(t.duration)}</span>
      </div>`).join("")}
    </div>
    <div class="sticky-foot"><span class="muted"><b style="color:var(--text)">${selCount}</b> / ${p.tracks.length} tracks · ${QUALITIES.find((q) => q.k === S.pq).b}${probing ? " · đang kiểm tra chất lượng…" : ""}</span>
      <div style="display:flex;gap:8px"><button class="btn ghost" id="pCancel">Cancel</button><button class="btn" id="pGo" ${selCount ? "" : "disabled"}>${ic("download", "sm")} Import ${selCount} track${selCount === 1 ? "" : "s"}</button></div></div>`;
  window.scrollTo(0, scrollY);
  $$(".qopt").forEach((b) => (b.onclick = () => { S.pq = b.dataset.q; renderImport(); }));
  $("#pAll").onchange = (e) => { p.tracks.forEach((t) => (e.target.checked ? S.psel.add(t.i) : S.psel.delete(t.i))); renderImport(); };
  $$(".row[data-pi]").forEach((row) => {
    const i = +row.dataset.pi;
    row.querySelector(".check").onchange = (e) => { e.target.checked ? S.psel.add(i) : S.psel.delete(i); renderImport(); };
    row.querySelector(".play").onclick = () => (S.mode === "preview" && S.cur?.pi === i && S.cur?.pid === p.id) ? togglePlay() : playPreview(i);
  });
  $("#pCancel").onclick = () => { S.preview = null; location.hash = "#/all"; };
  $("#pGo").onclick = async () => {
    try {
      const r = await api("/api/import", { json: { preview_id: p.id, indexes: [...S.psel], quality: S.pq } });
      toast(`Đang import vào ${short(r.folder)}`);
      S.preview = null; location.hash = "#/downloads"; pollJobs();
    } catch (e) { toast(e.message); }
  };
}

/* ================================================================ downloads */
const ST_LABEL = { running: "Đang tải", done: "Hoàn tất", partial: "Xong · một số bài lỗi", error: "Lỗi", cancelled: "Đã huỷ" };
function renderDownloads() {
  const jobs = S.jobs;
  const openLogs = new Set($$("details[data-j][open]").map((d) => d.dataset.j));
  $("#main").innerHTML = `<div class="page-head"><div><div class="eyebrow">Import</div><h1>Downloads</h1><div class="meta">Lịch sử import · có thể huỷ khi đang tải</div>
    <div class="actions">${jobs.some((j) => j.status !== "running") ? `<button class="btn ghost sm" id="clearH">Clear history</button>` : ""}</div></div></div>
    ${jobs.length ? jobs.map((j) => {
      const done = j.files.length, pct = j.status === "running" ? Math.min(100, ((done + (j.track_progress || 0) / 100) / j.total) * 100) : 100;
      return `<div class="card"><div class="card-head"><div class="t"><b>${esc(j.title || j.url)}</b><small><span class="tag src ${esc(j.source)}">${esc(j.source)}</span> &nbsp;${esc((QUALITIES.find((q) => q.k === j.quality) || {}).b || j.quality)} · ${new Date(j.started * 1000).toLocaleString()}</small></div>
        <div style="display:flex;gap:10px;align-items:center"><span class="status ${j.status}">${ST_LABEL[j.status] || j.status}</span>${j.status === "running" ? `<button class="btn danger sm" data-cancel="${j.id}">${ic("x", "sm")} Cancel</button>` : ""}</div></div>
        <div class="prog"><i style="width:${pct}%"></i></div>
        <div class="muted" style="font-size:12px">${done} / ${j.total} tracks${j.errors ? ` · <span style="color:var(--red)">${j.errors} lỗi</span>` : ""}${j.status === "running" && j.current ? ` · đang tải: <b style="color:var(--text)">${esc(j.current)}</b>${j.track_progress != null ? ` (${j.track_progress}%)` : ""}` : ""}</div>
        <div class="dest" style="margin:10px 0 0">${ic("folder", "sm")} <code>${esc(short(j.folder))}</code><button class="btn ghost sm" data-open="${esc(j.folder)}">Open</button></div>
        <details data-j="${j.id}" ${openLogs.has(j.id) ? "open" : ""}><summary>Log</summary><pre class="log">${esc((j.log || []).join("\n"))}</pre></details></div>`;
    }).join("") : `<div class="empty"><b>Chưa có lượt import nào</b>Dán link ở All music để bắt đầu.<br><a class="btn" href="#/all">Go to library</a></div>`}`;
  $$("[data-cancel]").forEach((b) => (b.onclick = async () => { await api(`/api/jobs/${b.dataset.cancel}/cancel`, { method: "POST" }); toast("Đang huỷ…"); }));
  $$("[data-open]").forEach((b) => (b.onclick = () => api("/api/open", { json: { path: b.dataset.open } })));
  $("#clearH") && ($("#clearH").onclick = async () => { await api("/api/jobs", { method: "DELETE" }); pollJobs(); });
}
let lastDone = -1;
async function pollJobs() {
  clearTimeout(pollJobs.t);
  try { S.jobs = await api("/api/jobs"); } catch { pollJobs.t = setTimeout(pollJobs, 5000); return; }
  const running = S.jobs.filter((j) => j.status === "running").length;
  const doneSum = S.jobs.reduce((a, j) => a + j.files.length, 0);
  const r = route();
  if (r.view === "downloads") renderDownloads();
  if (doneSum !== lastDone || (S.st && S.st.running !== running)) {
    const first = lastDone === -1; lastDone = doneSum;
    await refreshState();
    if (!first && LIB_VIEWS.includes(r.view) && !S.sel.size) renderLibrary(r);
  }
  pollJobs.t = setTimeout(pollJobs, running ? 1200 : 6000);
}

/* ================================================================ settings */
function renderSettings() {
  const s = S.st.settings;
  $("#main").innerHTML = `<div class="page-head"><div><div class="eyebrow">Preferences</div><h1>Settings</h1><div class="meta">Lưu tại <code>~/.sonora/settings.json</code></div></div></div>
  <div class="card">
    <div class="field-row"><label><b>Storage folder</b><small>Nơi lưu nhạc import. Mỗi playlist một thư mục con.</small></label>
      <div class="ctl"><input class="input" id="sStorage" value="${esc(s.storage)}"><button class="btn ghost sm" id="sOpen">${ic("external", "sm")} Open</button></div></div>
    <div class="field-row"><label><b>Thư mục nhạc khác</b><small>Index thêm các thư mục có sẵn (không copy, không di chuyển). Mỗi dòng một đường dẫn.</small></label>
      <div class="ctl"><textarea class="input" id="sExtra" placeholder="~/Music/iTunes&#10;D:\\Music">${esc((s.extra_folders || []).join("\n"))}</textarea></div></div>
    <div class="field-row"><label><b>Default import quality</b><small>Original = không bao giờ convert trừ khi bạn chọn.</small></label>
      <div class="ctl"><select class="input" id="sQ">${QUALITIES.map((q) => `<option value="${q.k}" ${s.default_quality === q.k ? "selected" : ""}>${q.b} — ${q.s}</option>`).join("")}</select></div></div>
    <div class="field-row"><label><b>Duplicate handling</b><small>Khi file cùng tên đã có trong thư mục đích.</small></label>
      <div class="ctl"><select class="input" id="sDup"><option value="skip" ${s.duplicates === "skip" ? "selected" : ""}>Skip — giữ file cũ</option><option value="keep" ${s.duplicates === "keep" ? "selected" : ""}>Overwrite — tải lại</option></select></div></div>
    <div class="field-row"><label><b>Audio output</b><small>Theo thiết bị mặc định của hệ thống.</small></label>
      <div class="ctl"><select class="input" id="sOut"><option value="">System default</option></select></div></div>
    <div class="field-row"><label></label><div class="ctl"><button class="btn" id="sSave">Save settings</button></div></div>
  </div>
  <div class="card">
    <div class="field-row"><label><b>Scan library</b><small>Tìm file mới / dọn bài đã bị xoá khỏi ổ đĩa.</small></label><div class="ctl"><button class="btn ghost" id="sScan">${ic("refresh", "sm")} Scan now</button><span class="muted" id="scanRes"></span></div></div>
    <div class="field-row"><label><b>Keyboard shortcuts</b></label><div class="ctl" style="display:block;line-height:2;font-size:13px;color:var(--muted)">
      <span class="kbd">Space</span> Play / pause &nbsp; <span class="kbd">←</span><span class="kbd">→</span> Tua 5s &nbsp; <span class="kbd">Shift</span>+<span class="kbd">←/→</span> Bài trước / sau<br>
      <span class="kbd">/</span> Tìm kiếm &nbsp; <span class="kbd">L</span> Favorite &nbsp; <span class="kbd">S</span> Shuffle &nbsp; <span class="kbd">R</span> Repeat</div></div>
    <div class="field-row"><label><b>ffmpeg</b></label><div class="ctl muted">${S.st.ffmpeg ? "✓ Sẵn sàng" : "✖ Không tìm thấy — cài ffmpeg để convert"}</div></div>
  </div>
  <div class="card">
    <div class="field-row"><label><b>Sonora</b><small>Phiên bản app.</small></label><div class="ctl"><span>v${esc(S.st.version)}</span>
      ${S.upd?.app_update ? `<a class="btn sm" href="${esc(S.upd.app_url)}" target="_blank" rel="noopener">${ic("download", "sm")} Tải ${esc(S.upd.app_latest)}</a>` : `<span class="muted">${S.upd ? (S.upd.app_latest ? "Đang dùng bản mới nhất" : "Chưa kiểm tra được") : "Đang kiểm tra…"}</span>`}</div></div>
    <div class="field-row"><label><b>Download engine</b><small>yt-dlp — SoundCloud/YouTube hay thay đổi, engine cũ có thể bị lỗi. Cập nhật không cần cài lại app.</small></label>
      <div class="ctl"><span>${esc(S.st.engine)}${S.st.engine_custom ? " (đã cập nhật)" : " (bản đi kèm)"}</span>
        ${S.upd?.engine_update ? `<button class="btn sm" id="engUp">${ic("download", "sm")} Cập nhật lên ${esc(S.upd.engine_latest)}</button>` : `<span class="muted">${S.upd?.engine_latest ? "Mới nhất" : ""}</span>`}
        ${S.st.engine_custom ? `<button class="btn ghost sm" id="engReset">Dùng lại bản đi kèm</button>` : ""}</div></div>
    <div class="field-row"><label><b>Giới hạn sử dụng</b></label><div class="ctl muted" style="display:block;font-size:12.5px;line-height:1.5">Chỉ import nội dung bạn sở hữu hoặc được phép tải. Sonora là phần mềm tự do theo GPL-3.0 · <a href="https://github.com/${esc(S.st.repo)}" target="_blank" rel="noopener">Source code</a></div></div>
  </div>`;
  $("#engUp") && ($("#engUp").onclick = async (e) => {
    e.currentTarget.disabled = true; e.currentTarget.textContent = "Đang tải…";
    try { await api("/api/engine/update", { method: "POST" }); toast("Đã cập nhật engine — mở lại Sonora để áp dụng"); } catch (er) { toast(er.message); e.currentTarget.disabled = false; }
  });
  $("#engReset") && ($("#engReset").onclick = async () => { await api("/api/engine/reset", { method: "POST" }); toast("Mở lại Sonora để dùng bản đi kèm"); });
  $("#sOpen").onclick = () => api("/api/open", { json: { path: $("#sStorage").value } });
  $("#sSave").onclick = async () => {
    await api("/api/settings", { json: { storage: $("#sStorage").value, extra_folders: $("#sExtra").value.split("\n"), default_quality: $("#sQ").value, duplicates: $("#sDup").value } });
    await refreshState(); toast("Settings saved"); scanLib();
  };
  $("#sScan").onclick = scanLib;
  if (audio.setSinkId && navigator.mediaDevices?.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices().then((ds) => {
      const outs = ds.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.label);
      $("#sOut").innerHTML = `<option value="">System default</option>` + outs.map((d) => `<option value="${esc(d.deviceId)}" ${store.get("sink", "") === d.deviceId ? "selected" : ""}>${esc(d.label)}</option>`).join("");
      $("#sOut").onchange = (e) => { audio.setSinkId(e.target.value).then(() => store.set("sink", e.target.value)).catch((er) => toast(er.message)); };
    });
  }
}
async function scanLib() {
  toast("Đang quét thư viện…");
  const r = await api("/api/scan", { method: "POST" });
  const msg = `Tìm thấy ${r.found} file · thêm ${r.added} · gỡ ${r.removed}`;
  $("#scanRes") && ($("#scanRes").textContent = msg);
  toast(msg); await refreshState(); render();
}

/* ================================================================ menus / playlists */
function showMenu(anchor, html) {
  const m = $("#menu"); m.innerHTML = html; m.classList.add("show");
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px";
  m.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 4 : r.bottom + 4) + "px";
  setTimeout(() => document.addEventListener("click", hideMenu, { once: true }), 0);
  return m;
}
function hideMenu() { $("#menu").classList.remove("show"); }
function trackMenu(anchor, t, ctx) {
  const m = showMenu(anchor, `
    <button data-a="next">${ic("next", "sm")} Play next</button>
    <button data-a="fav">${ic("heart", "sm")} ${t.favorite ? "Remove from favorites" : "Add to favorites"}</button>
    <button data-a="pl">${ic("list", "sm")} Add to playlist…</button>
    ${ctx.playlist ? `<button data-a="rm">${ic("x", "sm")} Remove from this playlist</button>` : ""}
    <hr><button data-a="detail">${ic("info", "sm")} Track details</button>
    <button data-a="reveal">${ic("folder", "sm")} Show in folder</button>`);
  m.onclick = async (e) => {
    const a = e.target.closest("button")?.dataset.a; if (!a) return;
    if (a === "next") { if (S.mode !== "lib" || !S.queue.length) playLib([t], 0); else { S.queue.splice(S.qi + 1, 0, t); renderRight(); toast("Sẽ phát tiếp theo"); } }
    if (a === "fav") { await toggleFav(t.id); render(); }
    if (a === "pl") { e.stopPropagation(); playlistMenu(anchor, [t.id]); return; }
    if (a === "rm") { await api(`/api/playlists/${ctx.playlist}/tracks/${t.id}`, { method: "DELETE" }); await refreshState(); render(); }
    if (a === "detail") location.hash = `#/track/${t.id}`;
    if (a === "reveal") api(`/api/tracks/${t.id}/reveal`, { method: "POST" });
  };
}
function playlistMenu(anchor, ids) {
  const pls = S.st.playlists;
  const m = showMenu(anchor, `<div class="lbl">Add ${ids.length} to playlist</div>${pls.map((p) => `<button data-p="${p.id}">${ic("list", "sm")} ${esc(p.name)}</button>`).join("")}${pls.length ? "<hr>" : ""}<button data-p="new">${ic("plus", "sm")} New playlist…</button>`);
  m.onclick = async (e) => {
    let pid = e.target.closest("button")?.dataset.p; if (!pid) return;
    if (pid === "new") { const p = await newPlaylist(); if (!p) return; pid = p.id; }
    await api(`/api/playlists/${pid}/tracks`, { json: { track_ids: ids } });
    await refreshState(); toast(`Đã thêm ${ids.length} bài vào playlist`);
    S.sel.clear(); renderBulk(); $$(".row .check").forEach((c) => (c.checked = false));
  };
}
async function newPlaylist() {
  const name = await ask("Playlist mới", "New playlist", "Create"); if (!name) return null;
  const p = await api("/api/playlists", { json: { name } }); await refreshState(); return p;
}
async function toggleFav(id) {
  const t = await api(`/api/tracks/${id}/favorite`, { method: "POST" });
  if (S.cur?.id === id) { S.cur.favorite = t.favorite; renderPlayer(); }
  toast(t.favorite ? "Đã thêm vào Favorites" : "Đã bỏ khỏi Favorites");
  return t;
}

/* ================================================================ player */
function playLib(list, i) {
  S.mode = "lib"; S.queue = list.slice(); S.qi = i;
  if (S.shuffle) { const cur = S.queue.splice(i, 1)[0]; shuffleArr(S.queue); S.queue.unshift(cur); S.qi = 0; }
  loadCur();
}
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function loadCur() {
  const t = S.queue[S.qi]; if (!t) return;
  S.cur = t;
  audio.src = `/api/tracks/${t.id}/audio`;
  audio.play().catch((e) => toast("Không phát được: " + e.message));
  afterTrackChange();
}
function playPreview(i) {
  const p = S.preview, t = p.tracks[i];
  S.mode = "preview";
  S.cur = { pid: p.id, pi: i, title: t.title, artist: t.artist, album: p.title, duration: t.duration, coverUrl: t.cover, quality: t.quality, preview: true };
  audio.src = `/api/stream?pid=${p.id}&i=${i}&_=${Date.now()}`;
  audio.play().catch(() => {});
  toast("Đang tải luồng nghe thử…");
  afterTrackChange();
}
function afterTrackChange() {
  renderPlayer(); renderRight();
  $$(".row.playing").forEach((r) => r.classList.remove("playing"));
  if (S.mode === "lib") $$(`.row[data-id="${S.cur.id}"]`).forEach((r) => r.classList.add("playing"));
  else $$(`.row[data-pi="${S.cur.pi}"]`).forEach((r) => r.classList.add("playing"));
  const t = S.cur;
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || "", artwork: [{ src: t.preview ? t.coverUrl || "" : cover(t), sizes: "512x512" }] });
  }
  document.title = `${t.title} · ${t.artist} — Sonora`;
}
function next(auto) {
  if (S.mode === "preview") { const p = S.preview; if (p && S.cur.pi + 1 < p.tracks.length) playPreview(S.cur.pi + 1); return; }
  if (!S.queue.length) return;
  if (auto && S.repeat === "one") { audio.currentTime = 0; audio.play(); return; }
  if (S.qi + 1 < S.queue.length) S.qi++;
  else if (S.repeat === "all" || !auto) S.qi = 0;
  else { audio.pause(); return; }
  loadCur();
}
function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (S.mode === "preview") { if (S.cur.pi > 0) playPreview(S.cur.pi - 1); return; }
  if (!S.queue.length) return;
  S.qi = S.qi > 0 ? S.qi - 1 : S.queue.length - 1; loadCur();
}
function togglePlay() { if (!S.cur) { if (S.tracks.length) playLib(S.tracks, 0); return; } audio.paused ? audio.play() : audio.pause(); }

function curDuration() { return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : S.cur?.duration || 0; }
function renderPlayer() {
  const t = S.cur;
  $("#bShuffle").classList.toggle("on", S.shuffle);
  $("#bRepeat").classList.toggle("on", S.repeat !== "off");
  $("#bRepeat").classList.toggle("rep-one", S.repeat === "one");
  $("#bRepeat").title = "Repeat: " + S.repeat;
  $("#bPlay").innerHTML = ic(audio.paused ? "play" : "pause");
  if (!t) return;
  $("#pTitle").innerHTML = esc(t.title) + (t.preview ? `<span class="preview-flag">PREVIEW</span>` : "");
  $("#pSub").textContent = t.artist + (t.preview ? " · bản sẽ tải về" : "");
  $("#pArt").style.backgroundImage = `url('${t.preview ? t.coverUrl || "" : cover(t)}'), linear-gradient(135deg,#6c4d8f,#25283b)`;
  $("#pFav").style.visibility = t.preview ? "hidden" : "visible";
  $("#pFav").classList.toggle("fav-on", !!t.favorite);
  $("#seek").style.cursor = t.preview ? "default" : "pointer";
}
function renderRight() {
  const el = $("#right"), t = S.cur;
  if (!t) {
    el.innerHTML = `<div class="cover"><small>NOTHING PLAYING<br><b>Pick a track</b></small></div><h2 class="now-title">Sonora</h2><div class="muted">Chọn một bài trong thư viện hoặc nghe thử khi import.</div>`;
    return;
  }
  const q = t.preview ? t.quality : { label: t.q_label, tier: t.q_tier };
  const tech = t.preview ? "Luồng nghe thử (đã giải mã tạm sang MP3 192k để phát)" :
    [t.codec?.toUpperCase(), t.sample_rate ? (t.sample_rate / 1000).toFixed(1) + " kHz" : "", t.bit_depth ? t.bit_depth + "-bit" : "", t.bitrate ? t.bitrate + " kbps" : ""].filter(Boolean).join(" · ");
  const upNext = S.mode === "lib" ? S.queue.slice(S.qi + 1, S.qi + 8) : (S.preview?.tracks || []).slice(t.pi + 1, t.pi + 6);
  const total = S.mode === "lib" ? S.queue.length - S.qi - 1 : (S.preview?.tracks.length || 0) - t.pi - 1;
  const img = t.preview ? t.coverUrl : (t.has_cover !== 0 ? cover(t) : "");
  el.innerHTML = `
    <div class="cover ${img ? "has-img" : ""}">${img ? `<img src="${esc(img)}" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove('has-img');this.remove()">` : ""}<small>${t.preview ? "PREVIEW" : "NOW PLAYING"}<br><b>${esc(t.album || "")}</b></small></div>
    <h2 class="now-title">${esc(t.title)}</h2><div class="muted">${esc(t.artist)}</div>
    <div class="tech">${q ? tag(q) : ""}<span>${esc(tech)}</span></div>
    <div class="bar" id="rBar"><i id="rFill"></i></div><div class="times"><span id="rCur">0:00</span><span id="rDur">${fmtT(curDuration())}</span></div>
    <div class="controls">
      <button class="icon-btn ${S.shuffle ? "on" : ""}" data-c="shuffle" title="Shuffle">${ic("shuffle")}</button>
      <button class="icon-btn" data-c="prev">${ic("prev")}</button>
      <button class="big" data-c="play">${ic(audio.paused ? "play" : "pause")}</button>
      <button class="icon-btn" data-c="next">${ic("next")}</button>
      <button class="icon-btn ${S.repeat !== "off" ? "on" : ""}" data-c="repeat" title="Repeat: ${S.repeat}">${ic("repeat")}</button>
    </div>
    ${t.preview ? `<div class="where">${ic("info", "sm")}<span>Chưa nằm trong thư viện. Bấm Import để lưu ${S.pq === "original" ? "nguyên bản" : "dạng " + S.pq.toUpperCase()}.</span></div>`
      : `<div class="where">${ic("folder", "sm")}<span>Lưu tại <code>${esc(short(t.path))}</code><br><button id="rReveal">Show in folder</button></span></div>`}
    <div class="queue"><h3>Up next <span class="muted">· ${Math.max(0, total)} tracks</span></h3>
      ${upNext.length ? upNext.map((u, k) => `<div class="mini" data-k="${k}"><div class="thumb" style="background-image:url('${esc(S.mode === "lib" ? cover(u) : u.cover || "")}')"></div><div><b>${esc(u.title)}</b><small>${esc(u.artist)}</small></div></div>`).join("") : `<div class="muted" style="font-size:12px">Hết hàng đợi${S.repeat === "all" ? " · sẽ lặp lại" : ""}</div>`}
    </div>`;
  el.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => ({ shuffle: toggleShuffle, prev, play: togglePlay, next: () => next(false), repeat: cycleRepeat })[b.dataset.c]()));
  el.querySelectorAll(".mini").forEach((m) => (m.onclick = () => { const k = +m.dataset.k; if (S.mode === "lib") { S.qi += k + 1; loadCur(); } else playPreview(t.pi + k + 1); }));
  $("#rReveal") && ($("#rReveal").onclick = () => api(`/api/tracks/${t.id}/reveal`, { method: "POST" }));
  $("#rBar").onclick = (e) => seekTo(e, $("#rBar"));
  updateTime();
}
function toggleShuffle() {
  S.shuffle = !S.shuffle; store.set("shuffle", S.shuffle);
  if (S.mode === "lib" && S.queue.length) {
    const cur = S.queue[S.qi], rest = S.queue.filter((_, k) => k !== S.qi);
    S.queue = [cur, ...(S.shuffle ? shuffleArr(rest) : rest.sort((a, b) => S.tracks.indexOf(a) - S.tracks.indexOf(b)))]; S.qi = 0;
  }
  renderPlayer(); renderRight(); toast(S.shuffle ? "Shuffle on" : "Shuffle off");
}
function cycleRepeat() { S.repeat = { off: "all", all: "one", one: "off" }[S.repeat]; store.set("repeat", S.repeat); renderPlayer(); renderRight(); toast("Repeat: " + S.repeat); }
function seekTo(e, el) {
  if (!S.cur || S.cur.preview || !isFinite(audio.duration)) return;
  const r = el.getBoundingClientRect(); audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
}
function updateTime() {
  const d = curDuration(), c = audio.currentTime || 0, pct = d ? Math.min(100, (c / d) * 100) : 0;
  $("#seekFill").style.width = pct + "%"; $("#tCur").textContent = fmtT(c); $("#tDur").textContent = fmtT(d);
  const rf = $("#rFill"); if (rf) { rf.style.width = pct + "%"; $("#rCur").textContent = fmtT(c); $("#rDur").textContent = fmtT(d); }
}
audio.addEventListener("timeupdate", updateTime);
audio.addEventListener("loadedmetadata", updateTime);
audio.addEventListener("ended", () => next(true));
audio.addEventListener("play", () => { renderPlayer(); syncPlayIcons(); });
audio.addEventListener("pause", () => { renderPlayer(); syncPlayIcons(); });
audio.addEventListener("error", () => { if (S.cur) toast(S.cur.preview ? "Không phát được luồng nghe thử" : "Trình duyệt không phát được định dạng này (" + (S.cur.codec || "?") + ")"); });
function syncPlayIcons() {
  const big = $("#right [data-c=play]"); if (big) big.innerHTML = ic(audio.paused ? "play" : "pause");
  $$(".row .play").forEach((b) => (b.innerHTML = ic("play")));
  $$(".row.playing .play").forEach((b) => (b.innerHTML = ic(audio.paused ? "play" : "pause")));
}
$("#bPlay").onclick = togglePlay;
$("#bNext").onclick = () => next(false);
$("#bPrev").onclick = prev;
$("#bShuffle").onclick = toggleShuffle;
$("#bRepeat").onclick = cycleRepeat;
$("#pFav").onclick = () => S.cur && !S.cur.preview && toggleFav(S.cur.id);
$("#seek").onclick = (e) => seekTo(e, $("#seek"));
$("#vol").oninput = (e) => { audio.volume = +e.target.value; store.set("vol", audio.volume); $("#volIcon").innerHTML = `<use href="#i-${audio.volume ? "volume" : "mute"}"/>`; };
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", togglePlay);
  navigator.mediaSession.setActionHandler("pause", togglePlay);
  navigator.mediaSession.setActionHandler("nexttrack", () => next(false));
  navigator.mediaSession.setActionHandler("previoustrack", prev);
}

/* ================================================================ search / filter / keys */
let searchT;
$("#search").oninput = (e) => {
  clearTimeout(searchT);
  searchT = setTimeout(() => { S.q = e.target.value; const r = route(); if (LIB_VIEWS.includes(r.view)) renderLibrary(r); else location.hash = "#/all"; }, 220);
};
$("#tierFilter").onchange = (e) => { S.tier = e.target.value; const r = route(); if (LIB_VIEWS.includes(r.view)) renderLibrary(r); else location.hash = "#/all"; };
$("#storagePill").onclick = () => api("/api/open", { json: {} });
document.addEventListener("keydown", (e) => {
  if (document.querySelector(".modal-veil")) return;
  if (e.target.matches("input,textarea,select")) { if (e.key === "Escape") e.target.blur(); return; }
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  else if (e.key === "ArrowRight" && e.shiftKey) next(false);
  else if (e.key === "ArrowLeft" && e.shiftKey) prev();
  else if (e.key === "ArrowRight" && isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
  else if (e.key === "ArrowLeft" && isFinite(audio.duration)) audio.currentTime = Math.max(0, audio.currentTime - 5);
  else if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
  else if (e.key.toLowerCase() === "l" && S.cur && !S.cur.preview) toggleFav(S.cur.id);
  else if (e.key.toLowerCase() === "s") toggleShuffle();
  else if (e.key.toLowerCase() === "r") cycleRepeat();
  else if (e.key === "Escape") hideMenu();
});
document.addEventListener("paste", (e) => {
  if (e.target.matches("input,textarea")) return;
  const txt = e.clipboardData.getData("text").trim();
  if (/^(https?:\/\/|spotify:)/.test(txt)) { e.preventDefault(); startPreview(txt); }
});

/* ================================================================ local file import (drag & drop) */
async function uploadFiles(items) {
  const files = items.filter(({ file }) => /\.(mp3|m4a|mp4|aac|flac|wav|aiff?|ogg|opus)$/i.test(file.name));
  if (!files.length) return toast("Không có file nhạc hợp lệ");
  let added = 0;
  for (let i = 0; i < files.length; i += 8) {
    const fd = new FormData();
    files.slice(i, i + 8).forEach(({ file, path }) => fd.append("files", file, path || file.name));
    toast(`Đang copy ${Math.min(i + 8, files.length)}/${files.length} file…`);
    const r = await api("/api/import/files", { method: "POST", body: fd });
    added += r.added.length;
  }
  toast(`Đã thêm ${added} bài vào thư viện (giữ nguyên file gốc)`);
  await refreshState(); render();
}
function readEntry(entry, path = "") {
  return new Promise((res) => {
    if (entry.isFile) entry.file((f) => res([{ file: f, path: path + f.name }]), () => res([]));
    else if (entry.isDirectory) {
      const rd = entry.createReader(), all = [];
      const batch = () => rd.readEntries(async (ents) => {
        if (!ents.length) { res((await Promise.all(all.map((e) => readEntry(e, path + entry.name + "/")))).flat()); return; }
        all.push(...ents); batch();
      }, () => res([]));
      batch();
    } else res([]);
  });
}
let dragN = 0;
window.addEventListener("dragenter", (e) => { if ([...e.dataTransfer.types].includes("Files")) { dragN++; $("#dropveil").classList.add("show"); } });
window.addEventListener("dragleave", () => { if (--dragN <= 0) { dragN = 0; $("#dropveil").classList.remove("show"); } });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault(); dragN = 0; $("#dropveil").classList.remove("show");
  const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
  if (!e.dataTransfer.files.length && /^https?:\/\//.test(url)) return startPreview(url.trim());
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const items = entries.length ? (await Promise.all(entries.map((en) => readEntry(en)))).flat() : [...e.dataTransfer.files].map((f) => ({ file: f, path: f.name }));
  uploadFiles(items);
});
$("#fileInput").onchange = (e) => { uploadFiles([...e.target.files].map((f) => ({ file: f, path: f.name }))); e.target.value = ""; };
$("#folderInput").onchange = (e) => { uploadFiles([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))); e.target.value = ""; };

/* ================================================================ boot */
(async function boot() {
  await refreshState();
  renderPlayer(); renderRight();
  render();
  termsGate();
  pollJobs();
  checkUpdates();
})();
