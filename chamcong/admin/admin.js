// VPA Chấm công — Trang Quản trị
import {
  api, ApiError, toVNInput, fromVNInput, ms, fmtTime, fmtDate, fmtDateTime, weekday, vnToday,
  fmtH, DAY_TYPE, EMP_TYPE, SALARY_TYPE, $, $$, esc, toast, store, mapsLink, modal,
} from '../common.js';
import * as V from './vault.js';

const iso = (t) => (t == null ? null : new Date(t).toISOString());
const root = $('#root');
const T = { token: store.get('vpa_admin_token'), user: store.get('vpa_admin_user'), tab: 'dash', roles: [], sites: [], employees: [], vault: undefined };

async function A(method, path, opts = {}) {
  try { return await api(method, '/admin' + path, { token: T.token, ...opts }); }
  catch (e) {
    if (e instanceof ApiError && e.status === 401 && path !== '/login') { logout('Phiên đăng nhập hết hạn'); }
    throw e;
  }
}
const fail = (e) => toast(e instanceof ApiError ? e.message : (e.message || 'Không kết nối được máy chủ'), 'err', 6000);
function logout(msg) { T.token = null; store.del('vpa_admin_token'); V.lock(); renderLogin(msg); }

// ---------------- LOGIN ----------------
function renderLogin(msg) {
  root.innerHTML = `<div class="login">
    <div class="logo"><img src="../icons/icon-192.png" alt=""><div><b>Quản trị Chấm công</b><div class="muted small">VPA AUTOMATION</div></div></div>
    ${msg ? `<div class="alert err">${esc(msg)}</div>` : ''}
    <form class="card" id="f"><label class="field"><span>Tài khoản</span><input name="u" autocomplete="username" required></label>
    <label class="field"><span>Mật khẩu</span><input name="p" type="password" autocomplete="current-password" required></label>
    <button class="btn primary block">Đăng nhập</button></form></div>`;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault(); const f = new FormData(ev.target);
    try {
      const r = await A('POST', '/login', { body: { username: f.get('u'), password: f.get('p') } });
      T.token = r.token; T.user = r.username; store.set('vpa_admin_token', r.token); store.set('vpa_admin_user', r.username);
      boot();
    } catch (e) { fail(e); }
  };
}

// ---------------- SHELL ----------------
const TABS = [['dash', 'Tổng quan'], ['att', 'Chấm công'], ['emp', 'Nhân sự'], ['sites', 'Vị trí / Site'], ['report', 'Báo cáo Excel'], ['settings', 'Cài đặt'], ['audit', 'Nhật ký']];
async function boot() {
  try {
    [T.roles, T.sites, T.employees, T.vault] = await Promise.all([A('GET', '/job-roles'), A('GET', '/sites'), A('GET', '/employees'), A('GET', '/vault')]);
  } catch (e) { if (T.token) fail(e); return; }
  root.innerHTML = `<div class="admin">
    <nav><div class="logo"><img src="../icons/icon-192.png" alt=""><div><b>VPA Admin</b><div class="muted small">${esc(T.user || '')}</div></div></div>
      ${TABS.map(([k, n]) => `<button data-tab="${k}">${n}</button>`).join('')}
      <button id="btnLogout" style="color:var(--err)">Đăng xuất</button></nav>
    <main><div id="vaultBar"></div><div id="view"></div></main></div>`;
  $$('nav [data-tab]').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  $('#btnLogout').onclick = () => logout();
  if (!T._vaultHook) { T._vaultHook = true; V.onChange(() => { renderVaultBar(); if (['emp', 'report'].includes(T.tab)) go(T.tab); }); }
  renderVaultBar();
  go(T.tab);
}
function go(tab) {
  T.tab = tab;
  $$('nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const v = $('#view'); v.innerHTML = '<span class="spinner"></span>';
  ({ dash: viewDash, att: viewAtt, emp: viewEmp, sites: viewSites, report: viewReport, settings: viewSettings, audit: viewAudit })[tab](v)
    .catch(fail);
}
const empName = (id) => T.employees.find((e) => e.id === id);
const empOptions = (sel, all = true) => (all ? '<option value="">— Tất cả NV —</option>' : '') +
  T.employees.map((e) => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.code)} — ${esc(e.full_name)}${e.status === 'inactive' ? ' (nghỉ)' : ''}</option>`).join('');
const siteOptions = (sel, empty = '— Tất cả vị trí —') => `<option value="">${empty}</option>` +
  T.sites.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${s.active ? '' : ' (ngưng)'}</option>`).join('');

