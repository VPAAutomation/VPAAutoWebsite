// VPA Chấm công — ứng dụng cho Nhân viên (PWA)
import {
  api, ApiError, isNetworkError, isTransient, toVNInput, fromVNInput, ms, fmtTime, fmtDate, fmtDateTime, weekday, vnToday,
  roundUp, roundDown, fmtH, DAY_TYPE, EMP_TYPE, $, $$, esc, toast, store, uuid, mapsLink, modal,
} from './common.js';

const VERSION = '1.0.0';
const iso = (t) => (t == null ? null : new Date(t).toISOString());
const root = $('#root');

// ---------------- STATE ----------------
const S = {
  token: store.get('vpa_token'),
  deviceId: store.get('vpa_device_id'),
  me: store.get('vpa_me'),
  openShift: store.get('vpa_open_shift'),
  sites: store.get('vpa_sites', []),
  offset: store.get('vpa_offset', 0),
  rules: store.get('vpa_rules', { rounding_minutes: 30, gps_warn_accuracy_m: 100 }),
  queue: store.get('vpa_queue', []),
  open: null,           // { at, token }
  gps: null, gpsErr: null, gpsBusy: false,
  tab: 'home',
  timeTouched: false, chosen: null,
  month: vnToday().slice(0, 7),
  loginMsg: null,
};
if (!S.deviceId) { S.deviceId = uuid(); store.set('vpa_device_id', S.deviceId); }
const serverNow = () => Date.now() + S.offset;
const auth = () => ({ token: S.token, deviceId: S.deviceId });
const saveQueue = () => store.set('vpa_queue', S.queue);
const setOpenShift = (s) => { S.openShift = s; store.set('vpa_open_shift', s); };

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------------- AUTH ----------------
function logout(msg) {
  S.token = null; store.del('vpa_token'); store.del('vpa_me'); store.del('vpa_open_shift');
  S.loginMsg = msg || null;
  render();
}
function handleErr(e, { silent } = {}) {
  if (e instanceof ApiError) {
    if (e.status === 401) { logout(e.message); return true; }
    if (e.code === 'DEVICE_MISMATCH') { logout(e.message); return true; }
    if (!silent) toast(e.message, 'err', 5000);
  } else if (!silent) toast('Không kết nối được máy chủ', 'warn');
  return false;
}

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btnInstall')?.classList.remove('hidden'); });

function renderLogin() {
  root.innerHTML = `
  <div class="login">
    <div class="logo"><img src="icons/icon-192.png" alt=""><div><b>VPA Chấm công</b><div class="muted small">CÔNG TY TNHH VPA AUTOMATION</div></div></div>
    ${S.loginMsg ? `<div class="alert err">${esc(S.loginMsg)}</div>` : ''}
    ${isIOS && !isStandalone ? `<div class="alert info"><b>iPhone/iPad:</b> hãy bấm <b>Chia sẻ ⬆︎ → Thêm vào MH chính</b>, rồi mở app từ biểu tượng trên màn hình chính và đăng nhập ở đó.<br>Tài khoản sẽ gắn với thiết bị ở lần đăng nhập đầu tiên.</div>` : ''}
    <form id="fLogin" class="card">
      <label class="field"><span>Số điện thoại hoặc Mã NV</span><input name="login" autocomplete="username" required inputmode="text" autocapitalize="characters"></label>
      <label class="field"><span>Mật khẩu</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary block" type="submit">Đăng nhập</button>
      <p class="muted small" style="margin:12px 0 0">Lần đăng nhập đầu tiên sẽ <b>gắn tài khoản với điện thoại này</b>. Đổi máy → liên hệ quản lý để đặt lại.</p>
    </form>
    <button id="btnInstall" class="btn block ${installEvt ? '' : 'hidden'}">Cài ứng dụng lên màn hình chính</button>
  </div>`;
  $('#btnInstall').onclick = () => installEvt && installEvt.prompt();
  $('#fLogin').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = ev.target.querySelector('button'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api('POST', '/auth/login', { body: {
        login: f.get('login').trim(), password: f.get('password'), device_id: S.deviceId,
        device_info: `${navigator.userAgent.slice(0, 200)}${isStandalone ? ' [PWA]' : ''}`,
      } });
      S.token = r.token; store.set('vpa_token', r.token); S.loginMsg = null;
      S.mustChange = r.must_change_password;
      await refresh(); render(); doOpen();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Không kết nối được máy chủ', 'err', 5000);
      btn.disabled = false; btn.textContent = 'Đăng nhập';
    }
  };
}

