// Két dữ liệu: mã hoá phía trình duyệt (AES-256-GCM).
// - Khoá dữ liệu (DEK) ngẫu nhiên 256-bit, chỉ tồn tại trong bộ nhớ trình duyệt khi đã mở khoá.
// - Server chỉ lưu DEK đã được "bọc" bằng khoá sinh từ mật khẩu két (PBKDF2-SHA256, 600.000 vòng).
// - Server / quản trị viên máy chủ KHÔNG giải mã được CCCD, STK, lương.
const te = new TextEncoder(), td = new TextDecoder();
const subtle = crypto.subtle;
export const b64 = (u8) => { let s = ''; const a = new Uint8Array(u8); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITER = 600000;

let rawKey = null;  // Uint8Array(32)
let key = null;     // CryptoKey AES-GCM
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f());

export const isUnlocked = () => !!key;
// Ngữ cảnh (AAD) chuẩn cho từng loại dữ liệu
export const AAD = {
  emp: (id, field) => `vpa:emp:${id}:${field}`,        // bank_account | cccd_number | cccd_front | cccd_back
  sal: (empId, field) => `vpa:sal:${empId}:${field}`,   // amount | note
};
export function lock() { rawKey = null; key = null; emit(); }

async function kekFrom(pass, salt, iterations) {
  const base = await subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function fingerprint(raw) {
  const h = new Uint8Array(await subtle.digest('SHA-256', raw));
  return [...h.slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function setKey(raw) {
  rawKey = raw;
  key = await subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  emit();
}
async function wrapRecord(pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await kekFrom(pass, salt, ITER);
  const wrapped = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, kek, rawKey));
  return { salt: b64(salt), iv: b64(iv), wrapped: b64(wrapped), iterations: ITER, key_fingerprint: await fingerprint(rawKey) };
}

/** Tạo két mới. Trả về bản ghi để lưu server + mã khôi phục (anh cất giữ offline). */
export async function setup(pass) {
  await setKey(crypto.getRandomValues(new Uint8Array(32)));
  return { record: await wrapRecord(pass), recovery: recoveryCode() };
}
export async function unlock(pass, record) {
  const kek = await kekFrom(pass, unb64(record.salt), record.iterations);
  let raw;
  try { raw = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(record.iv) }, kek, unb64(record.wrapped))); }
  catch { throw new Error('Mật khẩu két không đúng'); }
  await setKey(raw);
}
export async function unlockWithRecovery(code, record) {
  const raw = unb64(String(code).replace(/[^A-Za-z0-9+/=]/g, ''));
  if (raw.length !== 32 || (await fingerprint(raw)) !== record.key_fingerprint) throw new Error('Mã khôi phục không khớp với két');
  await setKey(raw);
}
/** Đổi mật khẩu két (giữ nguyên khoá dữ liệu). */
export async function rewrap(newPass) { if (!rawKey) throw new Error('Két đang khoá'); return wrapRecord(newPass); }
export function recoveryCode() { if (!rawKey) throw new Error('Két đang khoá'); return b64(rawKey); }

// ---- Mã hoá chuỗi: "v1:<iv>:<ciphertext>" — aad gắn bản mã với đúng NV + trường (không tráo được giữa các NV) ----
const alg = (iv, aad) => {
  if (!aad) throw new Error('Thiếu ngữ cảnh mã hoá (aad)');
  return { name: 'AES-GCM', iv, additionalData: te.encode(aad) };
};
export async function encStr(s, aad) {
  if (s == null || s === '') return null;
  if (!key) throw new Error('Két đang khoá — hãy mở khoá để lưu dữ liệu nhạy cảm');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt(alg(iv, aad), key, te.encode(String(s))));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
export async function decStr(s, aad) {
  if (!s) return '';
  if (!key) return null;
  const [v, iv, ct] = s.split(':');
  if (v !== 'v1') return '[định dạng lạ]';
  try { return td.decode(await subtle.decrypt(alg(unb64(iv), aad), key, unb64(ct))); }
  catch { return '[không giải mã được]'; }
}
// ---- Mã hoá file: iv(12) || ciphertext ----
export async function encBytes(buf, aad) {
  if (!key) throw new Error('Két đang khoá');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt(alg(iv, aad), key, buf));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
export async function decBytes(buf, aad) {
  if (!key) throw new Error('Két đang khoá');
  const u = new Uint8Array(buf);
  return new Uint8Array(await subtle.decrypt(alg(u.slice(0, 12), aad), key, u.slice(12)));
}