// ---------------- VAULT ----------------
function renderVaultBar() {
  const bar = $('#vaultBar'); if (!bar) return;
  if (T.vault === null) {
    bar.innerHTML = `<div class="alert"><b>Chưa thiết lập Két dữ liệu.</b> CCCD, STK, lương được mã hoá ngay trên trình duyệt bằng mật khẩu két của anh — máy chủ không đọc được.
      <button class="btn small primary" id="vSetup" style="margin-left:8px">Thiết lập két</button></div>`;
    $('#vSetup').onclick = vaultSetup;
  } else if (!V.isUnlocked()) {
    bar.innerHTML = `<div class="alert info"><span class="lock">🔒 Két dữ liệu đang <b>khoá</b> — CCCD, STK, lương bị ẩn.</span>
      <button class="btn small primary" id="vUnlock" style="margin-left:8px">Mở khoá</button></div>`;
    $('#vUnlock').onclick = vaultUnlock;
  } else {
    bar.innerHTML = `<div class="alert" style="background:var(--ok-soft);color:var(--ok)">🔓 Két dữ liệu đang <b>mở</b> (chỉ trên tab này).
      <button class="btn small" id="vLock" style="margin-left:8px">Khoá lại</button></div>`;
    $('#vLock').onclick = () => V.lock();
  }
}
function vaultSetup() {
  modal(`<h2>Thiết lập Két dữ liệu</h2>
    <div class="alert err"><b>Quan trọng:</b> mất cả mật khẩu két và mã khôi phục = <b>mất vĩnh viễn</b> dữ liệu CCCD/STK/lương. Không ai (kể cả nhà phát triển) khôi phục được.</div>
    <form id="f"><label class="field"><span>Mật khẩu đăng nhập Admin (xác nhận)</span><input name="ap" type="password" required autocomplete="current-password"></label>
    <label class="field"><span>Mật khẩu két (≥ 12 ký tự, khác mật khẩu đăng nhập)</span><input name="p1" type="password" minlength="12" required autocomplete="new-password"></label>
    <label class="field"><span>Nhập lại</span><input name="p2" type="password" minlength="12" required autocomplete="new-password"></label>
    <div class="row"><button class="btn primary" style="flex:1">Tạo két</button><button class="btn" type="button" data-close>Huỷ</button></div></form>`,
  { onMount: (m, close) => {
    $('#f', m).onsubmit = async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      if (f.get('p1') !== f.get('p2')) return toast('Mật khẩu nhập lại không khớp', 'err');
      try {
        const { record, recovery } = await V.setup(f.get('p1'));
        await A('PUT', '/vault', { body: { ...record, admin_password: f.get('ap') } });
        T.vault = await A('GET', '/vault');
        close(); showRecovery(recovery); renderVaultBar();
      } catch (e) { V.lock(); fail(e); }
    };
  } });
}
function showRecovery(code) {
  const txt = `VPA AUTOMATION — MÃ KHÔI PHỤC KÉT DỮ LIỆU CHẤM CÔNG\nTạo lúc: ${new Date().toLocaleString('vi-VN')}\n\n${code}\n\nCất file này OFFLINE (USB / két sắt). Ai có mã này sẽ giải mã được CCCD/STK/lương.\n`;
  modal(`<h2>Mã khôi phục két</h2>
    <p>Dùng khi quên mật khẩu két. <b>Tải về và cất offline ngay</b>, không gửi qua chat/email.</p>
    <pre class="card mono" style="white-space:pre-wrap;word-break:break-all">${esc(code)}</pre>
    <div class="row"><button class="btn primary" id="dl" style="flex:1">Tải file khôi phục</button><button class="btn" data-close>Đã cất giữ</button></div>`,
  { onMount: (m) => {
    $('#dl', m).onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
      a.download = `VPA-chamcong-ma-khoi-phuc-${vnToday()}.txt`; a.click();
    };
  } });
}
function vaultUnlock() {
  return new Promise((resolve) => {
    modal(`<h2>Mở khoá Két dữ liệu</h2>
      <form id="f"><label class="field"><span>Mật khẩu két</span><input name="p" type="password" autocomplete="off" required autofocus></label>
      <div class="row"><button class="btn primary" style="flex:1">Mở khoá</button><button class="btn" type="button" data-close>Huỷ</button></div></form>
      <p class="small"><button class="link-btn" id="rec">Quên mật khẩu? Dùng mã khôi phục</button></p>`,
    { onMount: (m, close) => {
      $('#f', m).onsubmit = async (ev) => {
        ev.preventDefault();
        const btn = ev.target.querySelector('.primary'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
        try { await V.unlock(new FormData(ev.target).get('p'), T.vault); close(); toast('Đã mở khoá két', 'ok'); resolve(true); }
        catch (e) { fail(e); btn.disabled = false; btn.textContent = 'Mở khoá'; }
      };
      $('#rec', m).onclick = () => { close(); recoveryUnlock().then(resolve); };
    } });
  });
}
function recoveryUnlock() {
  return new Promise((resolve) => {
    modal(`<h2>Khôi phục bằng mã</h2>
      <form id="f"><label class="field"><span>Mã khôi phục</span><textarea name="c" required></textarea></label>
      <label class="field"><span>Đặt mật khẩu két MỚI (≥ 12 ký tự)</span><input name="p" type="password" minlength="12" required autocomplete="new-password"></label>
      <label class="field"><span>Mật khẩu đăng nhập Admin (xác nhận)</span><input name="ap" type="password" required autocomplete="current-password"></label>
      <div class="row"><button class="btn primary" style="flex:1">Khôi phục</button><button class="btn" type="button" data-close>Huỷ</button></div></form>`,
    { onMount: (m, close) => {
      $('#f', m).onsubmit = async (ev) => {
        ev.preventDefault(); const f = new FormData(ev.target);
        try {
          await V.unlockWithRecovery(f.get('c'), T.vault);
          await A('PUT', '/vault', { body: { ...(await V.rewrap(f.get('p'))), admin_password: f.get('ap') } });
          T.vault = await A('GET', '/vault'); close(); toast('Đã khôi phục & đặt mật khẩu két mới', 'ok'); resolve(true);
        } catch (e) { fail(e); }
      };
    } });
  });
}
async function ensureUnlocked() {
  if (V.isUnlocked()) return true;
  if (T.vault === null) { vaultSetup(); return false; }
  return vaultUnlock();
}

// ---------------- TỔNG QUAN ----------------
async function viewDash(v) {
  const live = await A('GET', '/attendance/live');
  const today = vnToday();
  const open = live.filter((r) => !r.out_time);
  const todayRecs = live.filter((r) => r.work_date === today);
  const stale = open.filter((r) => Date.now() - ms(r.in_time) > 16 * 3600e3);
  v.innerHTML = `<h2>Tổng quan — ${weekday(today)}, ${fmtDate(today)}</h2>
    <div class="stats">
      <div class="stat"><span class="muted small">Nhân sự đang làm việc</span><b>${T.employees.filter((e) => e.status === 'active').length}</b></div>
      <div class="stat"><span class="muted small">Đang trong ca</span><b>${open.length}</b></div>
      <div class="stat"><span class="muted small">Ca hôm nay</span><b>${todayRecs.length}</b></div>
      <div class="stat"><span class="muted small">Quên check-out (&gt;16h)</span><b style="color:${stale.length ? 'var(--err)' : 'inherit'}">${stale.length}</b></div>
    </div>
    <h3>Đang trong ca & ca hôm nay</h3>
    ${attTable(live, { compact: true })}`;
  bindAttTable(v, live, () => go('dash'));
}

// ---------------- CHẤM CÔNG ----------------
const skewTxt = (s) => (s != null && Math.abs(s) > 300 ? ` lệch ${Math.round(s / 60)}p` : '');
function flags(r) {
  const unver = r.source === 'app' && (!r.in_time_verified || (r.out_time && !r.out_time_verified));
  const skew = skewTxt(r.in_clock_skew_s) || skewTxt(r.out_clock_skew_s);
  return [r.in_edited || r.out_edited ? '<span class="badge warn">sửa</span>' : '',
    unver ? `<span class="badge err" title="Giờ mở app lấy từ đồng hồ điện thoại (offline) — cần đối chiếu">giờ máy${skew}</span>` : (skew ? `<span class="badge warn">${skew.trim()}</span>` : ''),
    r.source === 'admin' ? '<span class="badge">QL nhập</span>' : '', !r.out_time ? '<span class="badge err">chưa ra</span>' : ''].join(' ');
}
function gpsCell(lat, lng, acc, dist, radius) {
  if (lat == null) return '—';
  return `<a href="${mapsLink(lat, lng)}" target="_blank" rel="noopener">Bản đồ</a> <span class="muted">±${acc ?? '?'}m</span>${dist != null ? ` · <span style="color:${radius && dist > radius ? 'var(--err)' : 'inherit'}">${dist.toLocaleString('vi-VN')}m</span>` : ''}`;
}
function attTable(rows, { compact } = {}) {
  if (!rows.length) return '<div class="card muted">Không có dữ liệu.</div>';
  const rad = (id) => T.sites.find((s) => s.id === id)?.radius_m;
  return `<div class="table-wrap"><table><thead><tr>
    <th>Ngày</th><th>NV</th><th>Vị trí</th><th>Mở app (vào)</th><th>Mặc định</th><th>Giờ vào</th><th>Mở app (ra)</th><th>Mặc định</th><th>Giờ ra</th>
    <th class="num">Công</th><th class="num">OT</th><th class="num">Đêm</th><th>GPS vào</th><th>GPS ra</th><th>Cờ</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td>${weekday(r.work_date)} ${fmtDate(r.work_date)}${r.hours.day_type !== 'weekday' ? `<br><span class="badge warn">${DAY_TYPE[r.hours.day_type]}</span>` : ''}</td>
      <td><b>${esc(r.employee_code)}</b><br>${esc(r.employee_name)}</td>
      <td>${esc(r.site_name || '—')}</td>
      <td class="mono">${fmtTime(r.in_opened_at)}</td><td class="mono muted">${fmtTime(r.in_default_at)}</td><td class="mono"><b>${fmtTime(r.in_time)}</b></td>
      <td class="mono">${fmtTime(r.out_opened_at)}</td><td class="mono muted">${fmtTime(r.out_default_at)}</td>
      <td class="mono"><b>${r.out_time ? fmtTime(r.out_time) : '—'}</b>${r.out_time && fmtDate(r.out_time) !== fmtDate(r.in_time) ? `<br><span class="small muted">${fmtDate(r.out_time)}</span>` : ''}</td>
      <td class="num">${fmtH(r.hours.worked_h)}</td><td class="num">${fmtH(r.hours.ot_h)}</td><td class="num">${fmtH(r.hours.night_h)}</td>
      <td>${gpsCell(r.in_lat, r.in_lng, r.in_accuracy_m, r.in_distance_m, rad(r.site_id))}</td>
      <td>${gpsCell(r.out_lat, r.out_lng, r.out_accuracy_m, r.out_distance_m, rad(r.site_id))}</td>
      <td>${flags(r)}${r.note ? `<div class="small muted" title="${esc(r.note)}">📝 ${esc(r.note.slice(0, 30))}</div>` : ''}</td>
      <td><button class="btn small" data-edit="${r.id}">Sửa</button> ${r.edit_count ? `<button class="btn small" data-hist="${r.id}">Lịch sử (${r.edit_count})</button>` : ''}
        ${compact ? '' : `<button class="btn small danger" data-del="${r.id}">Xoá</button>`}</td>
    </tr>`).join('')}</tbody></table></div>`;
}
function bindAttTable(v, rows, reload) {
  $$('[data-edit]', v).forEach((b) => (b.onclick = () => editAtt(rows.find((r) => r.id === Number(b.dataset.edit)), reload)));
  $$('[data-hist]', v).forEach((b) => (b.onclick = () => showEdits(Number(b.dataset.hist))));
  $$('[data-del]', v).forEach((b) => (b.onclick = async () => {
    if (!confirm('Xoá vĩnh viễn ca chấm công này? (Nhật ký vẫn lưu bản sao)')) return;
    try { await A('DELETE', '/attendance/' + b.dataset.del); toast('Đã xoá', 'ok'); reload(); } catch (e) { fail(e); }
  }));
}
function editAtt(r, reload) {
  modal(`<h2>Sửa ca — ${esc(r.employee_code)} ${esc(r.employee_name)}</h2>
    <form id="f"><div class="form-grid">
      <label class="field"><span>Giờ vào</span><input type="datetime-local" name="in" value="${toVNInput(ms(r.in_time))}" required></label>
      <label class="field"><span>Giờ ra ${r.out_time ? '' : '(để trống = chưa ra)'}</span><input type="datetime-local" name="out" value="${toVNInput(ms(r.out_time))}"></label>
      <label class="field"><span>Vị trí</span><select name="site">${siteOptions(r.site_id, '— Không —')}</select></label>
      <label class="field"><span>Ghi chú</span><input name="note" value="${esc(r.note || '')}"></label></div>
      <label class="field"><span>Lý do sửa</span><input name="reason" placeholder="Bắt buộc nên ghi khi Admin sửa"></label>
      <div class="row"><button class="btn primary" style="flex:1">Lưu</button><button class="btn" type="button" data-close>Huỷ</button></div></form>`,
  { onMount: (m, close) => {
    $('#f', m).onsubmit = async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      const b = { in_time: iso(fromVNInput(f.get('in'))), site_id: f.get('site') ? Number(f.get('site')) : null, note: f.get('note') || null, reason: f.get('reason') || null };
      if (f.get('out')) b.out_time = iso(fromVNInput(f.get('out')));
      try { const res = await A('PATCH', '/attendance/' + r.id, { body: b }); toast(res.changes ? 'Đã lưu' : 'Không có thay đổi', 'ok'); close(); reload(); }
      catch (e) { fail(e); }
    };
  } });
}
const FIELD = { in_time: 'Giờ vào', out_time: 'Giờ ra', site_id: 'Vị trí', note: 'Ghi chú' };
function fmtEditVal(field, v) {
  if (v == null) return '∅';
  if (field.endsWith('_time')) return fmtDateTime(v);
  if (field === 'site_id') return esc(T.sites.find((s) => s.id === Number(v))?.name || v);
  return esc(v);
}
async function showEdits(id) {
  try {
    const list = await A('GET', `/attendance/${id}/edits`);
    modal(`<h2>Lịch sử sửa</h2><div class="table-wrap"><table><thead><tr><th>Lúc</th><th>Người sửa</th><th>Trường</th><th>Cũ</th><th>Mới</th><th>Khi</th><th>Lý do</th></tr></thead><tbody>
      ${list.map((e) => `<tr><td>${fmtDateTime(e.edited_at)}</td><td>${e.edited_by_type === 'admin' ? 'Admin' : 'Nhân viên'}</td><td>${FIELD[e.field]}</td>
      <td>${fmtEditVal(e.field, e.old_value)}</td><td><b>${fmtEditVal(e.field, e.new_value)}</b></td><td>${e.stage === 'at_submit' ? 'Lúc chấm' : 'Sửa sau'}</td><td>${esc(e.reason || '')}</td></tr>`).join('')}
      </tbody></table></div><div style="height:12px"></div><button class="btn" data-close>Đóng</button>`, { wide: true });
  } catch (e) { fail(e); }
}
const monthStart = () => vnToday().slice(0, 8) + '01';
async function viewAtt(v) {
  const f = T.attFilter || (T.attFilter = { from: monthStart(), to: vnToday(), employee_id: '', site_id: '' });
  v.innerHTML = `<h2>Chấm công</h2>
    <form class="toolbar" id="fFilter">
      <label class="field"><span>Từ ngày</span><input type="date" name="from" value="${f.from}"></label>
      <label class="field"><span>Đến ngày</span><input type="date" name="to" value="${f.to}"></label>
      <label class="field" style="min-width:220px"><span>Nhân viên</span><select name="employee_id">${empOptions(Number(f.employee_id))}</select></label>
      <label class="field" style="min-width:180px"><span>Vị trí</span><select name="site_id">${siteOptions(Number(f.site_id))}</select></label>
      <button class="btn primary">Lọc</button><button class="btn" type="button" id="btnManual">+ Nhập ca thủ công</button>
    </form><div id="attBody"><span class="spinner"></span></div>`;
  $('#fFilter').onsubmit = (ev) => { ev.preventDefault(); Object.assign(f, Object.fromEntries(new FormData(ev.target))); go('att'); };
  $('#btnManual').onclick = () => manualAtt(() => go('att'));
  const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x)).toString();
  const { records } = await A('GET', '/attendance?' + qs);
  const tot = records.reduce((a, r) => { a.w += r.hours.worked_h || 0; a.ot += r.hours.ot_h || 0; a.n += r.hours.night_h || 0; return a; }, { w: 0, ot: 0, n: 0 });
  $('#attBody').innerHTML = `<p class="muted">${records.length} ca · Tổng công <b>${fmtH(tot.w)}</b> h · OT <b>${fmtH(tot.ot)}</b> h · Đêm <b>${fmtH(tot.n)}</b> h</p>` + attTable(records);
  bindAttTable(v, records, () => go('att'));
}
function manualAtt(reload) {
  modal(`<h2>Nhập ca thủ công</h2><p class="muted small">Dùng khi NV quên chấm. Ca sẽ được đánh dấu "QL nhập", không có GPS.</p>
    <form id="f"><label class="field"><span>Nhân viên</span><select name="emp" required><option value="">— Chọn —</option>${empOptions(null, false)}</select></label>
    <label class="field"><span>Vị trí</span><select name="site">${siteOptions(null, '— Không —')}</select></label>
    <div class="form-grid"><label class="field"><span>Giờ vào</span><input type="datetime-local" name="in" required></label>
    <label class="field"><span>Giờ ra</span><input type="datetime-local" name="out"></label></div>
    <label class="field"><span>Ghi chú</span><input name="note" placeholder="Lý do nhập thủ công"></label>
    <div class="row"><button class="btn primary" style="flex:1">Lưu</button><button class="btn" type="button" data-close>Huỷ</button></div></form>`,
  { onMount: (m, close) => {
    $('#f', m).onsubmit = async (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try {
        await A('POST', '/attendance', { body: { employee_id: Number(f.get('emp')), site_id: f.get('site') || null,
          in_time: iso(fromVNInput(f.get('in'))), out_time: f.get('out') ? iso(fromVNInput(f.get('out'))) : null, note: f.get('note') || null } });
        toast('Đã thêm ca', 'ok'); close(); reload();
      } catch (e) { fail(e); }
    };
  } });
}

// ---------------- NHÂN SỰ ----------------
async function viewEmp(v) {
  T.employees = await A('GET', '/employees');
  const kw = (T.empKw || '').toLowerCase();
  const list = T.employees.filter((e) => !kw || `${e.code} ${e.full_name} ${e.phone || ''} ${e.main_role || ''}`.toLowerCase().includes(kw));
  v.innerHTML = `<h2>Nhân sự (${T.employees.filter((e) => e.status === 'active').length} đang làm / ${T.employees.length})</h2>
    <div class="toolbar"><label class="field" style="min-width:260px"><span>Tìm kiếm</span><input id="kw" value="${esc(T.empKw || '')}" placeholder="Mã, tên, SĐT, vai trò"></label>
    <button class="btn primary" id="btnAdd">+ Thêm nhân sự</button></div>
    <div class="table-wrap"><table><thead><tr><th>Mã NV</th><th>Họ và tên</th><th>Hình thức</th><th>Vai trò chính</th><th>SĐT</th><th>Ngày sinh</th><th>Ngân hàng</th><th>Trạng thái</th><th>Thiết bị</th><th>Đăng nhập gần nhất</th></tr></thead><tbody>
    ${list.map((e) => `<tr data-id="${e.id}" style="cursor:pointer">
      <td><b>${esc(e.code)}</b></td><td>${esc(e.full_name)}</td><td>${esc(EMP_TYPE[e.employment_type])}</td><td>${esc(e.main_role || '—')}</td>
      <td>${esc(e.phone || '—')}</td><td>${e.date_of_birth ? fmtDate(e.date_of_birth) : '—'}</td><td>${esc(e.bank_name || '—')}</td>
      <td>${e.status === 'active' ? '<span class="badge ok">Đang làm</span>' : '<span class="badge err">Nghỉ việc</span>'}</td>
      <td>${e.device_bound ? '<span class="badge ok">Đã gắn</span>' : '<span class="badge">Chưa</span>'}</td><td>${e.last_login_at ? fmtDateTime(e.last_login_at) : '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
  $('#kw').oninput = (e) => { T.empKw = e.target.value; clearTimeout(T._kwT); T._kwT = setTimeout(() => { go('emp'); setTimeout(() => { const k = $('#kw'); k.focus(); k.setSelectionRange(k.value.length, k.value.length); }); }, 300); };
  $('#btnAdd').onclick = () => empForm(null);
  $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => empForm(T.employees.find((e) => e.id === Number(tr.dataset.id)))));
}

async function resizeImage(file, maxSide, quality = 0.85) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', quality));
}
async function loadImg(fileId, aad, el) {
  if (!fileId) return;
  try {
    let blob = await api('GET', '/admin/files/' + fileId, { token: T.token, blob: true });
    if (aad) {
      if (!V.isUnlocked()) { el.innerHTML = '🔒 Đã mã hoá<br>Mở két để xem'; return; }
      blob = new Blob([await V.decBytes(await blob.arrayBuffer(), aad)], { type: 'image/jpeg' });
    }
    el.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="">`;
  } catch { el.textContent = 'Không tải được ảnh'; }
}