function renderChangePassword(forced) {
  const html = `
    <h2>${forced ? 'Đổi mật khẩu lần đầu' : 'Đổi mật khẩu'}</h2>
    ${forced ? '<p class="muted small">Vì bảo mật, vui lòng đổi mật khẩu do quản lý cấp.</p>' : ''}
    <form id="fPw">
      <label class="field"><span>Mật khẩu hiện tại</span><input name="old" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>Mật khẩu mới (≥ 6 ký tự)</span><input name="new1" type="password" autocomplete="new-password" minlength="6" required></label>
      <label class="field"><span>Nhập lại mật khẩu mới</span><input name="new2" type="password" autocomplete="new-password" minlength="6" required></label>
      <div class="row"><button class="btn primary" type="submit" style="flex:1">Lưu</button>${forced ? '' : '<button class="btn" type="button" data-close>Huỷ</button>'}</div>
    </form>`;
  const close = modal(html, { onMount: (m, close) => {
    $('#fPw', m).onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      if (f.get('new1') !== f.get('new2')) return toast('Mật khẩu nhập lại không khớp', 'err');
      try {
        const r = await api('POST', '/auth/change-password', { ...auth(), body: { old_password: f.get('old'), new_password: f.get('new1') } });
        if (r.token) { S.token = r.token; store.set('vpa_token', r.token); }
        S.mustChange = false; toast('Đã đổi mật khẩu', 'ok'); close();
      } catch (e) { handleErr(e); }
    };
  } });
  return close;
}

// ---------------- DATA ----------------
async function refresh() {
  if (!S.token || !navigator.onLine) return;
  try {
    const [me, sites] = await Promise.all([api('GET', '/me', auth()), api('GET', '/sites', auth())]);
    S.offset = Date.parse(me.server_now) - Date.now(); store.set('vpa_offset', S.offset);
    S.me = me.employee; store.set('vpa_me', S.me);
    S.rules = me.rules; store.set('vpa_rules', S.rules);
    S.mustChange = me.must_change_password;
    S.sites = sites; store.set('vpa_sites', sites);
    setOpenShift(me.open_shift);
  } catch (e) { handleErr(e, { silent: true }); }
}

// "Mở app": ghi nhận thời điểm mở (có chữ ký server nếu online)
async function doOpen() {
  if (!S.token) return;
  S.open = { at: serverNow(), token: null };
  S.timeTouched = false; S.chosen = null;
  if (navigator.onLine) {
    try {
      const r = await api('POST', '/me/open', auth());
      S.offset = Date.parse(r.server_now) - Date.now(); store.set('vpa_offset', S.offset);
      S.open = { at: Date.parse(r.opened_at), token: r.open_token };
    } catch (e) { if (handleErr(e, { silent: true })) return; }
  }
  if (S.tab === 'home') renderHome();
  startGps();
  flush();
  refresh().then(() => { if (S.tab === 'home' && !S.timeTouched) renderHome(); if (S.mustChange) renderChangePassword(true); });
}

function effectiveShift() {
  let shift = S.openShift ? { ...S.openShift, pending: false } : null;
  for (const it of S.queue) {
    if (it.failed || !mine(it)) continue;
    if (it.type === 'in') shift = { pending: true, in_client_uuid: it.body.client_uuid, in_time: it.body.chosen_time || it.defaultIso, site_id: it.body.site_id, site_name: it.siteName };
    if (it.type === 'out') shift = null;
  }
  return shift;
}

