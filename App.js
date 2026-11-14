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
  ok: { word: 'В порядке', icon: 'checkmark-circle', color: C.ok, soft: 'bg-ok-bg', text: 'text-ok' },
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
  const submit = async () => {
    if (!f.email.trim() || !f.password) return setErr('Введите почту и пароль');
    if (mode === 'register' && !f.name.trim()) return setErr('Введите имя');
    setBusy(true);
    try {
      const u = mode === 'login' ? await api.login(f.email.trim(), f.password) : await api.register(f.name.trim(), f.email.trim(), f.password);
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
            <Field label="Почта" icon="mail-outline" value={f.email} onChangeText={set('email')} keyboardType="email-address" placeholder="name@company.ru" />
            <Field label="Пароль" icon="lock-closed-outline" secure value={f.password} onChangeText={set('password')} placeholder="Пароль" onSubmitEditing={submit} />
            <ErrorBox text={err} />
            <Primary title={reg ? 'Зарегистрироваться' : 'Войти'} onPress={submit} busy={busy} />
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
    try { const p = await cam.current.takePictureAsync({ quality: 0.7 }); onPhoto({ uri: p.uri, width: p.width, height: p.height }); }
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
function PhotoBoxes({ photo, findings }) {
  const ratio = (photo.width || 4) / (photo.height || 3);
  const boxes = findings.filter((f) => f.boxWidth > 0 && f.boxHeight > 0);
  return (
    <View className="w-full bg-sunken rounded-xl overflow-hidden" style={{ aspectRatio: ratio }}>
      <Image source={{ uri: photo.uri }} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} resizeMode="contain" />
      {boxes.map((f, i) => {
        const c = ST[(CATEGORY[f.category] || CATEGORY.CheckRecommended).key];
        return (
          <View key={i} className="absolute border-[3px] rounded" style={{
            borderColor: c.color, left: `${f.boxX * 100}%`, top: `${f.boxY * 100}%`,
            width: `${Math.min(f.boxWidth, 1 - f.boxX) * 100}%`, height: `${Math.min(f.boxHeight, 1 - f.boxY) * 100}%`,
          }}>
            <View className="absolute left-[-3px] h-6 px-2 justify-center rounded" style={{ backgroundColor: c.color, top: f.boxY > 0.08 ? -25 : 0 }}>
              <Text numberOfLines={1} className="text-white text-[13px] font-semibold">{f.defectName || f.componentName}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Находки по узлам: название, уверенность, пояснение, рекомендация.
function Findings({ components }) {
  const rows = [];
  (components || []).forEach((c) => (c.findings || []).forEach((f) => rows.push({ ...f, componentName: c.componentName })));
  const problems = rows.filter((f) => f.category !== 'NoVisibleProblems');
  if (!problems.length) {
    return <View className={CARD}><Badge k="ok" text="Видимых проблем не обнаружено" /><Text className={T.cap}>Это предварительный осмотр, он не подтверждает исправность.</Text></View>;
  }
  return problems.map((f, i) => {
    const cat = CATEGORY[f.category] || CATEGORY.CheckRecommended;
    return (
      <View key={i} className={CARD}>
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 gap-0.5">
            <Text className={T.bodyB}>{f.defectName || 'Признак дефекта'}</Text>
            <Text className={T.cap}>Узел: {f.componentName}</Text>
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
      </View>
    );
  });
}

// ----- оборудование: список -----
function EquipmentList({ onOpen, onScan }) {
  const [items, setItems] = useState(null);
  const [search, setSearch] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (q) => {
    setErr('');
    try { setItems(await api.listEquipment(q)); } catch (e) { setErr(e.message); if (!items) setItems([]); }
  }, []);
  useEffect(() => { const t = setTimeout(() => load(search.trim()), 300); return () => clearTimeout(t); }, [search, load]);
  const byCode = async () => {
    const v = code.trim();
    if (!v) return;
    try { const r = await api.identify(v); onOpen(r.equipment.id, { value: v, method: 'SerialNumber' }); }
    catch (e) { setErr(e.message); }
  };
  return (
    <FlatList
      data={items || []}
      keyExtractor={(e) => String(e.id)}
      contentContainerClassName="p-4 gap-3 pb-8"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(search.trim()); setRefreshing(false); }} />}
      ListHeaderComponent={(
        <View className="gap-3 mb-1">
          <Primary title="Сканировать QR-код" icon="qr-code-outline" onPress={onScan} />
          <View className="flex-row gap-2">
            <View className="flex-1"><Field icon="barcode-outline" value={code} onChangeText={setCode} placeholder="Код или серийный номер" onSubmitEditing={byCode} autoCapitalize="characters" /></View>
            <Secondary title="Найти" onPress={byCode} />
          </View>
          <Field icon="search-outline" value={search} onChangeText={setSearch} placeholder="Поиск по названию или модели" />
          <ErrorBox text={err} />
          {items === null && <ActivityIndicator color={C.primary} />}
        </View>
      )}
      ListEmptyComponent={items && !err ? <Text className={`${T.body} text-center text-muted py-8`}>Оборудование не найдено</Text> : null}
      renderItem={({ item: e }) => {
        const k = reportStatus(e.status);
        return (
          <Pressable onPress={() => onOpen(e.id, { value: e.code, method: 'Manual' })} className={`${CARD} active:opacity-70`}>
            <View className="flex-row items-start gap-3">
              <View className={`w-11 h-11 rounded-full items-center justify-center ${ST[k].soft}`}>
                <Ionicons name={ST[k].icon} size={24} color={ST[k].color} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className={T.bodyB}>{e.name}</Text>
                <Text className={T.cap}>{e.model} · {e.code}</Text>
                {!!e.location && <Text className={T.cap}>{e.location}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={22} color={C.muted} />
            </View>
            <Badge k={k} text={k === 'defect' ? `Есть дефекты: ${e.defectsCount}` : undefined} />
          </Pressable>
        );
      }}
    />
  );
}

// ----- оборудование: карточка -----
function EquipmentCard({ id, onInspect }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.getEquipment(id).then(setD).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <View className="p-4"><ErrorBox text={err} /></View>;
  if (!d) return <View className="p-8"><ActivityIndicator color={C.primary} /></View>;
  const rep = d.report;
  const k = reportStatus(rep.status);
  return (
    <ScrollView contentContainerClassName="p-4 gap-4 pb-8">
      <View className={CARD}>
        <Text className={T.title}>{d.name}</Text>
        <Badge k={k} />
        <Text className={T.body}>{rep.message}{rep.lastInspectionDate ? ` · ${fmtDate(rep.lastInspectionDate)}` : ''}</Text>
      </View>
      <Primary title="Сделать фото и проверить" icon="camera" onPress={() => onInspect(d)} />
      {k === 'defect' && <Findings components={rep.defects} />}
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
        <Text className={T.bodyB}>Узлы</Text>
        {d.components.map((c, i) => (
          <View key={c.id} className={`py-2 ${i === d.components.length - 1 ? '' : 'border-b border-divider'}`}>
            <Text className={T.body}>{c.name}</Text>
            <Text className={T.cap}>
              {c.serviceLifeMonths ? `Срок службы ${c.serviceLifeMonths} мес.` : 'Срок службы не задан'}
              {c.lastReplacedAt ? ` · замена ${c.lastReplacedAt}` : c.installedAt ? ` · установлен ${c.installedAt}` : ''}
            </Text>
          </View>
        ))}
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
function ResultView({ result, photo, onRetry, onBack }) {
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
  const flat = [];
  (result.components || []).forEach((c) => (c.findings || []).forEach((f) => flat.push({ ...f, componentName: c.componentName })));
  return (
    <ScrollView contentContainerClassName="p-4 gap-4 pb-8">
      <View className={`rounded-xl p-4 gap-2 ${ST[k].soft}`}>
        <View className="flex-row items-center gap-2">
          <Ionicons name={ST[k].icon} size={32} color={ST[k].color} />
          <Text className={`text-[24px] font-semibold ${ST[k].text}`}>{k === 'defect' ? `Найдено: ${s.defectsCount}` : ST[k].word}</Text>
        </View>
        <Text className={T.body}>{s.equipmentName} · {fmtDate(s.createdAt)}</Text>
      </View>
      {photo && <PhotoBoxes photo={photo} findings={flat} />}
      <Findings components={result.components} />
      <Text className={`${T.cap} text-center`}>Предварительный осмотр. Решение принимает инженер.</Text>
      <Secondary title="Готово" icon="checkmark" onPress={onBack} />
    </ScrollView>
  );
}

function Analyze({ photo, target, onBack }) {
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
  return <ResultView result={state.result} photo={photo} onRetry={run} onBack={onBack} />;
}

// ----- история -----
function History({ onOpen }) {
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
function InspectionView({ id, onBack }) {
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.getInspection(id).then(setR).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <View className="p-4"><ErrorBox text={err} /></View>;
  if (!r) return <View className="p-8"><ActivityIndicator color={C.primary} /></View>;
  return <ResultView result={r} onBack={onBack} />;
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

// ----- приложение -----
const TABS = [['equipment', 'Оборудование', 'construct-outline'], ['history', 'История', 'time-outline'], ['profile', 'Профиль', 'person-outline']];

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('equipment');
  const [stack, setStack] = useState([]); // экраны поверх вкладок: {kind, ...}
  const [camera, setCamera] = useState(null); // {mode, target}
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
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setStack((st) => [...st.filter((s) => s.kind !== 'choose'), { kind: 'analyze', photo: { uri: a.uri, width: a.width, height: a.height }, target }]);
  };

  if (camera) {
    return (
      <CameraScreen mode={camera.mode} hint={camera.target?.name}
        onClose={() => setCamera(null)}
        onQr={async (v) => {
          setCamera(null);
          try { const r = await api.identify(v.trim()); push({ kind: 'card', id: r.equipment.id, target: { value: v.trim(), method: 'QrCode' } }); }
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
      body = <EquipmentCard id={top.id} onInspect={(d) => startInspection({ ...top.target, value: top.target?.value || d.code, name: d.name })} />;
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
      body = <Analyze photo={top.photo} target={top.target} onBack={() => setStack([])} />;
    } else if (top.kind === 'inspection') {
      title = 'Осмотр';
      body = <InspectionView id={top.id} onBack={pop} />;
    } else if (top.kind === 'error') {
      title = 'Ошибка';
      body = <View className="p-4 gap-4"><ErrorBox text={top.text} /><Secondary title="Назад" onPress={pop} /></View>;
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
        {tab === 'equipment' && <EquipmentList onOpen={(id, target) => push({ kind: 'card', id, target })} onScan={() => setCamera({ mode: 'qr' })} />}
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
