// MaintAR: мобильное приложение инженера-обходчика. Работает через MaintARBackend:
// вход → список оборудования → карточка → фото и код на анализ ИИ → результат с рамками → история.
// Стили: Tailwind через NativeWind, палитра в src/theme.js.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl,
  ScrollView, StatusBar, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors as C } from './src/theme';
import * as api from './src/api';

// ----- общий вид -----
const T = {
  title: 'text-[24px] leading-[30px] font-semibold text-fg',
  body: 'text-[17px] leading-[24px] text-fg',
  bodyB: 'text-[17px] leading-[24px] font-semibold text-fg',
  cap: 'text-[14px] leading-[20px] text-muted',
};
const CARD = 'bg-surface rounded-xl border border-divider p-4 gap-3';

// Статус оборудования и находок: значок, слово и цвет вместе.
const ST = {
  ok: { word: 'Видимых проблем не обнаружено', icon: 'checkmark-circle', color: C.ok, soft: 'bg-ok-bg', text: 'text-ok' },
  check: { word: 'Проверить', icon: 'alert-circle', color: C.check, soft: 'bg-check-bg', text: 'text-check' },
  defect: { word: 'Есть дефекты', icon: 'close-circle', color: C.defect, soft: 'bg-defect-bg', text: 'text-defect' },
  none: { word: 'Не проверялось', icon: 'help-circle', color: C.muted, soft: 'bg-sunken', text: 'text-muted' },
};
const reportStatus = (s) => (s === 'Ok' ? 'ok' : s === 'HasDefects' ? 'defect' : 'none');
const CATEGORY = {
  PossibleDefect: { key: 'defect', word: 'Возможный дефект' },
  CheckRecommended: { key: 'check', word: 'Рекомендуется проверка' },
  NoVisibleProblems: { key: 'ok', word: 'Видимых проблем нет' },
};
const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Badge({ k, text }) {
  const c = ST[k] || ST.none;
  return (
    <View className={`flex-row items-center self-start gap-1.5 rounded-full px-3 py-1.5 ${c.soft}`}>
      <Ionicons name={c.icon} size={18} color={c.color} />
      <Text className={`text-[14px] font-semibold ${c.text}`}>{text || c.word}</Text>
    </View>
  );
}
function Primary({ title, icon, onPress, disabled, busy }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button"
      className={`h-14 rounded-xl bg-primary flex-row items-center justify-center gap-2 active:opacity-85 ${disabled || busy ? 'opacity-60' : ''}`}>
      {busy ? <ActivityIndicator color="#fff" /> : !!icon && <Ionicons name={icon} size={24} color="#fff" />}
      <Text className="text-[17px] font-semibold text-white">{title}</Text>
    </Pressable>
  );
}
function Secondary({ title, icon, onPress, className = '' }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      className={`h-12 px-4 rounded-xl border border-line bg-surface flex-row items-center justify-center gap-2 active:opacity-70 ${className}`}>
      {!!icon && <Ionicons name={icon} size={20} color={C.primary} />}
      <Text className="text-[17px] font-semibold text-primary">{title}</Text>
    </Pressable>
  );
}
function Field({ label, icon, secure, ...props }) {
  return (
    <View className="gap-1.5">
      {!!label && <Text className={T.cap}>{label}</Text>}
      <View className="flex-row items-center gap-2.5 border border-line rounded-xl px-3 h-12 bg-surface">
        {!!icon && <Ionicons name={icon} size={20} color={C.muted} />}
        <TextInput className="flex-1 text-[17px] text-fg" placeholderTextColor={C.muted} autoCapitalize="none"
          autoCorrect={false} secureTextEntry={secure} {...props} />
      </View>
    </View>
  );
}
const ErrorBox = ({ text }) => (text ? (
  <View className="bg-defect-bg rounded-xl p-3 flex-row gap-2">
    <Ionicons name="alert-circle" size={20} color={C.defect} />
    <Text className="text-[15px] text-defect flex-1">{text}</Text>
  </View>
) : null);
const KV = ({ k, v, last }) => (v ? (
  <View className={`flex-row gap-3 py-2.5 ${last ? '' : 'border-b border-divider'}`}>
    <Text className={`${T.cap} flex-1`}>{k}</Text>
    <Text className="flex-[1.4] text-[16px] text-fg text-right">{v}</Text>
  </View>
) : null);
function Header({ title, onBack, right }) {
  const { top } = useSafeAreaInsets();
  return (
    <View className="bg-primary px-4 pb-3 flex-row items-center gap-3" style={{ paddingTop: top + 8 }}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Назад"
          className="w-11 h-11 rounded-full bg-white/15 items-center justify-center active:opacity-75">
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
      )}
      <Text className="text-white text-[20px] font-semibold flex-1" numberOfLines={1}>{title}</Text>
      {right}
    </View>
  );
}