// ---------------- OFFLINE QUEUE ----------------
// Mỗi lượt gắn với mã NV đã chấm → không bao giờ gửi nhầm dưới tài khoản khác
const mine = (it) => !it.owner || !S.me?.code || it.owner === S.me.code;
let flushing = false;
async function flush() {
  if (flushing || !S.token || !navigator.onLine || !S.me?.code || !S.queue.some((x) => !x.failed && mine(x))) return;
  flushing = true;
  let synced = 0;
  try {
    for (const it of [...S.queue]) {
      if (it.failed || !mine(it)) continue;
      try {
        const r = await api('POST', it.type === 'in' ? '/attendance/check-in' : '/attendance/check-out',
          { ...auth(), body: { ...it.body, sent_device_time: iso(Date.now()) } });
        S.queue = S.queue.filter((x) => x.id !== it.id);
        setOpenShift(it.type === 'in' ? r.record : null);
        synced++;
      } catch (e) {
        if (isTransient(e)) break;   // mạng / máy chủ lỗi tạm → thử lại sau, giữ nguyên thứ tự
        if (e.status === 401 || e.code === 'DEVICE_MISMATCH') { saveQueue(); handleErr(e); return; }
        it.failed = e.message;
      }
      saveQueue();
    }
  } finally { flushing = false; }
  if (synced) toast(`Đã đồng bộ ${synced} lượt chấm công offline`, 'ok');
  const nFailed = S.queue.filter((x) => x.failed).length;
  if (nFailed) toast('Có lượt chấm công offline bị từ chối — xem mục Lịch sử', 'err', 6000);
  if (synced || nFailed) render();
}
window.addEventListener('online', () => { updateNet(); doOpen(); });
window.addEventListener('offline', updateNet);
setInterval(() => flush(), 60e3);

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); stopGps(); return; }
  if (S.token && Date.now() - hiddenAt > 60e3) doOpen();
});

// ---------------- GPS ----------------
let watchId = null, watchTimer = null;
function gpsErrMsg(err) {
  if (err.code === 1) return 'Chưa cấp quyền vị trí. Vào Cài đặt trình duyệt → cho phép Vị trí cho vpaauto.com';
  if (err.code === 3) return 'Hết thời gian lấy vị trí. Ra chỗ thoáng hoặc bật GPS rồi thử lại';
  return 'Không lấy được vị trí. Kiểm tra GPS đã bật chưa';
}
function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; clearTimeout(watchTimer); S.gpsBusy = false; updateGps();
}
function startGps() {
  if (!('geolocation' in navigator)) { S.gpsErr = 'Thiết bị không hỗ trợ định vị'; updateGps(); return; }
  if (watchId != null) return;
  S.gpsBusy = true; S.gpsErr = null; updateGps();
  watchId = navigator.geolocation.watchPosition((pos) => {
    const g = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), at: Date.now() };
    if (!S.gps || g.accuracy <= S.gps.accuracy || Date.now() - S.gps.at > 30e3) S.gps = g;
    S.gpsErr = null; updateGps();
    if (g.accuracy <= 20) stopGps();
  }, (err) => { S.gpsErr = gpsErrMsg(err); stopGps(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  watchTimer = setTimeout(stopGps, 45000);
}
function freshGps() {
  if (S.gps && Date.now() - S.gps.at < 90e3) return Promise.resolve(S.gps);
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Thiết bị không hỗ trợ định vị'));
    navigator.geolocation.getCurrentPosition((pos) => {
      S.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), at: Date.now() };
      updateGps(); resolve(S.gps);
    }, (err) => { S.gpsErr = gpsErrMsg(err); updateGps(); reject(new Error(S.gpsErr)); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 });
  });
}
function distance(a, b) {
  if (!a || !b || b.lat == null) return null;
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}
function updateGps() {
  const box = $('#gpsBox');
  if (!box) return;
  const warnAcc = S.rules.gps_warn_accuracy_m || 100;
  let cls = '', html;
  if (S.gpsErr && !S.gps) { cls = 'err'; html = esc(S.gpsErr); }
  else if (!S.gps) { html = '<span class="spinner"></span> Đang lấy vị trí GPS…'; }
  else {
    cls = S.gps.accuracy > warnAcc ? 'warn' : 'ok';
    const shift = effectiveShift();
    const siteId = shift ? shift.site_id : Number($('#selSite')?.value);
    const site = S.sites.find((s) => s.id === siteId);
    const d = distance(S.gps, site);
    html = `<div><b>Sai số ±${S.gps.accuracy} m</b>${S.gpsBusy ? ' <span class="spinner" style="width:12px;height:12px"></span>' : ''}
      ${S.gps.accuracy > warnAcc ? ' — <b>độ chính xác thấp</b>, nên ra chỗ thoáng' : ''}
      <div class="small mono">${S.gps.lat.toFixed(6)}, ${S.gps.lng.toFixed(6)} · <a href="${mapsLink(S.gps.lat, S.gps.lng)}" target="_blank" rel="noopener">Xem bản đồ</a></div>
      ${d != null ? `<div class="small">Cách <b>${esc(site.name)}</b> ~${d.toLocaleString('vi-VN')} m${d > site.radius_m ? ' <span class="badge warn">ngoài phạm vi</span>' : ''}</div>` : ''}</div>`;
  }
  box.className = 'gps ' + cls;
  box.innerHTML = `<span class="dot"></span><div style="flex:1">${html}</div>
    <button class="btn small" id="btnGps" type="button" ${S.gpsBusy ? 'disabled' : ''}>Lấy lại</button>`;
  $('#btnGps').onclick = () => { S.gps = null; startGps(); };
}

