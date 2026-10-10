// Dùng chung cho app Nhân viên & trang Admin
export const API_URL = (window.VPA_CONFIG && window.VPA_CONFIG.API_URL) || '/api';
const TZ = 7 * 3600e3; // giờ Việt Nam, độc lập múi giờ máy

export class ApiError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
export const isNetworkError = (e) => !(e instanceof ApiError);
// Lỗi tạm thời (mất mạng, máy chủ/Cloudflare lỗi 5xx, quá tải) → giữ lại để gửi lại, KHÔNG huỷ
export const isTransient = (e) => isNetworkError(e) || e.status >= 500 || e.status === 429 || e.status === 408;

export async function api(method, path, { token, body, deviceId, raw, headers = {}, blob } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  if (deviceId) h['X-Device-Id'] = deviceId;
  if (body !== undefined && raw === undefined) h['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let r;
  try {
    r = await fetch(API_URL + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: ctrl.signal, cache: 'no-store' });
  } finally { clearTimeout(timer); }
  if (blob && r.ok) return r.blob();
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = j?.error || {};
    throw new ApiError(r.status, e.code || 'HTTP_' + r.status, e.message || `Lỗi ${r.status}`, e);
  }
  return j;
}

// ---- Thời gian (luôn hiển thị theo giờ VN) ----
export const toVNInput = (ms) => (ms == null ? '' : new Date(ms + TZ).toISOString().slice(0, 16));
export const fromVNInput = (s) => (s ? Date.parse(s + ':00Z') - TZ : null);
export const ms = (v) => (v == null ? null : typeof v === 'number' ? v : Date.parse(v));
export function fmtTime(v) { const t = ms(v); return t == null ? '—' : new Date(t + TZ).toISOString().slice(11, 16); }
export function fmtDate(v) {
  const t = typeof v === 'string' && v.length === 10 ? Date.parse(v + 'T00:00:00Z') : ms(v) + TZ;
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}
export function fmtDateTime(v) { const t = ms(v); return t == null ? '—' : `${fmtTime(t)} ${fmtDate(t)}`; }
export const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const weekday = (dateStr) => WEEKDAYS[new Date(dateStr + 'T00:00:00Z').getUTCDay()];
export const vnToday = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);
export const truncMinute = (t) => Math.floor(t / 60e3) * 60e3;
export const roundUp = (t, step) => Math.ceil(truncMinute(t) / (step * 60e3)) * step * 60e3;
export const roundDown = (t, step) => Math.floor(truncMinute(t) / (step * 60e3)) * step * 60e3;
export const fmtH = (h) => (h == null ? '—' : (Math.round(h * 100) / 100).toLocaleString('vi-VN'));

export const DAY_TYPE = { weekday: 'Ngày thường', sunday: 'Chủ nhật', holiday: 'Ngày lễ' };
export const EMP_TYPE = { chinh_thuc: 'Chính thức', thu_viec: 'Thử việc', thoi_vu: 'Thời vụ', cong_tac_vien: 'Cộng tác viên', khac: 'Khác' };
export const SALARY_TYPE = { hourly: 'Khoán theo giờ', contract: 'Theo hợp đồng' };

// ---- UI helpers ----
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function toast(msg, type = 'info', timeout = 3500) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bộ nhớ đầy / chặn */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15); return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
export const mapsLink = (lat, lng) => (lat == null ? null : `https://www.google.com/maps?q=${lat},${lng}`);

export function modal(html, { onMount, wide } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  onMount && onMount(wrap.querySelector('.modal'), close);
  return close;
}