// ----- вход, регистрация, подтверждение почты -----
function AuthScreen({ onDone }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => { setF({ ...f, [k]: v }); setErr(''); };
  const submit = async (demo) => {
    const v = demo ? { ...f, email: api.DEMO.login, password: api.DEMO.password } : f;
    if (demo) setF(v);
    if (!v.email.trim() || !v.password) return setErr(mode === 'login' ? 'Введите логин и пароль' : 'Введите почту и пароль');
    if (mode === 'register' && !v.name.trim()) return setErr('Введите имя');
    setBusy(true); setErr('');
    try {
      const u = mode === 'login' || demo ? await api.login(v.email.trim(), v.password) : await api.register(v.name.trim(), v.email.trim(), v.password);
      onDone(u);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const reg = mode === 'register';
  const { top } = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView className="flex-1 bg-bg" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerClassName="grow pb-8" keyboardShouldPersistTaps="handled">
        <View className="bg-primary items-center pb-14 px-4 gap-1.5" style={{ paddingTop: top + 36 }}>
          <View className="w-16 h-16 rounded-2xl bg-white/15 items-center justify-center mb-1.5">
            <Ionicons name="scan-outline" size={34} color="#fff" />
          </View>
          <Text className="text-white text-[32px] font-extrabold">MaintAR</Text>
          <Text className="text-white/80 text-[17px]">AR-помощник инженера</Text>
        </View>
        <View className="px-4 -mt-9">
          <View className="bg-surface rounded-2xl p-5 gap-4 border border-divider">
            <Text className={T.title}>{reg ? 'Регистрация' : 'Вход'}</Text>
            {reg && <Field label="Имя" icon="person-outline" value={f.name} onChangeText={set('name')} autoCapitalize="words" placeholder="Иван Иванов" />}
            <Field label={reg ? 'Почта' : 'Логин или почта'} icon={reg ? 'mail-outline' : 'person-outline'} value={f.email} onChangeText={set('email')}
              keyboardType={reg ? 'email-address' : 'default'} autoCapitalize="none" autoCorrect={false} placeholder={reg ? 'name@company.ru' : 'demo или name@company.ru'} />
            <Field label="Пароль" icon="lock-closed-outline" secure value={f.password} onChangeText={set('password')} placeholder="Пароль" onSubmitEditing={() => submit(false)} />
            <ErrorBox text={err} />
            <Primary title={reg ? 'Зарегистрироваться' : 'Войти'} onPress={() => submit(false)} busy={busy} />
            {!reg && (
              <View className="gap-2 items-center">
                <Text className={`${T.cap} text-center`}>Демо-доступ: {api.DEMO.login} / {api.DEMO.password}</Text>
                <Secondary title="Войти как демо" icon="flash-outline" onPress={() => submit(true)} className="self-stretch" />
              </View>
            )}
            <Pressable onPress={() => { setMode(reg ? 'login' : 'register'); setErr(''); }} className="self-center min-h-[44px] justify-center">
              <Text className="text-[17px] text-muted text-center">{reg ? 'Уже есть учётная запись? ' : 'Нет учётной записи? '}
                <Text className="text-primary font-semibold">{reg ? 'Войти' : 'Зарегистрироваться'}</Text></Text>
            </Pressable>
          </View>
          <Text className={`${T.cap} text-center mt-4`}>Сервер: {api.getBaseUrl()}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function VerifyScreen({ user, onDone, onLogout }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const send = useCallback(async () => {
    setErr(''); setNote('');
    try { await api.sendCode(); setNote(`Код отправлен на ${user.email}`); } catch (e) { setErr(e.message); }
  }, [user.email]);
  useEffect(() => { send(); }, [send]);
  const verify = async () => {
    if (code.trim().length < 6) return setErr('Введите 6 цифр из письма');
    setBusy(true);
    try { onDone(await api.verifyEmail(code, user)); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <View className="flex-1 bg-bg">
      <Header title="Подтверждение почты" />
      <ScrollView contentContainerClassName="p-4 gap-4" keyboardShouldPersistTaps="handled">
        <View className={CARD}>
          <Text className={T.body}>Мы отправили 6-значный код на <Text className="font-semibold">{user.email}</Text>. Введите его, чтобы продолжить.</Text>
          <Field icon="key-outline" value={code} onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); setErr(''); }}
            keyboardType="number-pad" placeholder="000000" onSubmitEditing={verify} />
          {!!note && <Text className={T.cap}>{note}</Text>}
          <ErrorBox text={err} />
          <Primary title="Подтвердить" icon="checkmark" onPress={verify} busy={busy} />
          <Secondary title="Отправить код ещё раз" icon="refresh" onPress={send} />
        </View>
        <Pressable onPress={onLogout} className="self-center min-h-[44px] justify-center">
          <Text className="text-[17px] text-primary">Войти под другой почтой</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ----- камера -----
function CameraScreen({ mode, hint, onPhoto, onQr, onClose }) {
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const scanned = useRef(false);
  const { top, bottom } = useSafeAreaInsets();
  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) requestPerm(); }, [perm]);
  if (!perm) return <View className="flex-1 bg-black items-center justify-center"><ActivityIndicator color="#fff" /></View>;
  if (!perm.granted) {
    return (
      <View className="flex-1 bg-black items-center justify-center p-6 gap-4">
        <Text className="text-white text-[17px] text-center">Нет доступа к камере. Разрешите его в настройках телефона.</Text>
        <View className="self-stretch gap-3"><Primary title="Разрешить камеру" onPress={requestPerm} /><Secondary title="Назад" onPress={onClose} /></View>
      </View>
    );
  }
  const shoot = async () => {
    if (!cam.current || busy) return;
    setBusy(true);
    try { const p = await cam.current.takePictureAsync({ quality: 0.5 }); onPhoto({ uri: p.uri, width: p.width, height: p.height }); }
    catch (e) { setBusy(false); }
  };
  return (
    <View className="flex-1 bg-black items-center justify-center">
      <CameraView ref={cam} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} facing="back" onCameraReady={() => setReady(true)}
        barcodeScannerSettings={mode === 'qr' ? { barcodeTypes: ['qr'] } : undefined}
        onBarcodeScanned={mode === 'qr' ? (e) => { if (!scanned.current) { scanned.current = true; onQr(String(e.data || '')); } } : undefined} />
      {mode === 'qr' && <View className="w-60 h-60 border-[3px] border-white rounded-xl" pointerEvents="none" />}
      <View className="absolute top-0 left-0 right-0 px-4 pb-4 gap-1 bg-black/60" style={{ paddingTop: top + 12 }}>
        <Text className="text-white text-[22px] font-semibold">{mode === 'qr' ? 'Наведите на QR-код' : 'Сфотографируйте узел'}</Text>
        {!!hint && <Text className="text-white text-[16px]">{hint}</Text>}
      </View>
      <View className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-6 pt-6 bg-black/60" style={{ paddingBottom: bottom + 20 }}>
        <Pressable onPress={onClose} className="w-20 h-12 items-center justify-center rounded-xl border border-white/50">
          <Text className="text-white text-[17px] font-semibold">Назад</Text>
        </Pressable>
        {mode !== 'qr' ? (
          <Pressable onPress={shoot} disabled={!ready || busy} accessibilityLabel="Сделать снимок"
            className={`w-20 h-20 rounded-full border-4 border-white items-center justify-center ${!ready || busy ? 'opacity-50' : ''}`}>
            <View className="w-16 h-16 rounded-full bg-white" />
          </Pressable>
        ) : <View />}
        <View className="w-20" />
      </View>
    </View>
  );
}