// ---------------- RENDER ----------------
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  hist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
  acc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};
function shell(inner) {
  const me = S.me || {};
  const initials = (me.full_name || '?').split(' ').pop().slice(0, 2).toUpperCase();
  const pending = S.queue.filter((x) => !x.failed).length;
  root.innerHTML = `
  <div class="app">
    <header class="topbar">
      <div class="avatar" id="avatar">${esc(initials)}</div>
      <div class="who"><b>${esc(me.full_name || '')}</b><span class="muted small">${esc(me.code || '')}${me.main_role ? ' · ' + esc(me.main_role) : ''}</span></div>
      <span id="netBadge"></span>
      ${pending ? `<span class="badge warn" title="Chờ đồng bộ">${pending} chờ gửi</span>` : ''}
    </header>
    <div id="view">${inner}</div>
  </div>
  <nav class="tabbar"><div>
    <button data-tab="home" class="${S.tab === 'home' ? 'active' : ''}">${ICONS.home}Chấm công</button>
    <button data-tab="hist" class="${S.tab === 'hist' ? 'active' : ''}">${ICONS.hist}Lịch sử</button>
    <button data-tab="acc" class="${S.tab === 'acc' ? 'active' : ''}">${ICONS.acc}Tài khoản</button>
  </div></nav>`;
  $$('.tabbar button').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; render(); }));
  updateNet();
  loadAvatar();
}
function updateNet() {
  const b = $('#netBadge');
  if (b) b.innerHTML = navigator.onLine ? '<span class="badge ok">Online</span>' : '<span class="badge err">Offline</span>';
}
let avatarUrl = null;
async function loadAvatar() {
  if (!S.me?.photo_file_id || !navigator.onLine) return;
  try {
    if (!avatarUrl) avatarUrl = URL.createObjectURL(await api('GET', '/me/photo', { ...auth(), blob: true }));
    const a = $('#avatar'); if (a) a.innerHTML = `<img src="${avatarUrl}" alt="">`;
  } catch { /* bỏ qua */ }
}

function render() {
  if (!S.token) return renderLogin();
  if (S.tab === 'home') return renderHome();
  if (S.tab === 'hist') return renderHistory();
  return renderAccount();
}

function currentDefault(shift) {
  const step = S.rules.rounding_minutes || 30;
  const at = S.open ? S.open.at : serverNow();
  return shift ? Math.max(roundDown(at, step), ms(shift.in_time)) : roundUp(at, step);
}

