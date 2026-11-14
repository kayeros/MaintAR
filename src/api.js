// Клиент MaintARBackend: адрес сервера, JWT в AsyncStorage, понятные ошибки на русском.
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
      : `Нет связи с сервером ${baseUrl}. Телефон и компьютер должны быть в одной сети Wi-Fi.`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch (e) { /* текст */ }
  if (res.status === 401 && auth) { onUnauthorized(); throw new Error('Сессия истекла, войдите снова'); }
  if (res.status === 403) throw new Error('Подтвердите почту, чтобы продолжить');
  if (!res.ok) throw new Error(messageFrom(res.status, body));
  return body;
}

// ----- вход и регистрация -----
export async function login(email, password) {
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
export const identify = (value) => request(`/api/Equipment/identify?value=${encodeURIComponent(value)}`);
export const myInspections = () => request('/api/Inspections/my?pageSize=50');
export const getInspection = (id) => request(`/api/Inspections/${id}`);

export async function createInspection(photo, value, method) {
  const form = new FormData();
  if (typeof document !== 'undefined') {
    // веб: FormData понимает только Blob
    const blob = await (await fetch(photo.uri)).blob();
    form.append('Photo', blob, 'photo.jpg');
  } else {
    form.append('Photo', { uri: photo.uri, name: 'photo.jpg', type: 'image/jpeg' });
  }
  form.append('Value', value);
  form.append('IdentificationMethod', method);
  return request('/api/Inspections', { method: 'POST', form, timeout: 120000 });
}