async function empForm(e) {
  const isNew = !e;
  const unlocked = V.isUnlocked();
  const sens = { bank: '', cccd: '' };
  if (!isNew && unlocked) { sens.bank = await V.decStr(e.bank_account_enc, V.AAD.emp(e.id, 'bank_account')); sens.cccd = await V.decStr(e.cccd_number_enc, V.AAD.emp(e.id, 'cccd_number')); }
  const lockedInput = (name, val, ph) => unlocked
    ? `<input name="${name}" value="${esc(val)}" placeholder="${ph}" autocomplete="off">`
    : `<input disabled value="${e && e[name + '_enc'] ? '•••••••• (đã mã hoá)' : ''}" placeholder="🔒 Mở két để nhập">`;
  const role = (id) => T.roles.filter((r) => r.active || r.id === id).map((r) => `<option value="${r.id}" ${r.id === id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  modal(`<div class="row between"><h2>${isNew ? 'Thêm nhân sự' : esc(e.code) + ' — ' + esc(e.full_name)}</h2>${unlocked ? '<span class="badge ok">🔓 két mở</span>' : '<button class="btn small" id="btnUnlock">🔒 Mở két</button>'}</div>
    <form id="f">
      <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div><div class="photo-box" id="phPhoto">${isNew ? 'Ảnh chân dung' : (e.photo_file_id ? '<span class="spinner"></span>' : 'Chưa có ảnh')}</div>
          ${isNew ? '<p class="small muted">Lưu trước, rồi tải ảnh</p>' : '<label class="btn small block" style="margin-top:6px">Tải ảnh<input type="file" accept="image/*" id="upPhoto" hidden></label>'}</div>
        <div style="flex:1;min-width:260px"><div class="form-grid">
          <label class="field"><span>Mã NV (ID) ${isNew ? '— để trống tự sinh' : ''}</span><input name="code" value="${esc(e?.code || '')}" placeholder="VPA0001"></label>
          <label class="field"><span>Họ và tên *</span><input name="full_name" value="${esc(e?.full_name || '')}" required></label>
          <label class="field"><span>Hình thức</span><select name="employment_type">${Object.entries(EMP_TYPE).map(([k, n]) => `<option value="${k}" ${e?.employment_type === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field"><span>Vai trò chính</span><select name="main_role_id"><option value="">—</option>${role(e?.main_role_id)}</select></label>
          <label class="field"><span>Số điện thoại</span><input name="phone" value="${esc(e?.phone || '')}" inputmode="tel"></label>
          <label class="field"><span>Ngày sinh</span><input type="date" name="date_of_birth" value="${e?.date_of_birth || ''}"></label>
          <label class="field"><span>Ngân hàng</span><input name="bank_name" value="${esc(e?.bank_name || '')}" list="banks"></label>
          <label class="field"><span>Số tài khoản 🔒</span>${lockedInput('bank_account', sens.bank, 'Số tài khoản')}</label>
          <label class="field"><span>Số CCCD 🔒</span>${lockedInput('cccd_number', sens.cccd, '12 số')}</label>
          <label class="field"><span>Ngày vào làm</span><input type="date" name="start_date" value="${e?.start_date || ''}"></label>
          <label class="field"><span>Ngày nghỉ việc</span><input type="date" name="end_date" value="${e?.end_date || ''}"></label>
          <label class="field"><span>Trạng thái</span><select name="status"><option value="active">Đang làm</option><option value="inactive" ${e?.status === 'inactive' ? 'selected' : ''}>Nghỉ việc (khoá đăng nhập)</option></select></label>
          ${isNew ? '<label class="field"><span>Mật khẩu ban đầu * (≥ 6 ký tự)</span><input name="password" required minlength="6" autocomplete="off"></label>' : ''}
        </div>
        <label class="field"><span>Ghi chú</span><input name="note" value="${esc(e?.note || '')}"></label></div>
      </div>
      ${isNew ? '' : `<h3>Ảnh CCCD 🔒 <span class="muted small">(mã hoá trên trình duyệt trước khi tải lên)</span></h3>
      <div class="row" style="gap:16px;flex-wrap:wrap;margin-bottom:12px">
        ${['cccd_front', 'cccd_back'].map((k) => `<div><div class="photo-box cccd-box" id="ph_${k}">${e[k + '_file_id'] ? '<span class="spinner"></span>' : (k === 'cccd_front' ? 'Mặt trước' : 'Mặt sau')}</div>
          <label class="btn small block" style="margin-top:6px">${k === 'cccd_front' ? 'Tải mặt trước' : 'Tải mặt sau'}<input type="file" accept="image/*" data-up="${k}" hidden></label></div>`).join('')}
      </div>`}
      <div class="row" style="flex-wrap:wrap"><button class="btn primary" style="flex:1;min-width:160px">${isNew ? 'Tạo nhân sự' : 'Lưu thay đổi'}</button><button class="btn" type="button" data-close>Đóng</button></div>
    </form>
    <datalist id="banks">${['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'VPBank', 'TPBank', 'Sacombank', 'VIB', 'SHB', 'HDBank', 'OCB', 'SeABank', 'LPBank'].map((b) => `<option value="${b}">`).join('')}</datalist>
    ${isNew ? '' : `<hr style="border:0;border-top:1px solid var(--line);margin:18px 0"><h3>Lương 🔒</h3><div id="salBox"></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0"><h3>Tài khoản & thiết bị</h3>
    <p class="small muted">Thiết bị: ${e.device_bound ? `đã gắn ${fmtDateTime(e.device_bound_at)} — <span title="${esc(e.device_info || '')}">${esc((e.device_info || '').slice(0, 60))}…</span>` : 'chưa gắn'}${e.must_change_password ? ' · <span class="badge warn">chưa đổi MK lần đầu</span>' : ''}</p>
    <div class="row" style="flex-wrap:wrap"><button class="btn" id="btnResetPw">Đặt lại mật khẩu</button><button class="btn" id="btnResetDev">Đặt lại thiết bị</button><button class="btn danger" id="btnDel">Xoá nhân sự</button></div>`}`,
  { wide: true, onMount: (m, close) => {
    const reopen = async () => { close(); T.employees = await A('GET', '/employees'); const x = T.employees.find((y) => y.id === e.id); empForm(x); if (T.tab === 'emp') go('emp'); };
    $('#btnUnlock', m) && ($('#btnUnlock', m).onclick = async () => { if (await ensureUnlocked()) { close(); empForm(e); } });
    $('#f', m).onsubmit = async (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      const body = { ...f };
      delete body.bank_account; delete body.cccd_number;
      const bank = (f.bank_account || '').replace(/\s/g, ''), cccd = (f.cccd_number || '').replace(/\s/g, '');
      if (unlocked && cccd && !/^\d{12}$/.test(cccd)) return toast('Số CCCD phải gồm 12 chữ số', 'err');
      if (isNew && !body.code) delete body.code;
      // Mã hoá gắn với id NV → NV mới: tạo trước, rồi mới ghi trường mã hoá
      const encFields = async (id) => {
        const o = {};
        if (!unlocked) return o;
        if (isNew ? bank : bank !== sens.bank) o.bank_account_enc = bank ? await V.encStr(bank, V.AAD.emp(id, 'bank_account')) : null;
        if (isNew ? cccd : cccd !== sens.cccd) o.cccd_number_enc = cccd ? await V.encStr(cccd, V.AAD.emp(id, 'cccd_number')) : null;
        return o;
      };
      try {
        let id;
        if (isNew) {
          const r = await A('POST', '/employees', { body });
          id = r.id;
          const enc = await encFields(id);
          if (Object.keys(enc).length) await A('PUT', '/employees/' + id, { body: enc });
          toast(`Đã tạo ${r.code}`, 'ok');
        } else {
          id = e.id;
          await A('PUT', '/employees/' + id, { body: { ...body, ...(await encFields(id)) } });
          toast('Đã lưu', 'ok');
        }
        close();
        T.employees = await A('GET', '/employees'); go('emp');
        if (isNew) empForm(T.employees.find((y) => y.id === id));
      } catch (err) { fail(err); }
    };
    if (isNew) return;
    loadImg(e.photo_file_id, null, $('#phPhoto', m));
    loadImg(e.cccd_front_file_id, V.AAD.emp(e.id, 'cccd_front'), $('#ph_cccd_front', m));
    loadImg(e.cccd_back_file_id, V.AAD.emp(e.id, 'cccd_back'), $('#ph_cccd_back', m));
    $('#upPhoto', m).onchange = async (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      try { const blob = await resizeImage(file, 600); await A('POST', `/employees/${e.id}/files/photo`, { raw: blob, headers: { 'Content-Type': 'image/jpeg' } }); toast('Đã tải ảnh', 'ok'); reopen(); }
      catch (err) { fail(err); }
    };
    $$('[data-up]', m).forEach((inp) => (inp.onchange = async (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      if (!(await ensureUnlocked())) return;
      try {
        const blob = await resizeImage(file, 1600, 0.88);
        const encd = await V.encBytes(new Uint8Array(await blob.arrayBuffer()), V.AAD.emp(e.id, inp.dataset.up));
        await A('POST', `/employees/${e.id}/files/${inp.dataset.up}`, { raw: encd, headers: { 'Content-Type': 'application/octet-stream', 'X-Encrypted': '1' } });
        toast('Đã mã hoá & tải ảnh CCCD', 'ok'); reopen();
      } catch (err) { fail(err); }
    }));
    $('#btnResetPw', m).onclick = async () => {
      const p = prompt('Mật khẩu mới cho ' + e.full_name + ' (≥ 6 ký tự). NV sẽ phải đổi lại khi đăng nhập:');
      if (!p) return;
      try { await A('POST', `/employees/${e.id}/reset-password`, { body: { password: p } }); toast('Đã đặt lại mật khẩu', 'ok'); } catch (err) { fail(err); }
    };
    $('#btnResetDev', m).onclick = async () => {
      if (!confirm('Gỡ thiết bị hiện tại? NV sẽ bị đăng xuất và lần đăng nhập tiếp theo sẽ gắn thiết bị mới.')) return;
      try { await A('POST', `/employees/${e.id}/reset-device`); toast('Đã đặt lại thiết bị', 'ok'); reopen(); } catch (err) { fail(err); }
    };
    $('#btnDel', m).onclick = async () => {
      if (!confirm(`Xoá vĩnh viễn ${e.full_name}? (Chỉ xoá được khi chưa có dữ liệu chấm công)`)) return;
      try { await A('DELETE', '/employees/' + e.id); toast('Đã xoá', 'ok'); close(); go('emp'); } catch (err) { fail(err); }
    };
    renderSalaries($('#salBox', m), e);
  } });
}
async function renderSalaries(box, e) {
  const list = await A('GET', `/employees/${e.id}/salaries`);
  const unlocked = V.isUnlocked();
  const rows = await Promise.all(list.map(async (s) => ({ ...s, amount: unlocked ? await V.decStr(s.amount_enc, V.AAD.sal(e.id, 'amount')) : null, note: unlocked ? await V.decStr(s.note_enc, V.AAD.sal(e.id, 'note')) : null })));
  const today = vnToday();
  const current = rows.find((s) => s.effective_from <= today);
  box.innerHTML = `${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Hiệu lực từ</th><th>Loại lương</th><th class="num">Số tiền (VND)</th><th>Ghi chú</th><th></th></tr></thead><tbody>
    ${rows.map((s) => `<tr><td>${fmtDate(s.effective_from)} ${s === current ? '<span class="badge ok">hiện hành</span>' : ''}</td><td>${SALARY_TYPE[s.salary_type]}</td>
      <td class="num">${unlocked ? esc(Number(s.amount).toLocaleString('vi-VN')) + (s.salary_type === 'hourly' ? ' /giờ' : ' /tháng') : '🔒'}</td><td>${unlocked ? esc(s.note || '') : '🔒'}</td>
      <td><button class="btn small danger" data-sdel="${s.id}">Xoá</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Chưa có thông tin lương.</p>'}
    ${unlocked ? `<form id="fSal" class="toolbar" style="margin-top:10px">
      <label class="field"><span>Loại lương</span><select name="salary_type"><option value="hourly">Khoán theo giờ</option><option value="contract">Theo hợp đồng (tháng)</option></select></label>
      <label class="field"><span>Số tiền (VND)</span><input name="amount" inputmode="numeric" required placeholder="VD: 45000"></label>
      <label class="field"><span>Hiệu lực từ</span><input type="date" name="effective_from" value="${today}" required></label>
      <label class="field" style="flex:1"><span>Ghi chú</span><input name="note"></label>
      <button class="btn primary">+ Thêm mức lương</button></form>` : '<p class="small muted">Mở két để xem / thêm lương.</p>'}`;
  $$('[data-sdel]', box).forEach((b) => (b.onclick = async () => {
    if (!confirm('Xoá mức lương này?')) return;
    try { await A('DELETE', '/salaries/' + b.dataset.sdel); renderSalaries(box, e); } catch (err) { fail(err); }
  }));
  const f = $('#fSal', box);
  if (f) f.onsubmit = async (ev) => {
    ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target));
    const amount = Number(String(d.amount).replace(/[.,\s]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return toast('Số tiền không hợp lệ', 'err');
    try {
      await A('POST', `/employees/${e.id}/salaries`, { body: { salary_type: d.salary_type, effective_from: d.effective_from,
        amount_enc: await V.encStr(String(amount), V.AAD.sal(e.id, 'amount')), note_enc: d.note ? await V.encStr(d.note, V.AAD.sal(e.id, 'note')) : null } });
      toast('Đã thêm mức lương', 'ok'); renderSalaries(box, e);
    } catch (err) { fail(err); }
  };
}

// ---------------- SITE ----------------
async function viewSites(v) {
  T.sites = await A('GET', '/sites');
  v.innerHTML = `<h2>Vị trí / Site khách hàng</h2>
    <div class="toolbar"><button class="btn primary" id="btnAdd">+ Thêm vị trí</button></div>
    <div class="table-wrap"><table><thead><tr><th>Tên vị trí</th><th>Khách hàng</th><th>Địa chỉ</th><th>Toạ độ</th><th class="num">Bán kính</th><th>Trạng thái</th></tr></thead><tbody>
    ${T.sites.map((s) => `<tr data-id="${s.id}" style="cursor:pointer"><td><b>${esc(s.name)}</b></td><td>${esc(s.customer_name || '')}</td><td>${esc(s.address || '')}</td>
      <td>${s.lat != null ? `<a href="${mapsLink(s.lat, s.lng)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</a>` : '<span class="badge warn">chưa có</span>'}</td>
      <td class="num">${s.radius_m} m</td><td>${s.active ? '<span class="badge ok">Đang dùng</span>' : '<span class="badge">Ngưng</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có vị trí nào — NV sẽ không check-in được.</td></tr>'}
    </tbody></table></div>`;
  $('#btnAdd').onclick = () => siteForm(null);
  $$('tr[data-id]', v).forEach((tr) => (tr.onclick = () => siteForm(T.sites.find((s) => s.id === Number(tr.dataset.id)))));
}
function siteForm(s) {
  modal(`<h2>${s ? 'Sửa vị trí' : 'Thêm vị trí'}</h2>
    <form id="f"><label class="field"><span>Tên vị trí *</span><input name="name" value="${esc(s?.name || '')}" required placeholder="VD: LGD Hải Phòng — Nhà xưởng A"></label>
    <label class="field"><span>Khách hàng</span><input name="customer_name" value="${esc(s?.customer_name || '')}"></label>
    <label class="field"><span>Địa chỉ</span><input name="address" value="${esc(s?.address || '')}"></label>
    <label class="field"><span>Toạ độ "vĩ độ, kinh độ" — Google Maps: nhấn giữ vào vị trí → copy số</span>
      <input name="coords" value="${s?.lat != null ? `${s.lat}, ${s.lng}` : ''}" placeholder="20.85123, 106.68012"></label>
    <div class="row" style="margin:-4px 0 12px"><button class="btn small" type="button" id="btnHere">Dùng vị trí hiện tại của tôi</button></div>
    <div class="form-grid"><label class="field"><span>Bán kính hợp lệ (m)</span><input name="radius_m" type="number" min="50" max="5000" value="${s?.radius_m || 300}"></label>
    <label class="field"><span>Trạng thái</span><select name="active"><option value="1">Đang dùng</option><option value="" ${s && !s.active ? 'selected' : ''}>Ngưng</option></select></label></div>
    <div class="row"><button class="btn primary" style="flex:1">Lưu</button><button class="btn" type="button" data-close>Huỷ</button></div></form>`,
  { onMount: (m, close) => {
    $('#btnHere', m).onclick = () => navigator.geolocation.getCurrentPosition(
      (p) => { $('[name=coords]', m).value = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`; toast(`Sai số ±${Math.round(p.coords.accuracy)} m`); },
      () => toast('Không lấy được vị trí', 'err'), { enableHighAccuracy: true, timeout: 20000 });
    $('#f', m).onsubmit = async (ev) => {
      ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target));
      let lat = null, lng = null;
      if (d.coords.trim()) {
        const mm = d.coords.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
        if (!mm) return toast('Toạ độ không đúng dạng "vĩ độ, kinh độ"', 'err');
        lat = Number(mm[1]); lng = Number(mm[2]);
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return toast('Toạ độ ngoài phạm vi', 'err');
      }
      const body = { name: d.name, customer_name: d.customer_name, address: d.address, lat, lng, radius_m: Number(d.radius_m), active: !!d.active };
      try { await A(s ? 'PUT' : 'POST', s ? '/sites/' + s.id : '/sites', { body }); toast('Đã lưu', 'ok'); close(); go('sites'); }
      catch (e) { fail(e); }
    };
  } });
}

