// Клиент MaintARBackend: адрес сервера, JWT в AsyncStorage, понятные ошибки на русском.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_TOKEN = 'maintar.token';
const KEY_USER = 'maintar.user';
const KEY_URL = 'maintar.apiUrl';

export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://192.168.10.78:5176';

let baseUrl = DEFAULT_API_URL;
let token = null;
let onUnauthorized = () => {};

export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export const getBaseUrl = () => baseUrl;

export async function setBaseUrl(url) {
  baseUrl = (url || DEFAULT_API_URL).trim().replace(/\/+$/, '');
  try { await AsyncStorage.setItem(KEY_URL, baseUrl); } catch (e) { /* не критично */ }
}

// Данные из JWT без проверки подписи: имя, id и подтверждена ли почта.
export function readToken(t) {
  try {
    const part = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(Array.from(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')))
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    const p = JSON.parse(json);
    return { verified: p.email_verified === 'true', exp: p.exp ? p.exp * 1000 : null };
  } catch (e) {
    return { verified: false, exp: null };
  }
}

export async function restoreSession() {
  try {
    const url = await AsyncStorage.getItem(KEY_URL);
    if (url) baseUrl = url;
    token = await AsyncStorage.getItem(KEY_TOKEN);
    const user = JSON.parse((await AsyncStorage.getItem(KEY_USER)) || 'null');
    if (!token || !user) return null;
    const info = readToken(token);
    if (info.exp && info.exp < Date.now()) { await clearSession(); return null; }
    return { ...user, verified: info.verified };
  } catch (e) {
    return null;
  }
}

async function saveSession(t, user) {
  token = t;
  await AsyncStorage.setItem(KEY_TOKEN, t);
  if (user) await AsyncStorage.setItem(KEY_USER, JSON.stringify(user));
}

export async function clearSession() {
  token = null;
  try { await AsyncStorage.multiRemove([KEY_TOKEN, KEY_USER]); } catch (e) { /* ok */ }
}

const ERRORS = {
  'Invalid email or password': 'Неверная почта или пароль',
  'User with this email already exists': 'Пользователь с такой почтой уже есть',
  'Invalid or expired code': 'Неверный или просроченный код',
  'Equipment not found': 'Оборудование с таким кодом не найдено',
  'File must be an image': 'Нужна фотография',
  'Comment is required for Note': 'Для заметки нужен комментарий',
  'Date cannot be in the future': 'Дата не может быть в будущем',
  'Component not found': 'Узел не найден',
  'Record not found': 'Запись не найдена',
  'Password must be at least 6 characters long': 'Пароль должен быть не короче 6 символов',
  'Invalid email format': 'Неверный формат почты',
};

function messageFrom(status, body) {
  const raw = typeof body === 'string' ? body : body && (body.title || body.message || body.detail);
  if (raw && ERRORS[raw.replace(/^"|"$/g, '')]) return ERRORS[raw.replace(/^"|"$/g, '')];
  if (body && body.errors) return Object.values(body.errors).flat().join(' ');
  if (status === 404) return 'Не найдено';
  if (status >= 500) return 'Ошибка сервера. Попробуйте ещё раз.';
  return raw || `Ошибка ${status}`;
}

export async function request(path, { method = 'GET', json, form, auth = true, timeout = 30000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const headers = { Accept: 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(baseUrl + path, { method, headers, body: json ? JSON.stringify(json) : form, signal: ctl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError'
      ? 'Сервер не ответил вовремя. Проверьте сеть.'
      : `Нет связи с сервером ${baseUrl} (${method} ${path}: ${e.name}: ${e.message}).`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch (e) { /* текст */ }
  if (res.status === 401 && auth) { onUnauthorized(); throw new Error('Сессия истекла, войдите снова'); }
  if (res.status === 403) throw new Error('Подтвердите почту, чтобы продолжить');
  if (res.status === 404 || res.status === 400 || res.status === 409) throw new Error(messageFrom(res.status, body));
  if (!res.ok) throw new Error(`${messageFrom(res.status, body)} (HTTP ${res.status} ${method} ${path}: ${String(text).slice(0, 200)})`);
  return body;
}

// ----- вход и регистрация -----
// Короткий логин без «@» — это учётка в домене maintar.local (demo → demo@maintar.local).
export const toEmail = (login) => { const v = String(login || '').trim(); return v.includes('@') ? v : `${v.toLowerCase()}@maintar.local`; };

export async function login(loginOrEmail, password) {
  const email = toEmail(loginOrEmail);
  const r = await request('/api/Auth/login', { method: 'POST', json: { email, password }, auth: false });
  const user = { name: r.userName, email: r.email };
  await saveSession(r.token, user);
  return { ...user, verified: readToken(r.token).verified };
}

export async function register(userName, email, password) {
  const r = await request('/api/Auth/register', { method: 'POST', json: { email, userName, password }, auth: false });
  const user = { name: r.userName, email: r.email };
  await saveSession(r.token, user);
  return { ...user, verified: readToken(r.token).verified };
}

// Восстановление пароля: код на почту, затем новый пароль.
export const forgotPassword = (login) => request('/api/Auth/forgot-password', { method: 'POST', json: { email: toEmail(login) }, auth: false });
export const resetPassword = (login, code, newPassword) =>
  request('/api/Auth/reset-password', { method: 'POST', json: { email: toEmail(login), code: code.trim(), newPassword }, auth: false });

export const sendCode = () => request('/api/Auth/send-verification-code', { method: 'POST' });

export async function verifyEmail(code, user) {
  const r = await request('/api/Auth/verify-email', { method: 'POST', json: { code: code.trim() } });
  await saveSession(r.token, user);
  return { ...user, verified: true };
}

// ----- оборудование и осмотры -----
export const listEquipment = (search) =>
  request('/api/Equipment' + (search ? `?search=${encodeURIComponent(search)}` : ''));
export const getEquipment = (id) => request(`/api/Equipment/${id}`);
// Значение из QR может прийти ссылкой (генераторы QR дописывают http://): берём сам код.
export function cleanCode(raw) {
  let v = String(raw || '').trim();
  const q = v.match(/[?&](?:value|code|sn)=([^&#]+)/i);
  if (q) return decodeURIComponent(q[1]).trim().toUpperCase();
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/#?]+$/, '');
  if (v.includes('/')) v = v.split('/').filter(Boolean).pop() || v;
  try { v = decodeURIComponent(v); } catch (e) { /* как есть */ }
  return v.trim().toUpperCase();
}
export async function identify(value) {
  const code = cleanCode(value);
  try {
    return await request(`/api/Equipment/identify?value=${encodeURIComponent(code)}`);
  } catch (e) {
    throw new Error(`${e.message}. Прочитан код: ${code || '(пусто)'}`);
  }
}
export const myInspections = () => request('/api/Inspections/my?pageSize=50');
export const getInspection = (id) => request(`/api/Inspections/${id}`);
// Все осмотры оборудования (все инженеры) и просмотр любого из них.
export const equipmentInspections = (equipmentId) => request(`/api/Inspections/equipment/${equipmentId}?pageSize=50`);
export const getEquipmentInspection = (equipmentId, id) => request(`/api/Inspections/equipment/${equipmentId}/${id}`);

// ----- недавно найденное оборудование (на телефоне, у каждого пользователя своё) -----
const recentKey = (email) => `maintar.recent.${(email || '').toLowerCase()}`;
export async function getRecent(email) {
  try { return JSON.parse((await AsyncStorage.getItem(recentKey(email))) || '[]'); } catch (e) { return []; }
}
export async function addRecent(email, item) {
  const list = [item, ...(await getRecent(email)).filter((x) => x.code !== item.code)].slice(0, 10);
  try { await AsyncStorage.setItem(recentKey(email), JSON.stringify(list)); } catch (e) { /* не критично */ }
  return list;
}
export async function removeRecent(email, code) {
  const list = (await getRecent(email)).filter((x) => x.code !== code);
  try { await AsyncStorage.setItem(recentKey(email), JSON.stringify(list)); } catch (e) { /* не критично */ }
  return list;
}

// ----- журнал работ по узлам -----
export const MAINT_TYPES = [
  ['Checked', 'Проверил', 'checkmark-circle-outline'],
  ['Serviced', 'Обслужил', 'construct-outline'],
  ['Replaced', 'Заменил', 'refresh-outline'],
  ['Note', 'Заметка', 'create-outline'],
];
export const addMaintenance = (componentId, type, comment, date) =>
  request('/api/Maintenance', { method: 'POST', json: { componentId, type, comment: comment || null, date: date || null } });
export const maintenanceByEquipment = (id) => request(`/api/Maintenance/equipment/${id}`);
export const maintenanceByComponent = (id) => request(`/api/Maintenance/component/${id}`);
export const myMaintenance = () => request('/api/Maintenance/my');
export const deleteMaintenance = (id) => request(`/api/Maintenance/${id}`, { method: 'DELETE' });

// Веб: image-picker игнорирует quality и отдаёт оригинал (бывает 10+ МБ, сервер такое отклоняет
// и рвёт соединение — браузер видит «Failed to fetch»). Ужимаем через canvas до JPEG.
async function webJpeg(uri, maxSide = 1600, quality = 0.8) {
  const src = await (await fetch(uri)).blob();
  try {
    const bmp = await createImageBitmap(src);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return out || src;
  } catch (e) {
    return src;
  }
}

export async function createInspection(photo, value, method) {
  if (Platform.OS === 'web') {
    // веб: FormData понимает только Blob
    const form = new FormData();
    const blob = await webJpeg(photo.uri);
    form.append('Photo', blob, 'photo.jpg');
    form.append('Value', value);
    form.append('IdentificationMethod', method);
    return request('/api/Inspections', { method: 'POST', form, timeout: 120000 });
  }
  return uploadNative('/api/Inspections', 'Photo', photo, { Value: value, IdentificationMethod: method });
}

// Фото оборудования для карточки.
export async function uploadEquipmentPhoto(id, photo) {
  const path = `/api/Equipment/${id}/photo`;
  if (Platform.OS === 'web') {
    const form = new FormData();
    form.append('photo', await webJpeg(photo.uri), 'photo.jpg');
    return request(path, { method: 'POST', form, timeout: 120000 });
  }
  return uploadNative(path, 'photo', photo, {});
}
export const photoUrl = (p) => (p ? (p.startsWith('http') ? p : baseUrl + p) : null);

// Профиль: имя и аватарка.
// Выгрузка в CSV для Excel: what = 'inspections' | 'maintenance', mine — только свои записи.
export const exportCsv = (what, mine) => request(`/api/Export/${what}${mine ? '?mine=true' : ''}`, { timeout: 60000 });

export const getProfile = () => request('/api/Profile');
export async function updateName(name, user) {
  const r = await request('/api/Profile/name', { method: 'PUT', json: { userName: name.trim() } });
  const next = { name: r.userName, email: user.email };
  await saveSession(r.token, next);   // имя есть и в токене — берём новый
  return { ...user, name: r.userName };
}
export async function uploadAvatar(photo) {
  const path = '/api/Profile/avatar';
  if (Platform.OS === 'web') {
    const form = new FormData();
    form.append('photo', await webJpeg(photo.uri, 800, 0.85), 'avatar.jpg');
    return request(path, { method: 'POST', form, timeout: 120000 });
  }
  return uploadNative(path, 'photo', photo, {});
}
export const deleteAvatar = () => request('/api/Profile/avatar', { method: 'DELETE' });

// Телефон: fetch из Expo не принимает файл объектом {uri, name, type},
// а XMLHttpRequest React Native умеет отправлять его в multipart.
function uploadNative(path, field, photo, fields) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append(field, { uri: photo.uri, name: 'photo.jpg', type: 'image/jpeg' });
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${baseUrl}${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 120000;
    xhr.onload = () => {
      const text = xhr.responseText || '';
      let body = text;
      try { body = text ? JSON.parse(text) : null; } catch (e) { /* текст */ }
      if (xhr.status === 401) { onUnauthorized(); return reject(new Error('Сессия истекла, войдите снова')); }
      if (xhr.status < 200 || xhr.status >= 300) {
        return reject(new Error(`${messageFrom(xhr.status, body)} (HTTP ${xhr.status}: ${text.slice(0, 200)})`));
      }
      resolve(body);
    };
    xhr.onerror = () => reject(new Error(`Нет связи с сервером ${baseUrl}. Телефон и компьютер должны быть в одной сети Wi-Fi.`));
    xhr.ontimeout = () => reject(new Error('Сервер не ответил вовремя. Проверьте сеть.'));
    xhr.send(form);
  });
}