function renderHome() {
  const shift = effectiveShift();
  const mode = shift ? 'out' : 'in';
  const def = currentDefault(shift);
  const chosen = S.timeTouched && S.chosen != null ? S.chosen : def;
  const step = S.rules.rounding_minutes || 30;
  const lastSite = store.get('vpa_last_site');
  const failed = S.queue.filter((x) => x.failed);
  shell(`
    ${failed.length ? `<div class="alert err">${failed.length} lượt chấm công offline bị từ chối. <button class="link-btn" id="goHist">Xem chi tiết</button></div>` : ''}
    <div class="card status-card">
      ${shift
        ? `<span class="badge ${shift.pending ? 'warn' : 'ok'}">${shift.pending ? 'Đã check-in (chờ đồng bộ)' : 'Đang làm việc'}</span>
           <div class="big" style="margin-top:8px">${fmtTime(shift.in_time)}</div>
           <div class="muted">Vào ca ${fmtDate(shift.in_time)} tại <b>${esc(shift.site_name || '—')}</b></div>`
        : `<span class="badge">Chưa check-in</span><div class="big" style="margin-top:8px" id="clock">${fmtTime(serverNow())}</div>
           <div class="muted">${weekday(vnToday())}, ${fmtDate(vnToday())}</div>`}
    </div>
    <div class="card">
      <h2>${mode === 'in' ? 'Check-in' : 'Check-out'}</h2>
      ${mode === 'in' ? `
        <label class="field"><span>Vị trí làm việc</span>
          <select id="selSite">${S.sites.length ? '<option value="">— Chọn vị trí / khách hàng —</option>' : '<option value="">Chưa có danh sách vị trí</option>'}
          ${S.sites.map((s) => `<option value="${s.id}" ${s.id === lastSite ? 'selected' : ''}>${esc(s.name)}${s.customer_name ? ' — ' + esc(s.customer_name) : ''}</option>`).join('')}
          </select></label>` : ''}
      <dl class="kv" style="margin:0 0 10px">
        <dt>Mở app lúc</dt><dd>${S.open ? fmtTime(S.open.at) : '—'} ${S.open && !S.open.token ? '<span class="badge warn">giờ máy</span>' : ''}</dd>
        <dt>Giờ mặc định</dt><dd><b>${fmtTime(def)}</b> <span class="muted small">(làm tròn ${mode === 'in' ? 'lên' : 'xuống'} ${step}p)</span></dd>
      </dl>
      <label class="field"><span>Giờ ghi nhận ${mode === 'in' ? 'vào' : 'ra'} (có thể sửa)</span>
        <input type="datetime-local" id="inpTime" value="${toVNInput(chosen)}" step="60"></label>
      <div id="editNote" class="small ${S.timeTouched && chosen !== def ? '' : 'hidden'}" style="margin:-6px 0 10px">
        <span class="badge warn">Đã sửa</span> mặc định ${fmtTime(def)} → ${fmtTime(chosen)} · <button class="link-btn" id="btnReset" type="button">Về mặc định</button></div>
      <label class="field"><span>Ghi chú (không bắt buộc)</span><input id="inpNote" maxlength="300" placeholder="VD: hỗ trợ setup line 3"></label>
      <div id="gpsBox" class="gps"></div>
      <div style="height:12px"></div>
      <button class="btn btn-hero ${mode}" id="btnSubmit">${mode === 'in' ? 'CHECK-IN' : 'CHECK-OUT'}</button>
      ${!navigator.onLine ? '<p class="muted small" style="margin:8px 0 0">Đang offline: lượt chấm sẽ lưu trên máy và tự gửi khi có mạng.</p>' : ''}
    </div>`);
  $('#goHist') && ($('#goHist').onclick = () => { S.tab = 'hist'; render(); });
  $('#selSite') && ($('#selSite').onchange = (e) => { store.set('vpa_last_site', Number(e.target.value) || null); updateGps(); });
  $('#inpTime').onchange = (e) => {
    const v = fromVNInput(e.target.value);
    if (v == null) return;
    S.timeTouched = true; S.chosen = v;
    const n = $('#editNote');
    n.classList.toggle('hidden', v === def);
    n.querySelector('.badge').nextSibling.textContent = ` mặc định ${fmtTime(def)} → ${fmtTime(v)} · `;
  };
  $('#btnReset').onclick = () => { S.timeTouched = false; S.chosen = null; renderHome(); };
  $('#btnSubmit').onclick = submit;
  updateGps();
}
setInterval(() => { const c = $('#clock'); if (c) c.textContent = fmtTime(serverNow()); }, 15e3);