// ---------------- BÁO CÁO EXCEL ----------------
async function viewReport(v) {
  const today = vnToday();
  const [y, mo] = today.split('-').map(Number);
  const prevFrom = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 10);
  const prevTo = new Date(Date.UTC(y, mo - 1, 0)).toISOString().slice(0, 10);
  v.innerHTML = `<h2>Báo cáo Excel</h2>
    <div class="card"><form id="f" class="toolbar" style="margin:0">
      <label class="field"><span>Từ ngày</span><input type="date" name="from" value="${monthStart()}" required></label>
      <label class="field"><span>Đến ngày</span><input type="date" name="to" value="${today}" required></label>
      <button class="btn small" type="button" id="prevM">Tháng trước</button>
      <button class="btn primary" type="submit">Xuất Excel</button></form>
      <p class="small muted" style="margin:12px 0 0">File gồm: <b>Tổng hợp</b> theo NV · <b>Chi tiết</b> từng ca (giờ mở app, giờ mặc định, giờ chốt, GPS) · <b>Lịch sử sửa</b> · <b>Quy tắc tính</b>.
      ${V.isUnlocked() ? '<br>🔓 Két đang mở → file có thêm <b>loại lương, mức lương, ngân hàng, STK</b>.' : '<br>🔒 Két đang khoá → file <b>không</b> có thông tin lương/STK. Mở két trước nếu cần.'}</p></div>`;
  $('#prevM').onclick = () => { $('[name=from]').value = prevFrom; $('[name=to]').value = prevTo; };
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target));
    const btn = ev.submitter; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Đang tạo…';
    try { await exportExcel(d.from, d.to); } catch (e) { fail(e); }
    btn.disabled = false; btn.textContent = 'Xuất Excel';
  };
}
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = '../vendor/exceljs.min.js'; s.onload = res; s.onerror = () => rej(new Error('Không tải được thư viện Excel')); document.head.appendChild(s); });
}
async function exportExcel(from, to) {
  const [data] = await Promise.all([A('GET', `/report?from=${from}&to=${to}`), loadExcelJS()]);
  const S = data.settings;
  const unlocked = V.isUnlocked();
  const wb = new window.ExcelJS.Workbook();
  wb.creator = 'VPA Chấm công'; wb.created = new Date();
  const FONT = 'Arial';
  const headerStyle = (row) => row.eachCell((c) => {
    c.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4F9C' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
  const title = (ws, t, cols) => {
    ws.mergeCells(1, 1, 1, cols); ws.getCell(1, 1).value = (S.company_name || 'CÔNG TY TNHH VPA AUTOMATION');
    ws.getCell(1, 1).font = { name: FONT, bold: true, size: 12 };
    ws.mergeCells(2, 1, 2, cols); ws.getCell(2, 1).value = `${t} — từ ${fmtDate(from)} đến ${fmtDate(to)}`;
    ws.getCell(2, 1).font = { name: FONT, bold: true, size: 14, color: { argb: 'FF0B4F9C' } };
    ws.mergeCells(3, 1, 3, cols); ws.getCell(3, 1).value = `Xuất lúc ${fmtDateTime(Date.now())}`;
    ws.getCell(3, 1).font = { name: FONT, italic: true, size: 9, color: { argb: 'FF666666' } };
  };
  const table = (ws, startRow, cols, rows) => {
    const hr = ws.getRow(startRow); cols.forEach((c, i) => { hr.getCell(i + 1).value = c.h; ws.getColumn(i + 1).width = c.w || 12; });
    hr.height = 32; headerStyle(hr);
    rows.forEach((r, ri) => {
      const row = ws.getRow(startRow + 1 + ri);
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1); cell.value = r[i];
        cell.font = { name: FONT, size: 10 };
        if (c.fmt) cell.numFmt = c.fmt;
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } } };
        if (c.link && r[i]) { cell.value = { text: 'Bản đồ', hyperlink: r[i] }; cell.font = { name: FONT, size: 10, color: { argb: 'FF0B4F9C' }, underline: true }; }
      });
    });
    ws.views = [{ state: 'frozen', ySplit: startRow, xSplit: 0 }];
    ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + rows.length, column: cols.length } };
  };
  // Giờ VN dạng ngày Excel (không múi giờ)
  const xl = (v) => (v == null ? null : new Date(ms(v) + 7 * 3600e3));
  const xd = (s) => (s ? new Date(s + 'T00:00:00Z') : null);
  const recs = data.records;
  const empIds = [...new Set(recs.map((r) => r.employee_id))];

  // --- Sheet Tổng hợp ---
  const sal = new Map(data.salaries.map((s) => [s.employee_id, s]));
  const sumRows = [];
  for (const [i, id] of empIds.entries()) {
    const e = data.employees.find((x) => x.id === id) || {};
    const rs = recs.filter((r) => r.employee_id === id);
    const sum = (f, t) => rs.filter((r) => !t || r.hours.day_type === t).reduce((a, r) => a + (r.hours[f] || 0), 0);
    const row = [i + 1, e.code, e.full_name, EMP_TYPE[e.employment_type] || '', e.main_role || '',
      new Set(rs.filter((r) => r.out_time).map((r) => r.work_date)).size, rs.filter((r) => r.out_time).length,
      sum('worked_h'), sum('normal_h', 'weekday'), sum('ot_h', 'weekday'), sum('worked_h', 'sunday'), sum('worked_h', 'holiday'), sum('night_h'),
      rs.filter((r) => r.in_edited || r.out_edited).length, rs.filter((r) => r.source === 'app' && (!r.in_time_verified || (r.out_time && !r.out_time_verified))).length, rs.filter((r) => !r.out_time).length];
    if (unlocked) {
      const s = sal.get(id);
      row.push(s ? SALARY_TYPE[s.salary_type] : '', s ? Number(await V.decStr(s.amount_enc, V.AAD.sal(id, 'amount'))) : null, e.bank_name || '', e.bank_account_enc ? await V.decStr(e.bank_account_enc, V.AAD.emp(id, 'bank_account')) : '');
    }
    sumRows.push(row);
  }
  const H = '#,##0.00';
  const sumCols = [{ h: 'STT', w: 5 }, { h: 'Mã NV', w: 10 }, { h: 'Họ và tên', w: 24 }, { h: 'Hình thức', w: 12 }, { h: 'Vai trò chính', w: 16 },
    { h: 'Số ngày công', w: 9 }, { h: 'Số ca', w: 7 }, { h: 'Tổng giờ công', w: 10, fmt: H }, { h: 'Giờ chuẩn ngày thường', w: 11, fmt: H },
    { h: 'OT ngày thường', w: 10, fmt: H }, { h: 'Giờ Chủ nhật', w: 10, fmt: H }, { h: 'Giờ ngày lễ', w: 10, fmt: H }, { h: `Giờ đêm (${S.night_start}–${S.night_end})`, w: 11, fmt: H },
    { h: 'Số ca có sửa giờ', w: 9 }, { h: 'Số ca giờ máy (chưa xác thực)', w: 11 }, { h: 'Số ca chưa check-out', w: 10 }];
  if (unlocked) sumCols.push({ h: `Loại lương (hiệu lực ${fmtDate(to)})`, w: 16 }, { h: 'Mức lương (VND)', w: 14, fmt: '#,##0' }, { h: 'Ngân hàng', w: 14 }, { h: 'Số tài khoản', w: 18 });
  const ws1 = wb.addWorksheet('Tổng hợp');
  title(ws1, 'BẢNG TỔNG HỢP CÔNG', sumCols.length);
  table(ws1, 5, sumCols, sumRows);
  if (sumRows.length) {
    const tr = ws1.getRow(6 + sumRows.length); tr.getCell(3).value = 'TỔNG CỘNG';
    for (let c = 6; c <= 16; c++) { const L = ws1.getColumn(c).letter; tr.getCell(c).value = { formula: `SUM(${L}6:${L}${5 + sumRows.length})` }; tr.getCell(c).numFmt = c >= 8 && c <= 13 ? H : '0'; }
    tr.eachCell((c) => { c.font = { name: FONT, bold: true }; c.border = { top: { style: 'thin' } }; });
  }

  // --- Sheet Chi tiết ---
  const T2 = 'dd/mm/yyyy hh:mm';
  const detCols = [{ h: 'Ngày công', w: 11, fmt: 'dd/mm/yyyy' }, { h: 'Thứ', w: 5 }, { h: 'Loại ngày', w: 10 }, { h: 'Mã NV', w: 9 }, { h: 'Họ và tên', w: 22 },
    { h: 'Vị trí', w: 22 }, { h: 'Khách hàng', w: 16 },
    { h: 'Mở app (vào)', w: 15, fmt: T2 }, { h: 'Mặc định vào (làm tròn lên)', w: 15, fmt: T2 }, { h: 'GIỜ VÀO chốt', w: 15, fmt: T2 }, { h: 'Sửa giờ vào', w: 7 },
    { h: 'Mở app (ra)', w: 15, fmt: T2 }, { h: 'Mặc định ra (làm tròn xuống)', w: 15, fmt: T2 }, { h: 'GIỜ RA chốt', w: 15, fmt: T2 }, { h: 'Sửa giờ ra', w: 7 },
    { h: 'Khoảng ca (h)', w: 8, fmt: H }, { h: 'Trừ nghỉ (h)', w: 8, fmt: H }, { h: 'Giờ công', w: 8, fmt: H }, { h: 'Giờ chuẩn', w: 8, fmt: H }, { h: 'OT', w: 7, fmt: H }, { h: 'Giờ đêm', w: 7, fmt: H },
    { h: 'GPS vào', w: 9, link: true }, { h: 'Vĩ độ vào', w: 10 }, { h: 'Kinh độ vào', w: 10 }, { h: 'Sai số vào (m)', w: 8 }, { h: 'Cách site vào (m)', w: 9 },
    { h: 'GPS ra', w: 9, link: true }, { h: 'Vĩ độ ra', w: 10 }, { h: 'Kinh độ ra', w: 10 }, { h: 'Sai số ra (m)', w: 8 }, { h: 'Cách site ra (m)', w: 9 },
    { h: 'Giờ vào xác thực', w: 9 }, { h: 'Lệch giờ máy vào (phút)', w: 9 }, { h: 'Giờ ra xác thực', w: 9 }, { h: 'Lệch giờ máy ra (phút)', w: 9 },
    { h: 'Nguồn', w: 8 }, { h: 'Ghi chú', w: 24 }];
  const yn = (b) => (b ? 'Có' : '');
  const detRows = [...recs].sort((a, b) => (a.employee_code + a.in_time).localeCompare(b.employee_code + b.in_time)).map((r) => [
    xd(r.work_date), weekday(r.work_date), DAY_TYPE[r.hours.day_type], r.employee_code, r.employee_name, r.site_name || '', r.customer_name || '',
    xl(r.in_opened_at), xl(r.in_default_at), xl(r.in_time), yn(r.in_edited),
    xl(r.out_opened_at), xl(r.out_default_at), xl(r.out_time), yn(r.out_edited),
    r.hours.span_h ?? null, r.hours.break_h ?? null, r.hours.worked_h ?? null, r.hours.normal_h ?? null, r.hours.ot_h ?? null, r.hours.night_h ?? null,
    mapsLink(r.in_lat, r.in_lng), r.in_lat, r.in_lng, r.in_accuracy_m, r.in_distance_m,
    mapsLink(r.out_lat, r.out_lng), r.out_lat, r.out_lng, r.out_accuracy_m, r.out_distance_m,
    r.source === 'admin' ? '' : (r.in_time_verified ? 'Server' : 'GIỜ MÁY'), r.in_clock_skew_s == null ? null : Math.round(r.in_clock_skew_s / 60),
    r.source === 'admin' || !r.out_time ? '' : (r.out_time_verified ? 'Server' : 'GIỜ MÁY'), r.out_clock_skew_s == null ? null : Math.round(r.out_clock_skew_s / 60),
    r.source === 'admin' ? 'QL nhập' : 'App', r.note || '']);
  const ws2 = wb.addWorksheet('Chi tiết');
  title(ws2, 'CHI TIẾT CHẤM CÔNG', detCols.length);
  table(ws2, 5, detCols, detRows);

  // --- Sheet Lịch sử sửa ---
  const ws3 = wb.addWorksheet('Lịch sử sửa');
  const editCols = [{ h: 'Thời điểm sửa', w: 16, fmt: T2 }, { h: 'Ngày công', w: 11, fmt: 'dd/mm/yyyy' }, { h: 'Mã NV', w: 9 }, { h: 'Họ và tên', w: 22 },
    { h: 'Người sửa', w: 10 }, { h: 'Khi', w: 10 }, { h: 'Trường', w: 10 }, { h: 'Giá trị cũ', w: 18 }, { h: 'Giá trị mới', w: 18 }, { h: 'Lý do', w: 30 }];
  const ev = (f, v) => (v == null ? '' : f.endsWith('_time') ? fmtDateTime(v) : f === 'site_id' ? (T.sites.find((s) => s.id === Number(v))?.name || v) : v);
  table(ws3, 5, editCols, data.edits.map((x) => [xl(x.edited_at), xd(x.work_date), x.employee_code, x.employee_name, x.edited_by_type === 'admin' ? 'Admin' : 'Nhân viên',
    x.stage === 'at_submit' ? 'Lúc chấm' : 'Sửa sau', FIELD[x.field], ev(x.field, x.old_value), ev(x.field, x.new_value), x.reason || '']));
  title(ws3, 'LỊCH SỬ SỬA GIỜ', editCols.length);

  // --- Sheet Quy tắc ---
  const ws4 = wb.addWorksheet('Quy tắc tính');
  const rules = [
    ['Giờ mặc định check-in', `Giờ mở app, làm tròn LÊN bội số ${S.rounding_minutes} phút`],
    ['Giờ mặc định check-out', `Giờ mở app, làm tròn XUỐNG bội số ${S.rounding_minutes} phút`],
    ['Giờ chốt', 'Mặc định, hoặc giờ NV/Admin sửa (mọi lần sửa ghi ở sheet "Lịch sử sửa")'],
    ['Trừ nghỉ giữa ca', `${S.break_minutes} phút nếu khoảng ca ≥ ${S.break_min_span_hours} giờ`],
    ['Giờ chuẩn / ngày', `${S.standard_hours} giờ — phần vượt tính là OT (ngày thường)`],
    ['Chủ nhật / Ngày lễ', 'Toàn bộ giờ công ghi riêng ở cột Giờ Chủ nhật / Giờ ngày lễ'],
    ['Giờ đêm', `Phần giờ nằm trong ${S.night_start}–${S.night_end}`],
    ['Ngày công của ca qua đêm', 'Tính về ngày (giờ VN) của giờ vào'],
    ['Căn cứ ngày lễ', S.holiday_auto ? `Tự tính theo BLLĐ 2019 Điều 112 (Tết nghỉ ${S.tet_days_before} ngày trước mùng 1; Quốc khánh thêm ${S.qk_extra === 'after' ? '03/9' : '01/9'}${S.holiday_comp ? '; có nghỉ bù khi trùng Chủ nhật' : ''}) + ngày bổ sung` : 'Chỉ ngày bổ sung do Admin nhập'],
    ['Ngày lễ trong kỳ', (data.holidays || []).map((h) => `${fmtDate(h.date)} ${h.name}`).join('; ') || '(không có)'],
    ['Giờ xác thực', '"Server" = giờ mở app do máy chủ ký xác nhận. "GIỜ MÁY" = chấm khi offline, giờ lấy từ đồng hồ điện thoại → CẦN ĐỐI CHIẾU (NV có thể chỉnh đồng hồ máy)'],
    ['Lệch giờ máy', 'Giờ server − giờ điện thoại lúc gửi (phút). Lệch lớn = đồng hồ máy sai/bị chỉnh'],
    ['Lưu ý', 'Hệ số lương OT/đêm/CN/lễ chưa áp dụng trong file — tính theo quy chế lương & Bộ luật Lao động hiện hành'],
  ];
  title(ws4, 'QUY TẮC TÍNH GIỜ CÔNG', 2);
  table(ws4, 5, [{ h: 'Hạng mục', w: 28 }, { h: 'Quy tắc', w: 90 }], rules);

  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `VPA_ChamCong_${from}_${to}${unlocked ? '_CoLuong' : ''}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  toast(`Đã xuất ${recs.length} ca, ${empIds.length} nhân sự`, 'ok');
  window.__lastExport = { from, to, records: recs.length, employees: empIds.length };
}

// ---------------- CÀI ĐẶT ----------------
async function viewSettings(v) {
  const s = await A('GET', '/settings');
  T.roles = await A('GET', '/job-roles');
  v.innerHTML = `<h2>Cài đặt</h2>
    <div class="card"><h3>Quy tắc giờ công</h3><form id="fRules"><div class="form-grid">
      <label class="field"><span>Bước làm tròn (phút)</span><input type="number" name="rounding_minutes" value="${s.rounding_minutes}" min="1" max="60"></label>
      <label class="field"><span>Giờ chuẩn / ngày</span><input type="number" step="0.5" name="standard_hours" value="${s.standard_hours}"></label>
      <label class="field"><span>Trừ nghỉ giữa ca (phút)</span><input type="number" name="break_minutes" value="${s.break_minutes}"></label>
      <label class="field"><span>… nếu ca dài ≥ (giờ)</span><input type="number" step="0.5" name="break_min_span_hours" value="${s.break_min_span_hours}"></label>
      <label class="field"><span>Giờ đêm bắt đầu</span><input type="time" name="night_start" value="${s.night_start}"></label>
      <label class="field"><span>Giờ đêm kết thúc</span><input type="time" name="night_end" value="${s.night_end}"></label>
      <label class="field"><span>Cảnh báo sai số GPS &gt; (m)</span><input type="number" name="gps_warn_accuracy_m" value="${s.gps_warn_accuracy_m}"></label>
      <label class="field"><span>Tên công ty (tiêu đề báo cáo)</span><input name="company_name" value="${esc(s.company_name)}"></label></div>
      <button class="btn primary">Lưu quy tắc</button></form></div>
    <div class="card"><h3>Ngày nghỉ lễ, Tết — Việt Nam</h3>
      <p class="small muted" style="margin-top:0">Tự tính theo <b>Bộ luật Lao động 2019, Điều 112</b> + lịch âm (Tết, Giỗ Tổ) + nghỉ bù khi trùng Chủ nhật.
      Hằng năm đối chiếu thông báo lịch nghỉ của Nhà nước: ngày công ty cho nghỉ thêm → nhập <b>Ngày nghỉ bổ sung</b>; ngày không áp dụng → bỏ tích ở bảng.</p>
      <form id="fHol"><div class="form-grid">
        <label class="field"><span>Tự tính ngày lễ VN</span><select name="holiday_auto"><option value="1">Bật</option><option value="" ${s.holiday_auto ? '' : 'selected'}>Tắt</option></select></label>
        <label class="field"><span>Tết Âm lịch (5 ngày) — nghỉ trước mùng 1</span><select name="tet_days_before">
          ${[[0, '0 ngày (mùng 1 → mùng 5)'], [1, '1 ngày (30 Tết → mùng 4)'], [2, '2 ngày (29, 30 Tết → mùng 3)']].map(([k, n]) => `<option value="${k}" ${s.tet_days_before === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Quốc khánh — ngày nghỉ thứ 2</span><select name="qk_extra"><option value="before">01/9 (liền trước)</option><option value="after" ${s.qk_extra === 'after' ? 'selected' : ''}>03/9 (liền sau)</option></select></label>
        <label class="field"><span>Nghỉ bù khi lễ trùng Chủ nhật</span><select name="holiday_comp"><option value="1">Bật</option><option value="" ${s.holiday_comp ? '' : 'selected'}>Tắt</option></select></label></div>
        <label class="field"><span>Ngày nghỉ bổ sung (mỗi dòng 1 ngày, dd/mm/yyyy)</span><textarea name="extra" rows="3" placeholder="VD: 21/02/2026">${(s.holidays || []).map(fmtDate).join('\n')}</textarea></label>
        <button class="btn primary">Lưu cài đặt ngày lễ</button></form>
      <div class="toolbar" style="margin:16px 0 8px"><label class="field"><span>Xem năm</span><input type="number" id="holYear" value="${vnToday().slice(0, 4)}" min="2020" max="2100"></label>
        <button class="btn small" type="button" id="holPrev">‹</button><button class="btn small" type="button" id="holNext">›</button></div>
      <div id="holList"><span class="spinner"></span></div></div>
    <div class="card"><h3>Danh mục vai trò chính</h3>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">${T.roles.map((r) => `<span class="badge ${r.active ? '' : 'err'}">${esc(r.name)} <button class="link-btn" data-role="${r.id}" data-act="${r.active ? 0 : 1}" title="${r.active ? 'Ẩn' : 'Hiện'}">${r.active ? '×' : '↺'}</button></span>`).join('')}</div>
      <form id="fRole" class="toolbar" style="margin:0"><label class="field"><span>Thêm vai trò</span><input name="name" required></label><button class="btn">Thêm</button></form></div>
    <div class="card"><h3>Két dữ liệu</h3>
      <p class="small muted">${T.vault ? `Tạo lúc ${fmtDateTime(T.vault.created_at)} · cập nhật ${fmtDateTime(T.vault.updated_at)} · PBKDF2 ${T.vault.iterations.toLocaleString('vi-VN')} vòng` : 'Chưa thiết lập'}</p>
      <div class="row" style="flex-wrap:wrap"><button class="btn" id="vChange" ${T.vault ? '' : 'disabled'}>Đổi mật khẩu két</button><button class="btn" id="vRec" ${T.vault ? '' : 'disabled'}>Xem / tải mã khôi phục</button></div></div>
    <div class="card"><h3>Mật khẩu Admin</h3><form id="fPw" class="toolbar" style="margin:0">
      <label class="field"><span>Mật khẩu hiện tại</span><input type="password" name="old" required autocomplete="current-password"></label>
      <label class="field"><span>Mật khẩu mới (≥ 10 ký tự)</span><input type="password" name="new" minlength="10" required autocomplete="new-password"></label>
      <button class="btn">Đổi mật khẩu</button></form></div>`;
  $('#fRules').onsubmit = async (ev) => {
    ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target));
    try { await A('PUT', '/settings', { body: d }); toast('Đã lưu quy tắc', 'ok'); go('settings'); } catch (e) { fail(e); }
  };
  // --- Ngày lễ ---
  const loadHol = async () => {
    const y = Number($('#holYear').value);
    const box = $('#holList');
    try {
      const [{ list }, cur] = await Promise.all([A('GET', '/holidays?year=' + y), A('GET', '/settings')]);
      box.innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Áp dụng</th><th>Ngày</th><th>Thứ</th><th>Ngày lễ</th><th>Nguồn</th></tr></thead><tbody>
        ${list.map((h) => `<tr style="${h.applied ? '' : 'opacity:.5'}"><td>${h.source === 'auto' ? `<input type="checkbox" data-hol="${h.date}" ${h.applied ? 'checked' : ''} style="width:auto;min-height:auto">` : '✔'}</td>
          <td class="mono">${fmtDate(h.date)}</td><td>${weekday(h.date)}</td><td>${esc(h.name)}</td>
          <td>${h.source === 'auto' ? (h.kind === 'bu' ? '<span class="badge warn">Nghỉ bù</span>' : '<span class="badge">BLLĐ</span>') : '<span class="badge ok">Bổ sung</span>'}</td></tr>`).join('')}
        </tbody></table></div><p class="small muted">${list.filter((h) => h.applied).length} ngày nghỉ có hưởng lương trong năm ${y}.</p>` : '<p class="muted">Không có ngày lễ (tự tính đang tắt).</p>';
      $$('[data-hol]', box).forEach((cb) => (cb.onchange = async () => {
        const removed = new Set(cur.holidays_removed || []);
        if (cb.checked) removed.delete(cb.dataset.hol); else removed.add(cb.dataset.hol);
        try { await A('PUT', '/settings', { body: { holidays_removed: [...removed] } }); loadHol(); } catch (e) { fail(e); }
      }));
    } catch (e) { fail(e); }
  };
  $('#holYear').onchange = loadHol;
  $('#holPrev').onclick = () => { $('#holYear').value = Number($('#holYear').value) - 1; loadHol(); };
  $('#holNext').onclick = () => { $('#holYear').value = Number($('#holYear').value) + 1; loadHol(); };
  loadHol();
  $('#fHol').onsubmit = async (ev) => {
    ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target));
    const extra = [];
    for (const line of d.extra.split(/\n|,/).map((x) => x.trim()).filter(Boolean)) {
      const m = line.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      if (m) extra.push(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(line)) extra.push(line);
      else return toast('Ngày không đúng dạng: ' + line, 'err');
    }
    try {
      await A('PUT', '/settings', { body: { holiday_auto: !!d.holiday_auto, holiday_comp: !!d.holiday_comp, tet_days_before: Number(d.tet_days_before), qk_extra: d.qk_extra, holidays: extra } });
      toast('Đã lưu cài đặt ngày lễ', 'ok'); loadHol();
    } catch (e) { fail(e); }
  };
  $$('[data-role]', v).forEach((b) => (b.onclick = async () => {
    try { await A('PUT', '/job-roles/' + b.dataset.role, { body: { active: b.dataset.act === '1' } }); go('settings'); } catch (e) { fail(e); }
  }));
  $('#fRole').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await A('POST', '/job-roles', { body: { name: new FormData(ev.target).get('name') } }); go('settings'); } catch (e) { fail(e); }
  };
  $('#vChange').onclick = async () => {
    if (!(await ensureUnlocked())) return;
    const p1 = prompt('Mật khẩu két MỚI (≥ 12 ký tự):'); if (!p1) return;
    if (p1.length < 12) return toast('Tối thiểu 12 ký tự', 'err');
    if (prompt('Nhập lại mật khẩu két mới:') !== p1) return toast('Không khớp', 'err');
    const ap = prompt('Xác nhận mật khẩu đăng nhập Admin:'); if (!ap) return;
    try { await A('PUT', '/vault', { body: { ...(await V.rewrap(p1)), admin_password: ap } }); T.vault = await A('GET', '/vault'); toast('Đã đổi mật khẩu két', 'ok'); go('settings'); } catch (e) { fail(e); }
  };
  $('#vRec').onclick = async () => { if (await ensureUnlocked()) showRecovery(V.recoveryCode()); };
  $('#fPw').onsubmit = async (ev) => {
    ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target));
    try { await A('POST', '/change-password', { body: { old_password: d.old, new_password: d.new } }); toast('Đã đổi mật khẩu — đăng nhập lại', 'ok'); logout(); } catch (e) { fail(e); }
  };
}

// ---------------- NHẬT KÝ ----------------
const ACTIONS = { admin_login: 'Admin đăng nhập', employee_create: 'Tạo NV', employee_update: 'Sửa NV', employee_delete: 'Xoá NV', employee_reset_password: 'Đặt lại MK NV',
  employee_reset_device: 'Đặt lại thiết bị', device_bound: 'NV gắn thiết bị', salary_create: 'Thêm lương', salary_delete: 'Xoá lương', file_upload: 'Tải file', file_view: 'Xem ảnh CCCD',
  site_create: 'Tạo vị trí', site_update: 'Sửa vị trí', attendance_edit: 'Admin sửa ca', attendance_create: 'Admin nhập ca', attendance_delete: 'Admin xoá ca',
  report_export: 'Xuất báo cáo', settings_update: 'Sửa cài đặt', vault_create: 'Tạo két', vault_rewrap: 'Đổi MK két', admin_change_password: 'Đổi MK admin' };
async function viewAudit(v) {
  const list = await A('GET', '/audit?limit=500');
  v.innerHTML = `<h2>Nhật ký thao tác (500 gần nhất)</h2><div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Người</th><th>Thao tác</th><th>Đối tượng</th><th>Chi tiết</th><th>IP</th></tr></thead><tbody>
    ${list.map((x) => {
      const who = x.actor_type === 'admin' ? 'Admin' : x.actor_type === 'employee' ? (empName(x.actor_id)?.code || 'NV#' + x.actor_id) : x.actor_type;
      const obj = x.entity === 'employee' ? (empName(Number(x.entity_id))?.code || x.entity_id) : [x.entity, x.entity_id].filter(Boolean).join(' #');
      return `<tr><td>${fmtDateTime(x.at)}</td><td>${esc(who)}</td><td>${esc(ACTIONS[x.action] || x.action)}</td><td>${esc(obj)}</td>
        <td class="small muted" style="white-space:normal;max-width:360px">${esc(x.detail ? JSON.stringify(x.detail).slice(0, 200) : '')}</td><td class="small">${esc(x.ip || '')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

// ---------------- START ----------------
if (T.token) boot(); else renderLogin();