// ----- фото с рамками -----
function PhotoBoxes({ photo, findings, onComponent }) {
  const ratio = (photo.width || 4) / (photo.height || 3);
  const boxes = findings.filter((f) => f.boxWidth > 0 && f.boxHeight > 0);
  return (
    <View className="w-full bg-sunken rounded-xl overflow-hidden" style={{ aspectRatio: ratio }}>
      <Image source={{ uri: photo.uri }} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} resizeMode="contain" />
      {boxes.map((f, i) => {
        const c = ST[(CATEGORY[f.category] || CATEGORY.CheckRecommended).key];
        return (
          <Pressable key={i} disabled={!onComponent || !f.componentId} onPress={() => onComponent(f.componentId)}
            accessibilityLabel={`Узел: ${f.componentName || ''}`} className="absolute border-[3px] rounded" style={{
            borderColor: c.color, left: `${f.boxX * 100}%`, top: `${f.boxY * 100}%`,
            width: `${Math.min(f.boxWidth, 1 - f.boxX) * 100}%`, height: `${Math.min(f.boxHeight, 1 - f.boxY) * 100}%`,
          }}>
            <View className="absolute left-[-3px] h-7 min-w-[28px] px-1.5 items-center justify-center rounded" style={{ backgroundColor: c.color, top: f.boxY > 0.08 ? -29 : 0 }}>
              <Text className="text-white text-[14px] font-bold">{i + 1}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// Находки по узлам: название, уверенность, пояснение, рекомендация.
function Findings({ components, onComponent }) {
  const rows = [];
  (components || []).forEach((c) => (c.findings || []).forEach((f) => rows.push({ ...f, componentName: c.componentName, componentId: c.componentId })));
  const problems = rows.filter((f) => f.category !== 'NoVisibleProblems');
  if (!problems.length) {
    return <View className={CARD}><Badge k="ok" text="Видимых проблем не обнаружено" /><Text className={T.cap}>Это предварительный осмотр, он не подтверждает исправность.</Text></View>;
  }
  return problems.map((f, i) => {
    const cat = CATEGORY[f.category] || CATEGORY.CheckRecommended;
    return (
      <Pressable key={i} disabled={!onComponent} onPress={() => onComponent(f.componentId)} className={`${CARD} active:opacity-70`}>
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 gap-0.5">
            <Text className={T.bodyB}>{i + 1}. {f.defectName || 'Признак дефекта'}</Text>
            <Text className={onComponent ? 'text-[15px] text-primary font-semibold' : T.cap}>Узел: {f.componentName}{onComponent ? ' ›' : ''}</Text>
          </View>
          {f.confidence != null && <Text className="text-[15px] font-semibold text-muted">{Math.round(f.confidence * 100)} %</Text>}
        </View>
        <Badge k={cat.key} text={cat.word} />
        {!!f.explanation && <Text className={T.body}>{f.explanation}</Text>}
        {!!f.recommendation && (
          <View className="bg-bg rounded-xl p-3 gap-1">
            <Text className="text-[14px] font-semibold text-primary">Что сделать</Text>
            <Text className={T.body}>{f.recommendation}</Text>
          </View>
        )}
      </Pressable>
    );
  });
}

// ----- оборудование: список -----
// Поиск оборудования только по QR-коду или номеру; ниже то, что пользователь уже находил.
function FindEquipment({ user, onFound, onScan, onManual, version }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [recent, setRecent] = useState([]);
  useEffect(() => { api.getRecent(user.email).then(setRecent); }, [user.email, version]);
  const find = async (value, method) => {
    const v = (value || '').trim();
    if (!v) return setErr('Введите код с QR или серийный номер с шильдика');
    setBusy(true); setErr('');
    try { const c = api.cleanCode(v); const r = await api.identify(c); await onFound(r, c, method); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const remove = async (code) => setRecent(await api.removeRecent(user.email, code));
  return (
    <ScrollView contentContainerClassName="p-4 gap-4 pb-8" keyboardShouldPersistTaps="handled">
      <View className={CARD}>
        <Text className={T.title}>Найдите оборудование</Text>
        <Text className={T.body}>Отсканируйте QR-код на агрегате или введите номер с шильдика.</Text>
        <Primary title="Сканировать QR-код" icon="qr-code-outline" onPress={onScan} />
        <Field icon="barcode-outline" value={code} onChangeText={(v) => { setCode(v); setErr(''); }}
          placeholder="Код или серийный номер" onSubmitEditing={() => find(code, 'SerialNumber')} autoCapitalize="characters" />
        <Secondary title="Найти по номеру" icon="search-outline" onPress={() => find(code, 'SerialNumber')} />
        <Pressable onPress={onManual} hitSlop={6} className="self-center min-h-[44px] justify-center">
          <Text className="text-[16px] text-primary underline">Не получается? Выбрать вручную</Text>
        </Pressable>
        <ErrorBox text={err} />
        {busy && <ActivityIndicator color={C.primary} />}
      </View>
      <View className={CARD}>
        <Text className={T.bodyB}>Недавно найденные</Text>
        {!recent.length && <Text className={T.cap}>Здесь появится оборудование, которое вы нашли по QR-коду или номеру.</Text>}
        {recent.map((e, i) => (
          <View key={e.code} className={`flex-row items-center gap-3 py-2 ${i === recent.length - 1 ? '' : 'border-b border-divider'}`}>
            <Pressable onPress={() => find(e.code, e.method)} className="flex-1 flex-row items-center gap-3 min-h-[48px] active:opacity-60">
              {e.photoUrl
                ? <Image source={{ uri: api.photoUrl(e.photoUrl) }} style={{ width: 48, height: 48, borderRadius: 10 }} />
                : <View className="w-12 h-12 rounded-xl bg-primary-soft items-center justify-center"><Ionicons name="construct-outline" size={24} color={C.primary} /></View>}
              <View className="flex-1 gap-0.5">
                <Text className={T.bodyB}>{e.name}</Text>
                <Text className={T.cap}>{e.model} · {e.code}</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => remove(e.code)} hitSlop={8} accessibilityLabel="Убрать из списка" className="w-11 h-11 items-center justify-center">
              <Ionicons name="close" size={22} color={C.muted} />
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ----- журнал работ -----
const MAINT = Object.fromEntries(api.MAINT_TYPES.map(([k, w, i]) => [k, { word: w, icon: i }]));
// Остаток ресурса узла: срок службы от последней замены (или установки).
function lifeLeft(c, eqInstalled) {
  if (!c.serviceLifeMonths) return null;
  const from = c.lastReplacedAt || c.installedAt || eqInstalled;
  if (!from) return { text: `Срок службы ${c.serviceLifeMonths} мес., дата установки неизвестна`, k: 'none' };
  const start = new Date(from);
  const end = new Date(start); end.setMonth(end.getMonth() + c.serviceLifeMonths);
  const left = Math.round((end - Date.now()) / (30.44 * 864e5));
  const k = left <= 0 ? 'defect' : left < c.serviceLifeMonths * 0.2 ? 'check' : 'ok';
  const fromWhat = c.lastReplacedAt ? 'от даты замены' : c.installedAt ? 'от даты установки узла' : 'от даты установки оборудования';
  return { text: left <= 0 ? `Срок службы истёк ${-left} мес. назад` : `Осталось ~${left} мес. из ${c.serviceLifeMonths}`, k, left, pct: left / c.serviceLifeMonths, from, fromWhat };
}

// Шаг 5 сценария: какие узлы проверить первыми и почему.
function suspects(d) {
  const out = [];
  const byComp = {};
  (d.report.defects || []).forEach((g) => { byComp[g.componentId] = g.findings || []; });
  d.components.forEach((c) => {
    const reasons = [];
    let k = 'check';
    (byComp[c.id] || []).filter((f) => f.category !== 'NoVisibleProblems').forEach((f) => {
      const cat = CATEGORY[f.category] || CATEGORY.CheckRecommended;
      if (cat.key === 'defect') k = 'defect';
      reasons.push(`На последнем осмотре: ${(f.defectName || 'признак дефекта').toLowerCase()} — ${cat.word.toLowerCase()}`);
    });
    const life = lifeLeft(c, d.installedAt);
    if (!life || life.left == null) reasons.push('Нет данных о ресурсе узла');
    else if (life.left <= 0) { k = 'defect'; reasons.push(`Ресурс выработан: ${life.text.toLowerCase()}`); }
    else if (life.pct < 0.15) reasons.push(`Ресурс почти выработан: осталось ~${life.left} мес. из ${c.serviceLifeMonths}`);
    if (reasons.length) out.push({ c, k, reasons });
  });
  return out.sort((a, b) => (a.k === 'defect' ? 0 : 1) - (b.k === 'defect' ? 0 : 1));
}
function CheckFirst({ d, onShoot }) {
  const list = suspects(d);
  if (!list.length) return null;
  return (
    <View className={`${CARD} border-check`}>
      <View className="flex-row items-center gap-2">
        <Ionicons name="eye-outline" size={24} color={C.check} />
        <Text className={T.bodyB}>Сначала проверьте</Text>
      </View>
      {list.map(({ c, k, reasons }, i) => (
        <View key={c.id} className={`gap-2 py-2 ${i === list.length - 1 ? '' : 'border-b border-divider'}`}>
          <View className="flex-row items-center gap-2">
            <View className="w-3 h-3 rounded-full" style={{ backgroundColor: ST[k].color }} />
            <Text className={`${T.bodyB} flex-1`}>{c.name}</Text>
          </View>
          {reasons.map((r, j) => <Text key={j} className={T.body}>• {r}</Text>)}
          <Secondary title="Сфотографировать узел" icon="camera-outline" onPress={() => onShoot(c)} />
        </View>
      ))}
    </View>
  );
}
function WorkRow({ w, showComponent, onDelete, last }) {
  const m = MAINT[w.type] || { word: w.type, icon: 'document-text-outline' };
  return (
    <View className={`flex-row gap-3 py-3 ${last ? '' : 'border-b border-divider'}`}>
      <View className="w-10 h-10 rounded-full bg-primary-soft items-center justify-center"><Ionicons name={m.icon} size={22} color={C.primary} /></View>
      <View className="flex-1 gap-0.5">
        <Text className={T.bodyB}>{m.word}{showComponent && w.componentName ? `: ${w.componentName}` : ''}</Text>
        {!!w.comment && <Text className={T.body}>{w.comment}</Text>}
        <Text className={T.cap}>{fmtDate(w.date)}{w.userName ? ` · ${w.userName}` : ''}{showComponent === 'equipment' && w.equipmentName ? ` · ${w.equipmentName}` : ''}</Text>
      </View>
      {onDelete && (
        <Pressable onPress={() => onDelete(w)} hitSlop={8} accessibilityLabel="Удалить запись" className="w-11 h-11 items-center justify-center">
          <Ionicons name="trash-outline" size={22} color={C.defect} />
        </Pressable>
      )}
    </View>
  );
}
function WorkList({ items, showComponent, onDelete, empty }) {
  if (!items) return <ActivityIndicator color={C.primary} />;
  if (!items.length) return <Text className={T.cap}>{empty || 'Записей пока нет'}</Text>;
  return <View>{items.map((w, i) => <WorkRow key={w.id} w={w} showComponent={showComponent} onDelete={onDelete} last={i === items.length - 1} />)}</View>;
}

// Экран узла: ресурс, журнал работ, кнопка записи.
function ComponentScreen({ component, eqInstalled, onRecord, version }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.maintenanceByComponent(component.id).then(setItems).catch((e) => { setErr(e.message); setItems([]); }); }, [component.id, version]);
  const life = lifeLeft(component, eqInstalled);
  return (
    <ScrollView contentContainerClassName="p-4 gap-4 pb-8">
      <View className={CARD}>
        <Text className={T.title}>{component.name}</Text>
        {life && <Badge k={life.k} text={life.text} />}
        <Text className={T.cap}>{component.lastReplacedAt ? `Последняя замена: ${component.lastReplacedAt}` : component.installedAt ? `Установлен: ${component.installedAt}` : 'Замен не было'}</Text>
      </View>
      <Primary title="Записать работу" icon="create" onPress={() => onRecord(component)} />
      <View className={CARD}>
        <Text className={T.bodyB}>Журнал работ по узлу</Text>
        <ErrorBox text={err} />
        <WorkList items={items} />
      </View>
    </ScrollView>
  );
}

// Запись работы: узел, тип, комментарий, дата (сейчас или прошлый день).
const WHEN = [['Сейчас', 0], ['Вчера', 1], ['2 дня назад', 2], ['Неделю назад', 7]];
function RecordWork({ components, preset, onSaved }) {
  const [comp, setComp] = useState(preset || (components.length === 1 ? components[0].id : null));
  const [type, setType] = useState('Checked');
  const [comment, setComment] = useState('');
  const [daysAgo, setDaysAgo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!comp) return setErr('Выберите узел');
    if (type === 'Note' && !comment.trim()) return setErr('Для заметки нужен комментарий');
    setBusy(true); setErr('');
    try {
      const date = daysAgo ? new Date(Date.now() - daysAgo * 864e5).toISOString() : null;
      await api.addMaintenance(comp, type, comment.trim(), date);
      onSaved(type);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <ScrollView contentContainerClassName="p-4 gap-4 pb-8" keyboardShouldPersistTaps="handled">
      {!preset && (
        <View className={CARD}>
          <Text className={T.bodyB}>Узел</Text>
          <View className="gap-2">
            {components.map((c) => (
              <Pressable key={c.id} onPress={() => { setComp(c.id); setErr(''); }}
                className={`min-h-[48px] flex-row items-center gap-3 px-3 rounded-xl border ${comp === c.id ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                <Ionicons name={comp === c.id ? 'radio-button-on' : 'radio-button-off'} size={22} color={comp === c.id ? C.primary : C.muted} />
                <Text className={T.body}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      {preset && <View className={CARD}><Text className={T.cap}>Узел</Text><Text className={T.bodyB}>{(components.find((c) => c.id === preset) || {}).name || `№${preset}`}</Text></View>}
      <View className={CARD}>
        <Text className={T.bodyB}>Что сделали</Text>
        <View className="flex-row flex-wrap gap-2">
          {api.MAINT_TYPES.map(([k, word, icon]) => (
            <Pressable key={k} onPress={() => { setType(k); setErr(''); }}
              className={`w-[48%] h-16 rounded-xl border flex-row items-center justify-center gap-2 ${type === k ? 'bg-primary border-primary' : 'bg-surface border-line'}`}>
              <Ionicons name={icon} size={24} color={type === k ? '#fff' : C.primary} />
              <Text className={`text-[17px] font-semibold ${type === k ? 'text-white' : 'text-primary'}`}>{word}</Text>
            </Pressable>
          ))}
        </View>
        {type === 'Replaced' && <Text className={T.cap}>После записи ресурс узла начнёт отсчитываться заново.</Text>}
      </View>
      <View className={CARD}>
        <Text className={T.bodyB}>Комментарий{type === 'Note' ? ' (обязательно)' : ''}</Text>
        <TextInput className="border border-line rounded-xl p-3 text-[17px] text-fg bg-surface min-h-[96px]" style={{ textAlignVertical: 'top' }}
          multiline value={comment} onChangeText={(v) => { setComment(v); setErr(''); }}
          placeholder={type === 'Note' ? 'Опишите, что заметили' : 'Что сделали, какие детали заменили'} placeholderTextColor={C.muted} />
      </View>
      <View className={CARD}>
        <Text className={T.bodyB}>Когда</Text>
        <View className="flex-row flex-wrap gap-2">
          {WHEN.map(([w, d]) => (
            <Pressable key={d} onPress={() => setDaysAgo(d)}
              className={`min-h-[44px] px-4 justify-center rounded-xl border ${daysAgo === d ? 'bg-primary border-primary' : 'bg-surface border-line'}`}>
              <Text className={`text-[16px] ${daysAgo === d ? 'text-white font-semibold' : 'text-fg'}`}>{w}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ErrorBox text={err} />
      <Primary title="Сохранить" icon="checkmark" onPress={save} busy={busy} />
    </ScrollView>
  );
}

// Строка осмотра в истории оборудования: фото, статус, дата, инженер.
function InspectionRow({ i, onOpen, last }) {
  const k = i.status === 'Failed' ? 'check' : reportStatus(i.result);
  return (
    <Pressable onPress={() => onOpen(i)} className={`flex-row items-center gap-3 py-3 active:opacity-60 ${last ? '' : 'border-b border-divider'}`}>
      {i.photoPath
        ? <Image source={{ uri: api.photoUrl(i.photoPath) }} style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: C.sunken }} />
        : <View className="w-[52px] h-[52px] rounded-[10px] bg-sunken items-center justify-center"><Ionicons name="image-outline" size={22} color={C.muted} /></View>}
      <View className="flex-1 gap-1">
        <Badge k={k} text={i.status === 'Failed' ? 'Анализ не выполнен' : k === 'defect' ? `Дефектов: ${i.defectsCount}` : undefined} />
        <Text className={T.cap}>{fmtDate(i.createdAt)}{i.userName ? ` · ${i.userName}` : ''}</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={C.muted} />
    </Pressable>
  );
}
function EqInspectionsScreen({ equipmentId, onOpen }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.equipmentInspections(equipmentId).then(setItems).catch((e) => { setErr(e.message); setItems([]); }); }, [equipmentId]);
  return (
    <ScrollView contentContainerClassName="p-4 gap-3 pb-8">
      <ErrorBox text={err} />
      <View className={CARD}>
        {items === null && <ActivityIndicator color={C.primary} />}
        {items && !items.length && <Text className={T.cap}>Осмотров пока не было</Text>}
        {(items || []).map((i, n) => <InspectionRow key={i.id} i={i} onOpen={onOpen} last={n === items.length - 1} />)}
      </View>
    </ScrollView>
  );
}

// ----- оборудование: карточка -----
function EquipmentCard({ id, onInspect, onShoot, onComponent, onRecord, onJournal, onInspection, onAllInspections, onPhotoChanged, version }) {
  const [uploading, setUploading] = useState(false);
  const [photoErr, setPhotoErr] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [works, setWorks] = useState(null);
  useEffect(() => { api.getEquipment(id).then(setD).catch((e) => setErr(e.message)); }, [id, version]);
  useEffect(() => { api.maintenanceByEquipment(id).then(setWorks).catch(() => setWorks([])); }, [id, version]);
  const [insps, setInsps] = useState(null);
  useEffect(() => { api.equipmentInspections(id).then(setInsps).catch(() => setInsps([])); }, [id, version]);
  if (err) return <View className="p-4"><ErrorBox text={err} /></View>;
  if (!d) return <View className="p-8"><ActivityIndicator color={C.primary} /></View>;
  const rep = d.report;
  const k = reportStatus(rep.status);
  const setPhoto = async (fromCamera) => {
    setPhotoErr('');
    try {
      const opts = { mediaTypes: ['images'], quality: 0.5 };
      if (fromCamera && Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setPhotoErr('Нет доступа к камере. Разрешите его в настройках телефона.');
      }
      const r = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (r.canceled || !r.assets?.[0]) return;
      setUploading(true);
      const res = await api.uploadEquipmentPhoto(d.id, { uri: r.assets[0].uri });
      setD({ ...d, photoUrl: res.photoUrl });
      onPhotoChanged && onPhotoChanged(d, res.photoUrl);
    } catch (e) { setPhotoErr(e.message); }
    setUploading(false);
  };
  return (
    <ScrollView contentContainerClassName="p-4 gap-4 pb-8">
      <View className={CARD}>
        <Text className={T.title}>{d.name}</Text>
        <Badge k={k} />
        <Text className={T.body}>{rep.message}{rep.lastInspectionDate ? ` · ${fmtDate(rep.lastInspectionDate)}` : ''}</Text>
      </View>
      <CheckFirst d={d} onShoot={(c) => onShoot(d, c)} />
      <View className={CARD}>
        {d.photoUrl
          ? <Image source={{ uri: api.photoUrl(d.photoUrl) }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: C.sunken }} resizeMode="cover" />
          : (
            <View className="w-full rounded-xl bg-sunken items-center justify-center gap-2" style={{ aspectRatio: 16 / 9 }}>
              <Ionicons name="image-outline" size={36} color={C.muted} />
              <Text className={T.cap}>Фото оборудования нет</Text>
            </View>
          )}
        {uploading ? <ActivityIndicator color={C.primary} /> : (
          <View className="flex-row gap-2">
            <Secondary title={d.photoUrl ? 'Переснять' : 'Сфотографировать'} icon="camera-outline" onPress={() => setPhoto(true)} className="flex-1" />
            <Secondary title="Из галереи" icon="images-outline" onPress={() => setPhoto(false)} className="flex-1" />
          </View>
        )}
        <ErrorBox text={photoErr} />
      </View>
      <Primary title="Сделать фото и проверить" icon="camera" onPress={() => onInspect(d)} />
      {k === 'defect' && <Findings components={rep.defects} onComponent={(cid) => { const c = d.components.find((x) => x.id === cid); if (c) onComponent(c, d); }} />}
      <View className={CARD}>
        <Text className={T.bodyB}>Паспорт</Text>
        <View>
          <KV k="Тип" v={d.type} /><KV k="Модель" v={d.model} /><KV k="Производитель" v={d.manufacturer} />
          <KV k="Код (QR)" v={d.code} /><KV k="Серийный номер" v={d.serialNumber} /><KV k="Место" v={d.location} />
          <KV k="Установлено" v={d.installedAt} last />
        </View>
        {!!d.description && <Text className={T.cap}>{d.description}</Text>}
      </View>
      <View className={CARD}>
        <Text className={T.bodyB}>Узлы и ресурс</Text>
        {d.components.map((c, i) => {
          const life = lifeLeft(c, d.installedAt);
          const k = life ? life.k : 'none';
          return (
            <Pressable key={c.id} onPress={() => onComponent(c, d)}
              className={`flex-row items-center gap-3 py-3 active:opacity-60 ${i === d.components.length - 1 ? '' : 'border-b border-divider'}`}>
              <View className={`w-3 h-3 rounded-full`} style={{ backgroundColor: ST[k].color }} />
              <View className="flex-1 gap-0.5">
                <Text className={T.body}>{c.name}</Text>
                <Text className={T.cap}>{life ? life.text : 'Срок службы не задан'}{c.lastReplacedAt ? ` · замена ${c.lastReplacedAt}` : ''}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={C.muted} />
            </Pressable>
          );
        })}
        <Secondary title="Записать работу" icon="create-outline" onPress={() => onRecord(d, null)} />
      </View>
      <View className={CARD}>
        <View className="flex-row items-center justify-between">
          <Text className={T.bodyB}>Осмотры</Text>
          {insps && insps.length > 5 && (
            <Pressable onPress={() => onAllInspections(d)} hitSlop={8} className="min-h-[44px] justify-center"><Text className="text-[16px] text-primary font-semibold">Все осмотры ({insps.length})</Text></Pressable>
          )}
        </View>
        {insps === null && <ActivityIndicator color={C.primary} />}
        {insps && !insps.length && <Text className={T.cap}>Осмотров пока не было</Text>}
        {(insps || []).slice(0, 5).map((i, n, arr) => <InspectionRow key={i.id} i={i} onOpen={(x) => onInspection(d, x)} last={n === arr.length - 1} />)}
      </View>
      <View className={CARD}>
        <View className="flex-row items-center justify-between">
          <Text className={T.bodyB}>Журнал работ</Text>
          {works && works.length > 5 && (
            <Pressable onPress={() => onJournal(d)} hitSlop={8} className="min-h-[44px] justify-center"><Text className="text-[16px] text-primary font-semibold">Весь журнал</Text></Pressable>
          )}
        </View>
        <WorkList items={works && works.slice(0, 5)} showComponent />
      </View>
      {d.defectTypes.length > 0 && (
        <View className={CARD}>
          <Text className={T.bodyB}>Что проверяет ИИ у этого типа</Text>
          {d.defectTypes.map((t) => <Text key={t.code} className={T.body}>• {t.name}</Text>)}
        </View>
      )}
    </ScrollView>
  );
}

// ----- анализ и результат -----
function ResultView({ result, photo, onRetry, onBack, onRecord, onComponent }) {
  const s = result.summary;
  if (s.status === 'Failed') {
    return (
      <ScrollView contentContainerClassName="p-4 gap-4">
        <View className={`${CARD} bg-check-bg border-check`}>
          <Badge k="check" text="Анализ не выполнен" />
          <Text className={T.body}>Сервис анализа фото не ответил. Проверьте, что он запущен, и попробуйте ещё раз.</Text>
        </View>
        {photo && <PhotoBoxes photo={photo} findings={[]} />}
        {onRetry && <Primary title="Повторить" icon="refresh" onPress={onRetry} />}
        <Secondary title="Назад" onPress={onBack} />
      </ScrollView>
    );
  }
  const k = reportStatus(s.result);
  const openComp = onComponent ? (cid) => onComponent(s.equipmentId, cid) : null;
  const flat = [];
  (result.components || []).forEach((c) => (c.findings || []).forEach((f) => flat.push({ ...f, componentName: c.componentName, componentId: c.componentId })));
  return (
    <ScrollView contentContainerClassName="p-4 gap-4 pb-8">
      <View className={`rounded-xl p-4 gap-2 ${ST[k].soft}`}>
        <View className="flex-row items-center gap-2">
          <Ionicons name={ST[k].icon} size={32} color={ST[k].color} />
          <Text className={`text-[24px] font-semibold ${ST[k].text}`}>{k === 'defect' ? `Найдено: ${s.defectsCount}` : ST[k].word}</Text>
        </View>
        <Text className={T.body}>{s.equipmentName} · {fmtDate(s.createdAt)}</Text>
      </View>
      {photo && <PhotoBoxes photo={photo} findings={flat} onComponent={openComp} />}
      {photo && flat.some((f) => f.boxWidth > 0 && f.category !== 'NoVisibleProblems') && onComponent && <Text className={`${T.cap} text-center`}>Нажмите на рамку, чтобы открыть узел</Text>}
      <Findings components={result.components} onComponent={openComp} />
      {onRecord && k === 'defect' && (
        <Primary title="Записать работу по узлу" icon="create" onPress={() => {
          const c = (result.components || []).find((x) => (x.findings || []).some((f) => f.category !== 'NoVisibleProblems'));
          onRecord(s.equipmentId, c ? c.componentId : null);
        }} />
      )}
      <Text className={`${T.cap} text-center`}>Предварительный осмотр. Решение принимает инженер.</Text>
      <Secondary title="Готово" icon="checkmark" onPress={onBack} />
    </ScrollView>
  );
}

function Analyze({ photo, target, onBack, onRecord, onComponent }) {
  const [state, setState] = useState({ busy: true, result: null, err: '' });
  const run = useCallback(async () => {
    setState({ busy: true, result: null, err: '' });
    try { setState({ busy: false, result: await api.createInspection(photo, target.value, target.method), err: '' }); }
    catch (e) { setState({ busy: false, result: null, err: e.message }); }
  }, [photo, target]);
  useEffect(() => { run(); }, [run]);
  if (state.busy) {
    return (
      <View className="flex-1 items-center justify-center p-6 gap-4">
        <View className="w-full"><PhotoBoxes photo={photo} findings={[]} /></View>
        <ActivityIndicator size="large" color={C.primary} />
        <Text className={T.title}>ИИ анализирует фото…</Text>
        <Text className={`${T.cap} text-center`}>Обычно это занимает несколько секунд</Text>
      </View>
    );
  }
  if (state.err) {
    return (
      <View className="p-4 gap-4">
        <ErrorBox text={state.err} />
        <Primary title="Повторить" icon="refresh" onPress={run} />
        <Secondary title="Назад" onPress={onBack} />
      </View>
    );
  }
  return <ResultView result={state.result} photo={photo} onRetry={run} onBack={onBack} onRecord={onRecord} onComponent={onComponent} />;
}

// ----- история -----
function History({ onOpen }) {
  const [seg, setSeg] = useState('inspections');
  return (
    <View className="flex-1">
      <View className="flex-row mx-4 mt-4 p-1 bg-sunken rounded-xl">
        {[['inspections', 'Осмотры'], ['works', 'Мои работы']].map(([k, w]) => (
          <Pressable key={k} onPress={() => setSeg(k)} className={`flex-1 h-11 rounded-lg items-center justify-center ${seg === k ? 'bg-surface' : ''}`}>
            <Text className={`text-[16px] ${seg === k ? 'text-primary font-semibold' : 'text-muted'}`}>{w}</Text>
          </Pressable>
        ))}
      </View>
      {seg === 'inspections' ? <Inspections onOpen={onOpen} /> : <MyWorks />}
    </View>
  );
}
function MyWorks() {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(null);
  const load = useCallback(() => api.myMaintenance().then(setItems).catch((e) => { setErr(e.message); setItems([]); }), []);
  useEffect(() => { load(); }, [load]);
  const del = async () => {
    try { await api.deleteMaintenance(confirm.id); setConfirm(null); load(); } catch (e) { setErr(e.message); setConfirm(null); }
  };
  return (
    <ScrollView contentContainerClassName="p-4 gap-3 pb-8">
      <ErrorBox text={err} />
      {confirm && (
        <View className={`${CARD} border-defect`}>
          <Text className={T.body}>Удалить запись «{(MAINT[confirm.type] || {}).word}: {confirm.componentName}»?</Text>
          <View className="flex-row gap-3">
            <Pressable onPress={del} className="flex-1 h-12 rounded-xl bg-defect items-center justify-center"><Text className="text-[17px] font-semibold text-white">Удалить</Text></Pressable>
            <Secondary title="Отмена" onPress={() => setConfirm(null)} className="flex-1" />
          </View>
        </View>
      )}
      <View className={CARD}><WorkList items={items} showComponent="equipment" onDelete={setConfirm} empty="Вы ещё не записывали работы" /></View>
    </ScrollView>
  );
}
function Inspections({ onOpen }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setErr('');
    try { setItems((await api.myInspections()).items); } catch (e) { setErr(e.message); if (!items) setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <FlatList
      data={items || []}
      keyExtractor={(i) => String(i.id)}
      contentContainerClassName="p-4 gap-3 pb-8"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={<View className="gap-3">{items === null && <ActivityIndicator color={C.primary} />}<ErrorBox text={err} /></View>}
      ListEmptyComponent={items && !err ? (
        <View className="items-center gap-3 py-10"><Ionicons name="document-text-outline" size={40} color={C.muted} /><Text className={`${T.body} text-center`}>Здесь появятся ваши осмотры</Text></View>
      ) : null}
      renderItem={({ item: i }) => {
        const k = i.status === 'Failed' ? 'check' : reportStatus(i.result);
        return (
          <Pressable onPress={() => onOpen(i.id)} className={`${CARD} active:opacity-70`}>
            <View className="flex-row items-center gap-3">
              {!!i.photoPath && <Image source={{ uri: api.photoUrl(i.photoPath) }} style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: C.sunken }} />}
              <View className="flex-1 gap-0.5">
                <Text className={T.bodyB}>{i.equipmentName}</Text>
                <Text className={T.cap}>{fmtDate(i.createdAt)} · {i.equipmentCode}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={C.muted} />
            </View>
            <Badge k={k} text={i.status === 'Failed' ? 'Анализ не выполнен' : k === 'defect' ? `Дефектов: ${i.defectsCount}` : undefined} />
          </Pressable>
        );
      }}
    />
  );
}
function InspectionView({ id, equipmentId, onBack, onComponent }) {
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  const [size, setSize] = useState(null);
  useEffect(() => {
    (equipmentId ? api.getEquipmentInspection(equipmentId, id) : api.getInspection(id)).then(setR).catch((e) => setErr(e.message));
  }, [id, equipmentId]);
  // Фото осмотра с сервера: узнаём размер, чтобы рамки легли точно.
  useEffect(() => {
    const uri = r && api.photoUrl(r.photoPath);
    if (!uri) return;
    Image.getSize(uri, (w, h) => setSize({ uri, width: w, height: h }), () => setSize({ uri, width: 4, height: 3 }));
  }, [r]);
  if (err) return <View className="p-4"><ErrorBox text={err} /></View>;
  if (!r) return <View className="p-8"><ActivityIndicator color={C.primary} /></View>;
  return <ResultView result={r} onBack={onBack} photo={size} onComponent={onComponent} />;
}

// ----- профиль -----
function Profile({ user, onLogout }) {
  const [url, setUrl] = useState(api.getBaseUrl());
  const [saved, setSaved] = useState(false);
  return (
    <ScrollView contentContainerClassName="p-4 gap-4" keyboardShouldPersistTaps="handled">
      <View className={CARD}>
        <View className="flex-row items-center gap-3">
          <Ionicons name="person-circle" size={56} color={C.primary} />
          <View className="flex-1"><Text className={T.bodyB}>{user.name}</Text><Text className={T.cap}>{user.email}</Text></View>
        </View>
        <Secondary title="Выйти" icon="log-out-outline" onPress={onLogout} />
      </View>
      <View className={CARD}>
        <Text className={T.bodyB}>Адрес сервера</Text>
        <Field value={url} onChangeText={(v) => { setUrl(v); setSaved(false); }} keyboardType="url" placeholder="http://192.168.1.10:5176" />
        <Secondary title={saved ? 'Сохранено' : 'Сохранить'} icon="save-outline" onPress={async () => { await api.setBaseUrl(url); setSaved(true); }} />
        <Text className={T.cap}>Телефон и компьютер с сервером должны быть в одной сети Wi-Fi.</Text>
      </View>
    </ScrollView>
  );
}

// Ручной выбор, если QR или номер не распознались (п. 4.1 ТЗ).
function ManualPick({ onPick }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.listEquipment().then(setItems).catch((e) => { setErr(e.message); setItems([]); }); }, []);
  return (
    <ScrollView contentContainerClassName="p-4 gap-3 pb-8">
      <ErrorBox text={err} />
      {items === null && <ActivityIndicator color={C.primary} />}
      {(items || []).map((e) => (
        <Pressable key={e.id} onPress={() => onPick(e)} className={`${CARD} active:opacity-70`}>
          <Text className={T.bodyB}>{e.name}</Text>
          <Text className={T.cap}>{e.model} · {e.code}{e.location ? ` · ${e.location}` : ''}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function JournalScreen({ equipmentId }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.maintenanceByEquipment(equipmentId).then(setItems).catch((e) => { setErr(e.message); setItems([]); }); }, [equipmentId]);
  return <ScrollView contentContainerClassName="p-4 gap-3 pb-8"><ErrorBox text={err} /><View className={CARD}><WorkList items={items} showComponent /></View></ScrollView>;
}

// ----- приложение -----
const TABS = [['equipment', 'Оборудование', 'construct-outline'], ['history', 'История', 'time-outline'], ['profile', 'Профиль', 'person-outline']];

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('equipment');
  const [stack, setStack] = useState([]); // экраны поверх вкладок: {kind, ...}
  const [camera, setCamera] = useState(null); // {mode, target}
  const [version, setVersion] = useState(0); // меняется после записи работы, чтобы карточка и журнал перечитались
  const { bottom } = useSafeAreaInsets();

  const logout = useCallback(async () => { await api.clearSession(); setStack([]); setUser(null); }, []);
  useEffect(() => {
    api.setUnauthorizedHandler(() => { api.clearSession(); setStack([]); setUser(null); });
    api.restoreSession().then((u) => { setUser(u); setReady(true); });
  }, []);
  const push = (s) => setStack((st) => [...st, s]);
  const pop = () => setStack((st) => st.slice(0, -1));
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (camera) { setCamera(null); return true; }
      if (stack.length) { pop(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack, camera]);

  if (!ready) return <View className="flex-1 bg-primary items-center justify-center"><ActivityIndicator color="#fff" size="large" /></View>;
  if (!user) return <AuthScreen onDone={setUser} />;
  if (!user.verified) return <VerifyScreen user={user} onDone={setUser} onLogout={logout} />;

  // Фото: камера или галерея, затем анализ.
  const startInspection = (target) => push({ kind: 'choose', target });
  const fromGallery = async (target) => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setStack((st) => [...st.filter((s) => s.kind !== 'choose'), { kind: 'analyze', photo: { uri: a.uri, width: a.width, height: a.height }, target }]);
  };

  // Узел из результата осмотра: подгружаем карточку, чтобы знать ресурс и журнал.
  const openComponent = async (equipmentId, cid) => {
    try {
      const d = await api.getEquipment(equipmentId);
      const c = d.components.find((x) => x.id === cid);
      if (!c) throw new Error('Узел не найден');
      push({ kind: 'component', component: c, eqInstalled: d.installedAt, equipmentId: d.id, components: d.components, report: d.report });
    } catch (e) { push({ kind: 'error', text: e.message }); }
  };

  // Найдено по QR или номеру: запоминаем у пользователя и открываем карточку.
  async function onFound(report, value, method) {
    const e = report.equipment;
    await api.addRecent(user.email, { id: e.id, code: e.code, name: e.name, model: e.model, method, photoUrl: e.photoUrl });
    setVersion((x) => x + 1);
    push({ kind: 'card', id: e.id, target: { value, method } });
  }

  if (camera) {
    return (
      <CameraScreen mode={camera.mode} hint={camera.target?.hint || camera.target?.name}
        onClose={() => setCamera(null)}
        onQr={async (v) => {
          setCamera(null);
          const code = api.cleanCode(v);
          try { await onFound(await api.identify(code), code, 'QrCode'); }
          catch (e) { push({ kind: 'error', text: e.message }); }
        }}
        onPhoto={(p) => {
          const target = camera.target;
          setCamera(null);
          setStack((st) => [...st.filter((s) => s.kind !== 'choose'), { kind: 'analyze', photo: p, target }]);
        }} />
    );
  }

  const top = stack[stack.length - 1];
  if (top) {
    let title = '';
    let body = null;
    if (top.kind === 'card') {
      title = 'Карточка оборудования';
      body = <EquipmentCard id={top.id} version={version}
        onInspect={(d) => startInspection({ ...top.target, value: top.target?.value || d.code, name: d.name })}
        onShoot={(d, c) => setCamera({ mode: 'photo', target: { ...top.target, value: top.target?.value || d.code, name: d.name, hint: `Наведите камеру на: ${c.name}` } })}
        onComponent={(c, d) => push({ kind: 'component', component: c, eqInstalled: d.installedAt, equipmentId: d.id, components: d.components, report: d.report })}
        onRecord={(d, cid) => push({ kind: 'record', components: d.components, preset: cid })}
        onJournal={(d) => push({ kind: 'journal', equipmentId: d.id })}
        onInspection={(d, i) => push({ kind: 'inspection', id: i.id, equipmentId: d.id })}
        onAllInspections={(d) => push({ kind: 'eqInspections', equipmentId: d.id })}
        onPhotoChanged={(d, url) => api.addRecent(user.email, { id: d.id, code: d.code, name: d.name, model: d.model, method: top.target?.method || 'Manual', photoUrl: url })} />;
    } else if (top.kind === 'component') {
      title = 'Узел';
      body = <ComponentScreen component={top.component} eqInstalled={top.eqInstalled} version={version}
        onRecord={(c) => push({ kind: 'record', components: top.components, preset: c.id })} />;
    } else if (top.kind === 'record') {
      title = 'Записать работу';
      body = <RecordWork components={top.components} preset={top.preset} onSaved={() => { setVersion((v) => v + 1); pop(); }} />;
    } else if (top.kind === 'journal') {
      title = 'Журнал работ';
      body = <JournalScreen equipmentId={top.equipmentId} />;
    } else if (top.kind === 'choose') {
      title = 'Новый осмотр';
      body = (
        <View className="p-4 gap-4">
          <View className={CARD}>
            <Text className={T.title}>{top.target.name}</Text>
            <Text className={T.body}>Сфотографируйте узел. ИИ найдёт видимые дефекты и подскажет, что делать.</Text>
          </View>
          <Primary title="Открыть камеру" icon="camera" onPress={() => setCamera({ mode: 'photo', target: top.target })} />
          <Secondary title="Выбрать из галереи" icon="images-outline" onPress={() => fromGallery(top.target)} />
        </View>
      );
    } else if (top.kind === 'analyze') {
      title = 'Результат осмотра';
      body = <Analyze photo={top.photo} target={top.target} onBack={() => setStack([])}
        onRecord={async (equipmentId, cid) => {
          try { const d = await api.getEquipment(equipmentId); push({ kind: 'record', components: d.components, preset: cid }); }
          catch (e) { push({ kind: 'error', text: e.message }); }
        }}
        onComponent={openComponent} />;
    } else if (top.kind === 'inspection') {
      title = 'Осмотр';
      body = <InspectionView id={top.id} equipmentId={top.equipmentId} onBack={pop} onComponent={openComponent} />;
    } else if (top.kind === 'eqInspections') {
      title = 'Осмотры оборудования';
      body = <EqInspectionsScreen equipmentId={top.equipmentId} onOpen={(i) => push({ kind: 'inspection', id: i.id, equipmentId: top.equipmentId })} />;
    } else if (top.kind === 'error') {
      title = 'Ошибка';
      body = (
        <View className="p-4 gap-4">
          <ErrorBox text={top.text} />
          <Secondary title="Назад" onPress={pop} />
          <Pressable onPress={() => setStack((st) => [...st.slice(0, -1), { kind: 'manual' }])} className="self-center min-h-[44px] justify-center">
            <Text className="text-[16px] text-primary underline">Не получается? Выбрать вручную</Text>
          </Pressable>
        </View>
      );
    } else if (top.kind === 'manual') {
      title = 'Выбор оборудования';
      body = <ManualPick onPick={(e) => { setStack((st) => st.slice(0, -1)); onFound({ equipment: e }, e.code, 'Manual'); }} />;
    }
    return (
      <View className="flex-1 bg-bg">
        <StatusBar barStyle="light-content" backgroundColor={C.primary} />
        <Header title={title} onBack={pop} />
        {body}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <StatusBar barStyle="light-content" backgroundColor={C.primary} />
      <Header title={TABS.find((t) => t[0] === tab)[1]} />
      <View className="flex-1">
        {tab === 'equipment' && <FindEquipment user={user} version={version} onFound={onFound} onScan={() => setCamera({ mode: 'qr' })} onManual={() => push({ kind: 'manual' })} />}
        {tab === 'history' && <History onOpen={(id) => push({ kind: 'inspection', id })} />}
        {tab === 'profile' && <Profile user={user} onLogout={logout} />}
      </View>
      <View className="flex-row bg-surface border-t border-divider" style={{ paddingBottom: Math.max(bottom, 8) }}>
        {TABS.map(([id, title, icon]) => {
          const on = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              className="flex-1 items-center justify-center min-h-[64px] pt-2">
              <View className={`w-16 h-8 rounded-full items-center justify-center ${on ? 'bg-primary-soft' : ''}`}>
                <Ionicons name={on ? icon.replace('-outline', '') : icon} size={24} color={on ? C.primary : C.muted} />
              </View>
              <Text className={`text-[14px] mt-0.5 ${on ? 'text-primary font-semibold' : 'text-muted'}`}>{title}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