async function submit() {
  const btn = $('#btnSubmit');
  const shift = effectiveShift();
  const mode = shift ? 'out' : 'in';
  const siteId = mode === 'in' ? Number($('#selSite')?.value) : shift.site_id;
  if (mode === 'in' && !siteId) return toast('Vui lòng chọn vị trí làm việc', 'err');
  const def = currentDefault(shift);
  const chosen = S.timeTouched && S.chosen != null ? S.chosen : def;
  if (mode === 'out' && chosen < ms(shift.in_time)) return toast('Giờ ra phải sau giờ vào', 'err');
  btn.disabled = true; const label = btn.textContent; btn.innerHTML = '<span class="spinner"></span> Đang lấy vị trí…';
  let g;
  try { g = await freshGps(); } catch (e) { toast(e.message, 'err', 6000); btn.disabled = false; btn.textContent = label; return; }
  btn.innerHTML = '<span class="spinner"></span> Đang gửi…';
  const body = {
    client_uuid: uuid(), open_token: S.open?.token || null, opened_at: iso(S.open?.at ?? serverNow()),
    pressed_at: iso(serverNow()), device_time: iso(Date.now()),
    lat: g.lat, lng: g.lng, accuracy: g.accuracy, note: $('#inpNote').value.trim() || undefined,
  };
  if (S.timeTouched) body.chosen_time = iso(chosen);
  if (mode === 'in') { body.site_id = siteId; store.set('vpa_last_site', siteId); }
  else if (shift.pending) body.in_client_uuid = shift.in_client_uuid;
  else body.attendance_id = shift.id;
  const path = mode === 'in' ? '/attendance/check-in' : '/attendance/check-out';
  const enqueue = () => {
    S.queue.push({ id: uuid(), owner: S.me?.code, type: mode, body: { ...body, offline: true }, siteName: S.sites.find((s) => s.id === siteId)?.name,
      defaultIso: iso(def), created: Date.now() });
    saveQueue();
    toast(`Đã lưu ${mode === 'in' ? 'check-in' : 'check-out'} trên máy — sẽ tự gửi khi có mạng`, 'warn', 5000);
  };
  try {
    if (!navigator.onLine || S.queue.some((x) => !x.failed && mine(x))) { enqueue(); flush(); }
    else {
      const r = await api('POST', path, { ...auth(), body: { ...body, sent_device_time: iso(Date.now()) } });
      setOpenShift(mode === 'in' ? r.record : null);
      toast(mode === 'in' ? `Check-in thành công lúc ${fmtTime(r.record.in_time)}` : `Check-out thành công lúc ${fmtTime(r.record.out_time)}`, 'ok', 4000);
    }
  } catch (e) {
    if (isTransient(e)) enqueue();
    else { handleErr(e); if (e.code === 'OPEN_SHIFT_EXISTS' || e.code === 'NO_OPEN_SHIFT') await refresh(); }
  }
  S.gps = null;
  doOpen();
}

