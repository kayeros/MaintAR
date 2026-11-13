// Аутентификация сотрудника. Пока локальная: пользователи хранятся на телефоне.
// Интерфейс намеренно как у сетевого API: все функции async и возвращают {ok, user} или {ok: false, error}.
// Чтобы перейти на сервер команды, достаточно заменить тела функций на fetch-запросы.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const USERS = 'obh.users';
const SESSION = 'obh.session';

export const ROLES = ['Инженер-обходчик', 'Мастер участка', 'Механик'];
export const DEMO = { login: 'demo', password: 'demo' };

async function read(key, fallback) {
  try { const v = await AsyncStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
async function write(key, value) {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}

const norm = (login) => String(login || '').trim().toLowerCase();
const publicUser = (u) => ({ name: u.name, role: u.role, login: u.login });

function makeSalt() {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
const hash = (salt, password) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);

// Демо-учётка для показа: создаётся при первом обращении, если её ещё нет.
async function loadUsers() {
  const users = await read(USERS, {});
  if (!users[DEMO.login]) {
    const salt = makeSalt();
    users[DEMO.login] = { login: DEMO.login, name: 'Инженер (демо)', role: 'Инженер-обходчик', salt, hash: await hash(salt, DEMO.password), created: Date.now() };
    await write(USERS, users);
  }
  return users;
}

// Проверка полей регистрации. Возвращает {поле: текст ошибки}; пустой объект, если всё верно.
export function validateRegistration({ name, role, login, password, password2 }) {
  const e = {};
  if (String(name || '').trim().length < 3) e.name = 'Укажите фамилию и имя';
  if (!ROLES.includes(role)) e.role = 'Выберите должность';
  const l = norm(login);
  if (l.length < 3) e.login = 'Логин: не меньше 3 символов';
  else if (!/^[a-z0-9._-]+$/.test(l)) e.login = 'Только латинские буквы, цифры, точка, дефис и подчёркивание';
  if (String(password || '').length < 4) e.password = 'Пароль: не меньше 4 символов';
  if (password2 !== undefined && password2 !== password) e.password2 = 'Пароли не совпадают';
  return e;
}

export async function register({ name, role, login, password }) {
  const errs = validateRegistration({ name, role, login, password });
  const first = Object.values(errs)[0];
  if (first) return { ok: false, error: first, field: Object.keys(errs)[0] };
  const users = await loadUsers();
  const l = norm(login);
  if (users[l]) return { ok: false, error: 'Такой логин уже занят', field: 'login' };
  const salt = makeSalt();
  users[l] = { login: l, name: String(name).trim().slice(0, 80), role, salt, hash: await hash(salt, password), created: Date.now() };
  if (!(await write(USERS, users))) return { ok: false, error: 'Не удалось сохранить учётную запись на устройстве' };
  const user = publicUser(users[l]);
  await write(SESSION, { login: l, ts: Date.now() });
  return { ok: true, user };
}

export async function login(loginName, password) {
  const l = norm(loginName);
  if (!l) return { ok: false, error: 'Введите логин', field: 'login' };
  if (!password) return { ok: false, error: 'Введите пароль', field: 'password' };
  const users = await loadUsers();
  const u = users[l];
  if (!u || (await hash(u.salt, password)) !== u.hash) return { ok: false, error: 'Неверный логин или пароль', field: 'password' };
  await write(SESSION, { login: l, ts: Date.now() });
  return { ok: true, user: publicUser(u) };
}

export async function logout() {
  try { await AsyncStorage.removeItem(SESSION); } catch (e) { /* сессия и так недоступна */ }
  return { ok: true };
}

export async function currentUser() {
  const sess = await read(SESSION, null);
  if (!sess || !sess.login) { await loadUsers(); return { ok: false, error: 'Вход не выполнен' }; }
  const users = await loadUsers();
  const u = users[sess.login];
  if (!u) { await logout(); return { ok: false, error: 'Учётная запись не найдена' }; }
  return { ok: true, user: publicUser(u) };
}