// ---------------- LỊCH SỬ ----------------
async function renderHistory() {
  const [y, m] = S.month.split('-').map(Number);
  const failed = S.queue.filter((x) => x.failed), pending = S.queue.filter((x) => !x.failed);
  shell(`
    ${failed.length || pending.length ? `<div class="card"><h3>Chấm công lưu trên máy</h3>
      ${S.queue.map((it) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)">
        <div><b>${it.type === 'in' ? 'Check-in' : 'Check-out'}</b> ${fmtDateTime(it.body.chosen_time || it.defaultIso)}
          <div class="small ${it.failed ? '' : 'muted'}" style="${it.failed ? 'color:var(--err)' : ''}">${it.failed ? 'Bị từ chối: ' + esc(it.failed) : 'Chờ gửi'}</div></div>
        ${it.failed ? `<span class="row" style="gap:6px"><button class="btn small" data-retry="${it.id}">Gửi lại</button><button class="btn small danger" data-drop="${it.id}">Bỏ</button></span>` : ''}</div>`).join('')}
      </div>` : ''}
    <div class="row between" style="margin-bottom:12px">
      <button class="btn small" id="mPrev">‹</button><b>Tháng ${String(m).padStart(2, '0')}/${y}</b><button class="btn small" id="mNext">›</button>
    </div>
    <div id="histBody"><div class="card"><span class="spinner"></span></div></div>`);
  $$('[data-retry]').forEach((b) => (b.onclick = () => {
    const it = S.queue.find((x) => x.id === b.dataset.retry); if (it) delete it.failed;
    saveQueue(); flush().then(() => renderHistory());
  }));
  $$('[data-drop]').forEach((b) => (b.onclick = () => {
    if (!confirm('Bỏ lượt chấm công bị từ chối này?')) return;
    S.queue = S.queue.filter((x) => x.id !== b.dataset.drop); saveQueue(); render();
  }));
  const shiftMonth = (d) => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); S.month = t.toISOString().slice(0, 7); renderHistory(); };
  $('#mPrev').onclick = () => shiftMonth(-1);
  $('#mNext').onclick = () => shiftMonth(1);
  let data;
  try { data = await api('GET', '/attendance/mine?month=' + S.month, auth()); store.set('vpa_hist_' + S.month, data); }
  catch (e) { if (handleErr(e, { silent: true })) return; data = store.get('vpa_hist_' + S.month); }
  const body = $('#histBody'); if (!body) return;
  if (!data) { body.innerHTML = '<div class="card muted">Không tải được dữ liệu (offline).</div>'; return; }
  const recs = data.records;
  const tot = recs.reduce((a, r) => { a.w += r.hours.worked_h || 0; a.ot += r.hours.ot_h || 0; return a; }, { w: 0, ot: 0 });
  const days = new Set(recs.map((r) => r.work_date)).size;
  body.innerHTML = `
    <div class="grid2" style="margin-bottom:12px">
      <div class="card" style="margin:0"><div class="muted small">Ngày có công</div><b style="font-size:1.4rem">${days}</b></div>
      <div class="card" style="margin:0"><div class="muted small">Tổng giờ / OT</div><b style="font-size:1.4rem">${fmtH(tot.w)}</b> <span class="muted">/ ${fmtH(tot.ot)}</span></div>
    </div>
    ${recs.length ? recs.map(recCard).join('') : '<div class="card muted">Chưa có dữ liệu chấm công trong tháng.</div>'}`;
  $$('[data-edit]', body).forEach((b) => (b.onclick = () => openEdit(recs.find((r) => r.id === Number(b.dataset.edit)))));
}
const FIELD = { in_time: 'Giờ vào', out_time: 'Giờ ra', note: 'Ghi chú', site_id: 'Vị trí' };
function recCard(r) {
  const h = r.hours;
  return `<div class="card rec ${r.out_time ? '' : 'open'}">
    <div class="row between"><b>${weekday(r.work_date)}, ${fmtDate(r.work_date)}</b>
      <span>${h.day_type !== 'weekday' ? `<span class="badge warn">${DAY_TYPE[h.day_type]}</span> ` : ''}${r.source === 'admin' ? '<span class="badge">QL nhập</span>' : ''}</span></div>
    <div class="muted small">${esc(r.site_name || '—')}</div>
    <div class="times">
      <div><div class="muted small">Vào ${r.in_edited ? '<span class="badge warn">sửa</span>' : ''} ${r.in_offline ? '<span class="badge">offline</span>' : ''}</div><b>${fmtTime(r.in_time)}</b>
        <div class="muted small">Mở app ${fmtTime(r.in_opened_at)} · mặc định ${fmtTime(r.in_default_at)}</div></div>
      <div><div class="muted small">Ra ${r.out_edited ? '<span class="badge warn">sửa</span>' : ''} ${r.out_offline ? '<span class="badge">offline</span>' : ''}</div><b>${r.out_time ? fmtTime(r.out_time) : '—'}</b>
        ${r.out_time ? `<div class="muted small">Mở app ${fmtTime(r.out_opened_at)} · mặc định ${fmtTime(r.out_default_at)}${fmtDate(r.out_time) !== fmtDate(r.in_time) ? ' · ' + fmtDate(r.out_time) : ''}</div>` : '<div class="muted small">Chưa check-out</div>'}</div>
    </div>
    ${r.out_time ? `<div class="small">Công: <b>${fmtH(h.worked_h)} h</b> · OT ${fmtH(h.ot_h)} h${h.night_h ? ` · đêm ${fmtH(h.night_h)} h` : ''}${h.break_h ? ` <span class="muted">(đã trừ nghỉ ${fmtH(h.break_h)} h)</span>` : ''}</div>` : ''}
    ${r.note ? `<div class="small muted">Ghi chú: ${esc(r.note)}</div>` : ''}
    ${r.edits.length ? `<div class="edits"><b>Lịch sử sửa</b>${r.edits.map((e) => `<div>${fmtDateTime(e.at)} · ${e.by === 'admin' ? 'Quản lý' : 'Bạn'} sửa ${FIELD[e.field]}:
      ${e.field.endsWith('_time') ? `${fmtTime(e.old)} → <b>${fmtTime(e.new)}</b>` : `${esc(e.old || '∅')} → <b>${esc(e.new || '∅')}</b>`}${e.stage === 'at_submit' ? ' (lúc chấm)' : ''}${e.reason ? ` — ${esc(e.reason)}` : ''}</div>`).join('')}</div>` : ''}
    <div style="margin-top:8px"><button class="btn small" data-edit="${r.id}">Sửa giờ</button></div>
  </div>`;
}
function openEdit(r) {
  if (!navigator.onLine) return toast('Cần có mạng để sửa giờ', 'warn');
  modal(`<h2>Sửa giờ — ${fmtDate(r.work_date)}</h2>
    <p class="muted small">Mọi thay đổi đều được lưu lịch sử (giờ cũ → giờ mới) và quản lý xem được.</p>
    <form id="fEdit">
      <label class="field"><span>Giờ vào</span><input type="datetime-local" name="in" value="${toVNInput(ms(r.in_time))}" required></label>
      ${r.out_time ? `<label class="field"><span>Giờ ra</span><input type="datetime-local" name="out" value="${toVNInput(ms(r.out_time))}" required></label>` : ''}
      <label class="field"><span>Ghi chú</span><input name="note" value="${esc(r.note || '')}" maxlength="300"></label>
      <label class="field"><span>Lý do sửa (không bắt buộc)</span><input name="reason" maxlength="300"></label>
      <div class="row"><button class="btn primary" style="flex:1" type="submit">Lưu</button><button class="btn" type="button" data-close>Huỷ</button></div>
    </form>`, { onMount: (m, close) => {
    $('#fEdit', m).onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const b = { in_time: iso(fromVNInput(f.get('in'))), note: f.get('note').trim() || null, reason: f.get('reason').trim() || null };
      if (r.out_time) b.out_time = iso(fromVNInput(f.get('out')));
      try {
        const res = await api('PATCH', '/attendance/' + r.id, { ...auth(), body: b });
        toast(res.changes ? 'Đã lưu thay đổi' : 'Không có thay đổi', 'ok'); close();
        await refresh(); renderHistory();
      } catch (e) { handleErr(e); }
    };
  } });
}

// ---------------- TÀI KHOẢN ----------------
function renderAccount() {
  const me = S.me || {};
  shell(`
    <div class="card"><h2>Thông tin</h2>
      <dl class="kv"><dt>Mã NV</dt><dd>${esc(me.code)}</dd><dt>Họ tên</dt><dd>${esc(me.full_name)}</dd>
      <dt>Hình thức</dt><dd>${esc(EMP_TYPE[me.employment_type] || '')}</dd><dt>Vai trò</dt><dd>${esc(me.main_role || '—')}</dd></dl></div>
    <div class="card">
      <button class="btn block" id="btnPw">Đổi mật khẩu</button>
      <div style="height:8px"></div>
      <button class="btn block ${installEvt ? '' : 'hidden'}" id="btnInstall">Cài ứng dụng lên màn hình chính</button>
      <button class="btn block danger" id="btnLogout">Đăng xuất</button>
      <p class="muted small" style="margin:10px 0 0">Đăng xuất không gỡ liên kết thiết bị. Đổi điện thoại → báo quản lý đặt lại thiết bị.</p>
    </div>
    <p class="muted small" style="text-align:center">VPA Chấm công v${VERSION} · Mã thiết bị …${esc(S.deviceId.slice(-6))}</p>`);
  $('#btnPw').onclick = () => renderChangePassword(false);
  $('#btnInstall').onclick = () => installEvt && installEvt.prompt();
  $('#btnLogout').onclick = () => {
    if (S.queue.some((x) => !x.failed) && !confirm('Còn lượt chấm công chưa gửi. Đăng xuất vẫn giữ lại và gửi khi đăng nhập lại. Tiếp tục?')) return;
    logout();
  };
}

// ---------------- START ----------------
render();
if (S.token) doOpen();
