// MaintAR: AR-помощник инженера для диагностики промышленного оборудования.
// Всё работает на телефоне без сервера: правила, датчики из базы кейса, карточки, ресурс, история.
// Дефекты на фото определяет сервис анализа (адрес задаётся в профиле). Ручная правка нужна, только если ИИ ошибся.
// Стили: Tailwind через NativeWind (className). Палитра в src/theme.js, inline style только для значений, вычисляемых на лету.
// Интерфейс намеренно простой: на экране одно главное действие, детали по нажатию, демо-инструменты в «Режиме демонстрации».
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Dimensions, Image, Modal, Platform, Pressable, ScrollView, StatusBar, Switch, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import AuthScreen, { Splash } from './src/AuthScreen';
import { currentUser, logout } from './src/auth';
import { colors as C } from './src/theme';
import { UNITS, SCENARIOS, SAMPLES } from './src/data/units';
import {
  RULES, SENS, SERIES, RULE_COMP, STATUS_TEXT, STATUS_SHORT, buildModel, cleanVision, fmtDate, fmtTs, num, sensorTime, sensorsAt,
} from './src/engine';

const TABS = [['inspect', 'Осмотр', 'scan-outline'], ['unit', 'Оборудование', 'construct-outline'], ['history', 'История', 'time-outline']];
const ACTIONS = { inspection: 'Осмотр', checked: 'Проверено', defect: 'Дефект', replaced: 'Заменено' };
const ACTION_STATUS = { checked: 'ok', defect: 'defect', replaced: 'primary' };
const SRC_TEXT = { 'камера': 'по фото', 'датчики': 'по датчикам', 'камера + датчики': 'фото и датчики' };
const RANK = { defect: 2, check: 1, ok: 0 };

// Классы по статусу. Строки написаны целиком, чтобы Tailwind их нашёл при сборке.
const ST = {
  ok: { text: 'text-ok', bg: 'bg-ok', soft: 'bg-ok-bg', border: 'border-ok', borderL: 'border-l-ok' },
  check: { text: 'text-check', bg: 'bg-check', soft: 'bg-check-bg', border: 'border-check', borderL: 'border-l-check' },
  defect: { text: 'text-defect', bg: 'bg-defect', soft: 'bg-defect-bg', border: 'border-defect', borderL: 'border-l-defect' },
  primary: { text: 'text-primary', bg: 'bg-primary', soft: 'bg-primary-soft', border: 'border-primary', borderL: 'border-l-primary' },
};
const NONE = { text: 'text-muted', bg: 'bg-muted', soft: 'bg-sunken', border: 'border-line', borderL: 'border-l-line' };
const st = (status) => ST[status] || NONE;

// Типографика: основной текст не меньше 16.
const T = {
  h1: 'text-[22px] font-bold text-fg',
  h2: 'text-[18px] font-bold text-fg',
  h3: 'text-[17px] font-semibold text-fg',
  body: 'text-[16px] leading-[23px] text-fg',
  muted: 'text-[16px] leading-[23px] text-muted',
  small: 'text-[14px] leading-[20px] text-muted',
  faint: 'text-[13px] leading-[18px] text-faint',
};
const BETWEEN = 'flex-row items-center justify-between gap-3';
const CARD = 'bg-surface rounded-2xl p-4 gap-3 border border-divider';
const INPUT = 'border border-line rounded-xl p-3 text-[16px] text-fg bg-surface';

const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 50;
const BOTTOM = (() => {
  if (Platform.OS === 'ios') return 24;
  const scr = Dimensions.get('screen').height;
  const win = Dimensions.get('window').height;
  const nav = scr - win - (StatusBar.currentHeight || 0);
  return Math.max(20, Math.min(nav, 56));
})();

async function load(key, fallback) {
  try { const v = await AsyncStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function save(key, value) { AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {}); }

// Порядок находок: сначала комбинированные выводы, затем дефекты, затем «проверить».
const sortFindings = (list) => [...list].sort((a, b) =>
  (b.combined ? 1 : 0) - (a.combined ? 1 : 0) || RANK[b.status] - RANK[a.status]);
// Короткий текст ресурса для строки узла.
const shortRes = (res) => (res.kind === 'calc' ? (res.rem <= 0 ? 'ресурс исчерпан' : `ост. ${num(res.rem, 0)} ч`) : res.kind === 'nodata' ? 'нет данных' : 'по состоянию');

/* ---------- мелкие элементы ---------- */
function Pill({ status, text, big }) {
  const c = st(status);
  return (
    <View className={`flex-row items-center gap-1.5 rounded-full ${big ? 'px-3.5 py-1.5' : 'px-2.5 py-1'} ${c.soft}`}>
      <View className={`w-2 h-2 rounded-full ${c.bg}`} />
      <Text className={`font-bold ${big ? 'text-[16px]' : 'text-[14px]'} ${c.text}`}>{text || STATUS_SHORT[status]}</Text>
    </View>
  );
}
const Dot = ({ status }) => <View className={`w-3 h-3 rounded-full ${st(status).bg}`} />;

const BTN = {
  primary: { box: 'bg-primary border-primary min-h-[56px]', text: 'text-white text-[17px]', icon: '#fff' },
  secondary: { box: 'bg-surface border-line', text: 'text-fg', icon: C.fg },
  danger: { box: 'bg-surface border-defect', text: 'text-defect', icon: C.defect },
  dark: { box: 'bg-white/15 border-white/35', text: 'text-white', icon: '#fff' },
};
function Btn({ title, icon, onPress, kind = 'secondary', disabled, className = '' }) {
  const k = BTN[kind] || BTN.secondary;
  return (
    <Pressable onPress={onPress} disabled={disabled}
      className={`min-h-[50px] px-4 py-2.5 rounded-xl border items-center justify-center active:opacity-80 ${k.box} ${disabled ? 'opacity-[0.45]' : ''} ${className}`}>
      <View className="flex-row items-center gap-2">
        {!!icon && <Ionicons name={icon} size={22} color={k.icon} />}
        <Text className={`font-semibold text-center text-[16px] ${k.text}`}>{title}</Text>
      </View>
    </Pressable>
  );
}
function Chip({ title, active, onPress }) {
  return (
    <Pressable onPress={onPress}
      className={`border rounded-full px-3.5 py-2.5 active:opacity-80 ${active ? 'bg-primary border-primary' : 'bg-surface border-line'}`}>
      <Text className={`text-[15px] ${active ? 'text-white font-semibold' : 'text-fg'}`}>{title}</Text>
    </Pressable>
  );
}
function Link({ title, icon, onPress, className = '' }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} className={`flex-row items-center gap-1.5 py-2 active:opacity-60 ${className}`}>
      {!!icon && <Ionicons name={icon} size={18} color={C.primary} />}
      <Text className="text-[16px] text-primary font-semibold">{title}</Text>
    </Pressable>
  );
}
// Строка списка: точка статуса, заголовок, подпись, справа значение и стрелка.
function Row({ status, title, sub, right, onPress, last }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress}
      className={`flex-row items-center gap-3 py-3.5 active:opacity-60 ${last ? '' : 'border-b border-divider'}`}>
      {status !== undefined && <Dot status={status} />}
      <View className="flex-1 gap-0.5">
        <Text className={T.h3} numberOfLines={2}>{title}</Text>
        {!!sub && <Text className={T.small} numberOfLines={2}>{sub}</Text>}
      </View>
      {right}
      {!!onPress && <Ionicons name="chevron-forward" size={20} color={C.faint} />}
    </Pressable>
  );
}
const KV = ({ k, v, last }) => (
  <View className={`flex-row gap-3 py-2.5 ${last ? '' : 'border-b border-divider'}`}>
    <Text className="flex-1 text-[15px] leading-[21px] text-muted">{k}</Text>
    <Text className="flex-[1.3] text-[15px] leading-[21px] text-fg text-right">{v}</Text>
  </View>
);
function Expand({ title, children, open: initial = false }) {
  const [open, setOpen] = useState(initial);
  return (
    <View>
      <Pressable onPress={() => setOpen(!open)} hitSlop={6} className="flex-row items-center gap-1.5 py-2 active:opacity-60">
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.primary} />
        <Text className="text-[16px] text-primary font-semibold">{title}</Text>
      </Pressable>
      {open && <View className="gap-2 pt-1">{children}</View>}
    </View>
  );
}

function ResBar({ res }) {
  if (res.kind !== 'calc') return <Text className={T.small}>{res.text}</Text>;
  const c = st(res.status);
  return (
    <View className="gap-1.5">
      <View className="h-2.5 rounded-[5px] bg-sunken overflow-hidden">
        <View className={`h-full rounded-[5px] ${c.bg}`} style={{ width: `${Math.max(2, res.pct)}%` }} />
      </View>
      <Text className={`text-[15px] font-semibold ${c.text}`}>{res.text}</Text>
    </View>
  );
}

/* ---------- фото с рамками ---------- */
function PhotoStage({ photo, vis, model, busy, onPick }) {
  const [lw, setW] = useState(0);
  const ratio = (photo.width || 4) / (photo.height || 3);
  const W = lw || 340; // ширина до первого замера: подписи всё равно разместятся разумно
  const H = W / ratio;
  const boxes = [];
  const used = new Set();
  const add = (box, status, label, comp, key) => {
    const [x, y, w, h] = box.map((n) => Math.max(0, Math.min(1, Number(n) || 0)));
    if (w < 0.02 || h < 0.02) return;
    boxes.push({ key, comp, status, label, x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) });
  };
  if (vis) {
    vis.findings.forEach((f, i) => {
      const r = RULES.visual_rules.find((x) => x.class === f.cls);
      if (!r || !f.box) return;
      used.add(RULE_COMP[r.id]);
      add(f.box, r.status, r.name, RULE_COMP[r.id], 'f' + i);
    });
    (vis.nodes || []).forEach((n, i) => {
      const b = model.byComp[n.comp];
      if (!b || used.has(n.comp)) return;
      add(n.box, b.status, b.c.name, n.comp, 'n' + i);
    });
  }
  const LABEL_H = 22;
  return (
    <View className="w-full bg-sunken rounded-xl overflow-hidden" style={{ aspectRatio: ratio }}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {/* Размеры картинки задаём через style: на вебе className проигрывает встроенным размерам изображения. */}
      <Image source={photo.source || { uri: photo.uri }} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} resizeMode="contain" />
      {boxes.map((b) => {
        const inside = b.y * H < LABEL_H + 2; // рамка у верхнего края: подпись внутрь
        const rightSide = b.x > 0.5;          // рамка справа: подпись прижимаем к правому краю рамки
        const maxW = rightSide ? (b.x + b.w) * W - 4 : (1 - b.x) * W - 4;
        const c = st(b.status);
        return (
          <Pressable key={b.key} onPress={() => onPick(b.comp)} hitSlop={4}
            className={`absolute border-[3px] rounded ${c.border} ${b.status === 'ok' ? 'border-dashed' : 'border-solid'}`}
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
            <View className={`absolute h-[22px] justify-center px-1.5 rounded ${c.bg}`}
              style={{ maxWidth: Math.max(60, maxW), top: inside ? 0 : -LABEL_H - 1, [rightSide ? 'right' : 'left']: -3 }}>
              <Text numberOfLines={1} className="text-white text-[12px] font-bold">{b.label}</Text>
            </View>
          </Pressable>
        );
      })}
      {busy && (
        <View className="absolute inset-0 bg-[#081822]/55 items-center justify-center gap-2.5">
          <ActivityIndicator color="#fff" size="large" />
          <Text className="text-white text-[16px] font-semibold">ИИ анализирует фото…</Text>
        </View>
      )}
    </View>
  );
}

/* ---------- график датчика из столбиков ---------- */
function Spark({ param, rule, idx }) {
  const arr = SENS[SERIES[param]];
  const from = Math.max(0, idx - 95);
  const seg = arr.slice(from, idx + 1);
  const top = Math.max(rule.alarm * 1.15, Math.max(...seg) * 1.05);
  const H = 64;
  return (
    <View className="mt-1" style={{ height: H }}>
      <View className="flex-row items-end gap-px" style={{ height: H }}>
        {seg.map((v, i) => (
          <View key={i} className={`flex-1 rounded-t-[1px] ${v > rule.alarm ? 'bg-defect' : v > rule.warn ? 'bg-check' : 'bg-[#7fa9bb]'}`}
            style={{ height: Math.max(1, (v / top) * H) }} />
        ))}
      </View>
      <View className="absolute left-0 right-0 border-t-[1.5px] border-dashed border-check" style={{ bottom: (rule.warn / top) * H }} />
      <View className="absolute left-0 right-0 border-t-[1.5px] border-dashed border-defect" style={{ bottom: (rule.alarm / top) * H }} />
    </View>
  );
}

/* ---------- экран камеры: съёмка узла или скан QR ---------- */
function CameraScreen({ mode, hints, onPhoto, onQr, onClose }) {
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const scanned = useRef(false);
  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) requestPerm(); }, [perm]);

  const wrap = 'flex-1 bg-black justify-center items-center';
  if (!perm) return <View className={wrap}><ActivityIndicator color="#fff" /></View>;
  if (!perm.granted) {
    return (
      <View className={`${wrap} p-6 gap-3`}>
        <Text className="text-white text-[16px] text-center mb-2">
          Нет доступа к камере. Разрешите его, чтобы снимать узлы и сканировать QR-коды.
        </Text>
        <Btn title="Разрешить камеру" kind="primary" onPress={requestPerm} className="self-stretch" />
        <Btn title="Назад" onPress={onClose} className="self-stretch" />
      </View>
    );
  }
  const shoot = async () => {
    if (!cam.current || busy) return;
    setBusy(true);
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.6 });
      onPhoto({ uri: pic.uri, width: pic.width, height: pic.height });
    } catch (e) { setBusy(false); }
  };
  return (
    <View className={wrap}>
      <CameraView ref={cam} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} facing="back" onCameraReady={() => setReady(true)}
        barcodeScannerSettings={mode === 'qr' ? { barcodeTypes: ['qr'] } : undefined}
        onBarcodeScanned={mode === 'qr' ? (e) => { if (!scanned.current) { scanned.current = true; onQr(String(e.data || '')); } } : undefined} />
      {mode === 'qr' && <View className="w-60 h-60 border-[3px] border-white rounded-[20px]" pointerEvents="none" />}
      <View className="absolute top-0 left-0 right-0 px-4 pb-3.5 gap-1.5 bg-black/50" style={{ paddingTop: TOP + 10 }}>
        <Text className="text-white text-[18px] font-bold">{mode === 'qr' ? 'Наведите камеру на QR-код агрегата' : 'Наведите камеру на узел'}</Text>
        {mode !== 'qr' && hints.length > 0 && <Text className="text-white text-[15px] opacity-80">В первую очередь:</Text>}
        {mode !== 'qr' && hints.map((h) => (
          <View key={h.id} className={`border-l-4 pl-2.5 py-0.5 ${st(h.status).borderL}`}>
            <Text className="text-white text-[16px] font-semibold">{h.name}</Text>
          </View>
        ))}
      </View>
      <View className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-5 pt-5 bg-black/50"
        style={{ paddingBottom: BOTTOM + 16 }}>
        <Btn title="Назад" kind="dark" onPress={onClose} className="w-24" />
        {mode !== 'qr' ? (
          <Pressable onPress={shoot} disabled={!ready || busy}
            className={`w-[76px] h-[76px] rounded-full border-4 border-white items-center justify-center ${!ready || busy ? 'opacity-50' : ''}`}>
            <View className="w-[58px] h-[58px] rounded-full bg-white" />
          </Pressable>
        ) : <View />}
        <View className="w-24" />
      </View>
    </View>
  );
}

/* ---------- выезжающее снизу окно ---------- */
function Sheet({ visible, onClose, title, head, children, footer }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-[#050c12]/50">
        <Pressable className="flex-1" onPress={onClose} />
        {visible && (
          <View className="bg-surface rounded-t-3xl px-4 pt-2 gap-3 max-h-[90%]" style={{ paddingBottom: BOTTOM + 8 }}>
            <View className="self-center w-10 h-[5px] rounded-[3px] bg-line" />
            <View className="flex-row items-start gap-3">
              {head || <Text className={`${T.h1} flex-1`}>{title}</Text>}
              <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Закрыть"
                className="w-10 h-10 rounded-full bg-bg items-center justify-center active:opacity-75">
                <Ionicons name="close" size={22} color={C.fg} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3 pb-2">{children}</ScrollView>
            {footer}
          </View>
        )}
      </View>
    </Modal>
  );
}

/* ---------- приложение ---------- */
export default function App() {
  const [tab, setTab] = useState('inspect');
  const [unitId, setUnitId] = useState('CN-1');
  const [idx, setIdx] = useState(410);
  const [photo, setPhoto] = useState(null);
  const [vis, setVis] = useState(null);
  const [manual, setManual] = useState([]);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState(null); // {kind: 'info' | 'noapi' | 'error', text}
  const [toast, setToast] = useState('');
  const [history, setHistory] = useState([]);
  const [compState, setCompState] = useState({});
  const [apiUrl, setApiUrl] = useState('');
  const [demo, setDemo] = useState(false); // режим демонстрации: примеры фото, сценарии датчиков, технические детали
  const [camMode, setCamMode] = useState(null); // null | 'photo' | 'qr'
  const [sheet, setSheet] = useState(null); // id узла
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [openSensor, setOpenSensor] = useState(null);
  const [openHist, setOpenHist] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showUnits, setShowUnits] = useState(false);
  const [user, setUser] = useState(null); // вошедший сотрудник {name, role, login}
  const [authReady, setAuthReady] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const run = useRef(0);
  const scroll = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    currentUser().then((r) => { if (r.ok) setUser(r.user); }).catch(() => {}).finally(() => setAuthReady(true));
  }, []);
  useEffect(() => {
    (async () => {
      setHistory(await load('obh.history', []));
      setCompState(await load('obh.comp', {}));
      const ui = await load('obh.ui', {});
      if (ui.unitId && UNITS.some((u) => u.id === ui.unitId)) setUnitId(ui.unitId);
      if (Number.isInteger(ui.idx)) setIdx(Math.max(0, Math.min(499, ui.idx)));
      if (typeof ui.apiUrl === 'string') setApiUrl(ui.apiUrl);
      if (typeof ui.demo === 'boolean') setDemo(ui.demo);
    })();
  }, []);
  useEffect(() => { save('obh.ui', { unitId, idx, apiUrl, demo }); }, [unitId, idx, apiUrl, demo]);

  const unit = UNITS.find((u) => u.id === unitId);
  const classes = useMemo(() => [
    ...(vis ? vis.findings : []),
    ...manual.map((cls) => ({ cls, confidence: null, explanation: 'Отмечено инженером вручную.' })),
  ], [vis, manual]);
  const model = useMemo(() => buildModel(unit, idx, classes, compState), [unit, idx, classes, compState]);
  const attention = Object.values(model.byComp)
    .filter((b) => b.status !== 'ok')
    .sort((a, b) => RANK[b.status] - RANK[a.status]);
  const findings = sortFindings(model.findings);

  const flash = (text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2800);
  };
  const resetPhoto = () => { run.current++; setPhoto(null); setVis(null); setManual([]); setAi(null); setBusy(false); setShowManual(false); };
  const chooseUnit = (id, msg) => { setUnitId(id); resetPhoto(); setShowUnits(false); setOpenSensor(null); if (msg) flash(msg); };

  // Анализ фото через сервис команды. Если сервиса нет, понятно сообщаем об этом.
  const analyze = async (p) => {
    const my = ++run.current;
    setPhoto(p); setVis(null); setManual([]); setAi(null); setShowManual(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
    const url = apiUrl.trim().replace(/\/+$/, '');
    if (!url) { setAi({ kind: 'noapi', text: 'Сервис анализа фото не подключён. Укажите его адрес в профиле.' }); return; }
    setBusy(true);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);
    try {
      const form = new FormData();
      form.append('photo', { uri: p.uri, name: 'photo.jpg', type: 'image/jpeg' });
      form.append('unit_id', unit.id);
      const res = await fetch(url + '/analyze', { method: 'POST', body: form, signal: ctl.signal });
      if (!res.ok) throw new Error('http ' + res.status);
      const v = cleanVision(await res.json(), unit);
      if (my !== run.current) return;
      setVis(v);
      setAi(null);
    } catch (e) {
      if (my !== run.current) return;
      setAi({ kind: 'error', text: 'Сервис анализа не ответил. Проверьте адрес в профиле и подключение к сети.' });
    } finally {
      clearTimeout(timer);
      if (my === run.current) setBusy(false);
    }
  };
  const pickFromGallery = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (r.canceled || !r.assets || !r.assets[0]) return;
      const a = r.assets[0];
      analyze({ uri: a.uri, width: a.width, height: a.height });
    } catch (e) { flash('Не удалось открыть галерею.'); }
  };
  const pickSample = (smp) => {
    // Пример из кейса: готовая разметка, сервис не вызывается.
    run.current++; setBusy(false); setManual([]); setShowManual(false); setAi(null);
    setPhoto({ source: smp.source, width: smp.width, height: smp.height });
    setVis(smp.preset);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const onQr = (data) => {
    setCamMode(null);
    const u = UNITS.find((x) => x.qr === data.trim());
    if (u) chooseUnit(u.id, 'Агрегат определён по QR-коду');
    else flash('Такого агрегата нет в базе. Выберите его из списка.');
  };
  const who = () => (user ? { name: user.name, role: user.role, login: user.login } : null);
  const pushHistory = (entry) => {
    const h = [entry, ...history].slice(0, 300);
    setHistory(h); save('obh.history', h);
  };
  // Отметка по узлу: проверено, дефект или замена.
  const record = (action) => {
    const b = model.byComp[sheet];
    if (!b) return;
    const now = Date.now();
    pushHistory({
      unit: unit.id, comp: b.c.id, compName: b.c.name, action, note: note.trim().slice(0, 500), status: b.status,
      user: who(), findings: b.findings.map((f) => f.label).join('; '), ts: now,
    });
    const key = `${unit.id}__${b.c.id}`;
    const cs = { ...(compState[key] || {}), lastCheck: now };
    if (action === 'replaced') { cs.at = unit.hours != null ? unit.hours : 0; cs.date = new Date(now).toISOString().slice(0, 10); }
    const c = { ...compState, [key]: cs };
    setCompState(c); save('obh.comp', c);
    closeSheet();
    flash(`${b.c.name}: ${ACTIONS[action].toLowerCase()}`);
  };
  // Итог осмотра по фото в журнал.
  const saveInspection = () => {
    pushHistory({
      unit: unit.id, comp: null, compName: 'Осмотр по фото', action: 'inspection', note: '', status: model.overall,
      user: who(), findings: findings.map((f) => f.label).join('; '), ts: Date.now(),
    });
    resetPhoto();
    flash('Осмотр сохранён в журнал');
  };
  const closeSheet = () => { setSheet(null); setNote(''); setShowNote(false); };
  const switchTab = (id) => { setTab(id); scroll.current?.scrollTo({ y: 0, animated: false }); };
  const closeProfile = () => { setShowProfile(false); setConfirmLogout(false); };
  const doLogout = async () => {
    await logout();
    setConfirmLogout(false); setShowProfile(false); setSheet(null); resetPhoto(); setUser(null);
  };

  if (!authReady) return <Splash />;
  if (!user) return <AuthScreen onAuth={(u) => { setUser(u); setTab('inspect'); }} />;

  if (camMode) {
    return (
      <CameraScreen mode={camMode} onClose={() => setCamMode(null)} onQr={onQr}
        hints={attention.slice(0, 3).map((b) => ({ id: b.c.id, name: b.c.name, status: b.status }))}
        onPhoto={(p) => { setCamMode(null); analyze(p); }} />
    );
  }

  const top = findings[0];
  const ov = st(model.overall);

  /* ----- Осмотр: до фото ----- */
  const inspectStart = (
    <>
      <View className={CARD}>
        <Text className={T.small}>Агрегат</Text>
        <Text className={T.h1}>{unit.name}</Text>
        <View className={BETWEEN}>
          <Pill status={model.overall} big />
          <Link title="Сменить" icon="swap-horizontal" onPress={() => setShowUnits(true)} />
        </View>
      </View>
      {attention.length > 0 && (
        <View className={CARD}>
          <Text className={T.h2}>Сначала проверьте</Text>
          <View>
            {attention.slice(0, 3).map((b, i, a) => (
              <Row key={b.c.id} status={b.status} title={b.c.name} onPress={() => setSheet(b.c.id)} last={i === a.length - 1} />
            ))}
          </View>
        </View>
      )}
      {demo && (
        <View className={CARD}>
          <Text className={T.h2}>Примеры фото из кейса</Text>
          <View className="flex-row flex-wrap gap-2">
            {SAMPLES.map((x) => <Chip key={x.key} title={x.label} onPress={() => pickSample(x)} />)}
          </View>
        </View>
      )}
    </>
  );

  /* ----- Осмотр: результат по фото ----- */
  const inspectResult = photo && (
    <>
      <View className={`rounded-2xl p-4 gap-1.5 ${ov.soft}`}>
        <Text className={`text-[24px] font-bold ${ov.text}`}>{busy ? 'Анализ…' : STATUS_SHORT[model.overall]}</Text>
        {!busy && <Text className={T.body} numberOfLines={3}>{top ? top.action : 'Замечаний нет. Продолжайте обход.'}</Text>}
      </View>
      <PhotoStage photo={photo} vis={vis} model={model} busy={busy} onPick={setSheet} />
      {ai && (
        <View className={`rounded-xl p-3 gap-1 ${ai.kind === 'noapi' ? 'bg-check-bg' : 'bg-defect-bg'}`}>
          <Text className={T.body}>{ai.text}</Text>
          <Link title="Открыть профиль" onPress={() => setShowProfile(true)} />
        </View>
      )}
      {!busy && (
        <View className={CARD}>
          <Text className={T.h2}>{findings.length ? 'Найдено' : 'Ничего не найдено'}</Text>
          {findings.length > 0 && (
            <View>
              {findings.map((f, i) => (
                <Row key={f.id} status={f.status} title={f.label} onPress={() => setSheet(f.comp)} last={i === findings.length - 1}
                  right={<Pill status={f.status} />} />
              ))}
            </View>
          )}
          {!findings.length && <Text className={T.muted}>Видимых дефектов нет. Это ещё не подтверждает исправность.</Text>}
        </View>
      )}
      {!busy && (
        <View className="items-center">
          <Link title={showManual ? 'Скрыть ручную правку' : 'ИИ ошибся? Исправить'} onPress={() => setShowManual(!showManual)} />
        </View>
      )}
      {showManual && (
        <View className={CARD}>
          <Text className={T.small}>Отметьте то, что видите сами. Повторное нажатие снимает отметку.</Text>
          {unit.comps.map((c) => {
            const rules = RULES.visual_rules.filter((r) => RULE_COMP[r.id] === c.id);
            if (!rules.length) return null;
            return (
              <View key={c.id} className="gap-1.5">
                <Text className="text-[15px] font-bold text-muted">{c.name}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {rules.map((r) => (
                    <Chip key={r.id} title={r.name} active={manual.includes(r.class)}
                      onPress={() => setManual(manual.includes(r.class) ? manual.filter((x) => x !== r.class) : [...manual, r.class])} />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </>
  );

  /* ----- Оборудование ----- */
  const comps = Object.values(model.byComp);
  const sensorRows = unit.sensors ? RULES.sensor_rules.map((r) => {
    const v = sensorsAt(idx)[r.param];
    const lvl = v > r.alarm ? 'defect' : v > r.warn ? 'check' : 'ok';
    const unitTxt = (r.column.match(/\((.+)\)/) || [])[1] || '';
    return { r, v, lvl, unitTxt, name: r.column.replace(/\s*\(.+\)/, '') };
  }) : [];
  const specRows = [['Модель', unit.model], ...unit.specs,
    ['Ввод в эксплуатацию', fmtDate(unit.commissioned)],
    ['Наработка', unit.hours != null ? `${num(unit.hours, 0)} ч` : 'нет данных'],
    ['Срок службы', `${unit.lifeYears} лет${unit.lifeHours ? `, ресурс ${num(unit.lifeHours, 0)} ч` : ''}`],
    ['Код для QR', unit.qr],
  ];
  const unitTab = (
    <>
      <View className={CARD}>
        <Text className={T.h1}>{unit.name}</Text>
        <View className={BETWEEN}>
          <Pill status={model.overall} big />
          <Link title="Сменить" icon="swap-horizontal" onPress={() => setShowUnits(true)} />
        </View>
      </View>

      <View className={CARD}>
        <Text className={T.h2}>Узлы</Text>
        <View>
          {comps.map((b, i) => (
            <Row key={b.c.id} status={b.status} title={b.c.name} sub={shortRes(b.res)} onPress={() => setSheet(b.c.id)} last={i === comps.length - 1} />
          ))}
        </View>
      </View>

      <View className={CARD}>
        <View className={BETWEEN}>
          <Text className={T.h2}>Датчики</Text>
          {unit.sensors && <Text className={T.faint}>{fmtTs(sensorTime(idx))}</Text>}
        </View>
        {!unit.sensors && <Text className={T.muted}>Датчики к этому агрегату не подключены.</Text>}
        {demo && unit.sensors && (
          <View className="gap-2 bg-bg rounded-xl p-3">
            <Text className={T.small}>Режим демонстрации: выберите ситуацию</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
              {SCENARIOS.map(([t, i]) => <Chip key={t} title={t} active={idx === i} onPress={() => setIdx(i)} />)}
            </ScrollView>
            <View className="flex-row gap-2">
              {[['−24 ч', -24], ['−1 ч', -1], ['+1 ч', 1], ['+24 ч', 24]].map(([t, d]) => (
                <Btn key={t} title={t} className="flex-1 px-1 min-h-[44px]" onPress={() => setIdx(Math.max(0, Math.min(499, idx + d)))} />
              ))}
            </View>
          </View>
        )}
        <View>
          {sensorRows.map(({ r, v, lvl, unitTxt, name }, i) => {
            const open = openSensor === r.id;
            return (
              <View key={r.id} className={i === sensorRows.length - 1 ? '' : 'border-b border-divider'}>
                <Pressable onPress={() => setOpenSensor(open ? null : r.id)} className="flex-row items-center gap-3 py-3.5 active:opacity-60">
                  <Dot status={lvl} />
                  <Text className={`${T.h3} flex-1`} numberOfLines={1}>{name}</Text>
                  <Text className="text-[17px] font-bold text-fg" style={{ fontVariant: ['tabular-nums'] }}>
                    {num(v, r.param[0] === 't' ? 1 : 2)} <Text className="text-[14px] font-normal text-muted">{unitTxt}</Text>
                  </Text>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.faint} />
                </Pressable>
                {open && (
                  <View className="pb-3 gap-2">
                    <Text className={`text-[15px] font-semibold ${st(lvl).text}`}>
                      {lvl === 'ok' ? 'Норма' : lvl === 'check' ? r.warn_label.replace('Пред: ', '') : r.alarm_label.replace('Тревога: ', '')}
                    </Text>
                    <Spark param={r.param} rule={r} idx={idx} />
                    <Text className={T.faint}>За 96 часов. Пунктир: порог {num(r.warn, 1)} и тревога {num(r.alarm, 1)} {unitTxt}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </View>

      <View className={CARD}>
        <Expand title="Характеристики">
          <View>{specRows.map(([k, v], i) => <KV key={k} k={k} v={v} last={i === specRows.length - 1} />)}</View>
          <Text className={T.faint}>{unit.note}</Text>
        </Expand>
      </View>
    </>
  );

  /* ----- История ----- */
  const unitName = (id) => { const u = UNITS.find((x) => x.id === id); return u ? u.id : id; };
  const historyTab = (
    <View className={CARD}>
      <Text className={T.h2}>Журнал</Text>
      {history.length ? (
        <View>
          {history.map((h, i) => {
            const key = h.ts + (h.comp || 'insp');
            const open = openHist === key;
            const status = h.action === 'inspection' ? h.status : ACTION_STATUS[h.action] || 'check';
            const label = h.action === 'inspection' ? STATUS_SHORT[h.status] || 'Осмотр' : ACTIONS[h.action] || h.action;
            return (
              <View key={key} className={i === history.length - 1 ? '' : 'border-b border-divider'}>
                <Pressable onPress={() => setOpenHist(open ? null : key)} className="flex-row items-center gap-3 py-3.5 active:opacity-60">
                  <View className="flex-1 gap-0.5">
                    <Text className={T.h3} numberOfLines={1}>{h.compName}</Text>
                    <Text className={T.small} numberOfLines={1}>
                      {fmtTs(h.ts)} · {unitName(h.unit)}{h.user && h.user.name ? ` · ${h.user.name}` : ''}
                    </Text>
                  </View>
                  <Pill status={status} text={label} />
                </Pressable>
                {open && (
                  <View className="pb-3 gap-1.5">
                    {!!h.findings && <Text className={T.body}>{h.findings}</Text>}
                    {!!h.note && <Text className={T.body}><Text className="font-bold">Заметка: </Text>{h.note}</Text>}
                    {!!(h.user && h.user.role) && <Text className={T.small}>{h.user.name}, {h.user.role}</Text>}
                    {!h.findings && !h.note && <Text className={T.small}>Замечаний не было.</Text>}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <View className="items-center gap-2 py-6 px-2">
          <Ionicons name="document-text-outline" size={36} color={C.faint} />
          <Text className="text-[17px] font-bold text-fg">Записей пока нет</Text>
          <Text className={`${T.muted} text-center`}>Сохраните осмотр или отметьте узел как проверенный.</Text>
        </View>
      )}
    </View>
  );

  /* ----- нижняя панель с главным действием ----- */
  let action = null;
  if (tab === 'inspect' && !photo) {
    action = (
      <>
        <Btn title="Сфотографировать узел" kind="primary" icon="camera" onPress={() => setCamMode('photo')} />
        <View className="flex-row justify-center gap-6">
          <Link title="Из галереи" icon="images-outline" onPress={pickFromGallery} />
          <Link title="Сканировать QR" icon="qr-code-outline" onPress={() => setCamMode('qr')} />
        </View>
      </>
    );
  } else if (tab === 'inspect' && photo) {
    action = (
      <>
        <Btn title="Сохранить в журнал" kind="primary" icon="checkmark" onPress={saveInspection} disabled={busy} />
        <View className="flex-row justify-center gap-6">
          <Link title="Новое фото" icon="camera-outline" onPress={() => setCamMode('photo')} />
          <Link title="Отмена" icon="close" onPress={resetPhoto} />
        </View>
      </>
    );
  }

  const sb = sheet ? model.byComp[sheet] : null;
  const sbFind = sb ? sortFindings(sb.findings) : [];

  return (
    <View className="flex-1 bg-bg">
      <StatusBar barStyle="light-content" backgroundColor={C.primary} />
      <View className="bg-primary px-4 pb-3 flex-row items-center justify-between" style={{ paddingTop: TOP + 8 }}>
        <Text className="text-white text-[20px] font-extrabold tracking-[0.5px]">MaintAR</Text>
        <Pressable onPress={() => setShowProfile(true)} hitSlop={8} accessibilityLabel="Профиль"
          className="w-11 h-11 rounded-full bg-white/15 items-center justify-center active:opacity-75">
          <Ionicons name="person" size={22} color="#fff" />
        </Pressable>
      </View>

      <ScrollView ref={scroll} contentContainerClassName="p-4 pb-6 gap-4" keyboardShouldPersistTaps="handled">
        {tab === 'inspect' ? (photo ? inspectResult : inspectStart) : tab === 'unit' ? unitTab : historyTab}
      </ScrollView>

      {!!toast && (
        <View className="absolute left-4 right-4 items-center" style={{ bottom: (action ? 150 : 90) + BOTTOM }} pointerEvents="none">
          <View className="bg-fg rounded-full px-4 py-2.5"><Text className="text-white text-[15px] font-semibold">{toast}</Text></View>
        </View>
      )}

      {action && <View className="px-4 pt-3 pb-1 gap-0.5 bg-surface border-t border-divider">{action}</View>}

      <View className="flex-row bg-surface border-t border-line" style={{ paddingBottom: BOTTOM }}>
        {TABS.map(([id, title, icon]) => {
          const on = tab === id;
          return (
            <Pressable key={id} onPress={() => switchTab(id)} className="flex-1 items-center min-h-[64px] justify-center">
              <View className={`px-4 py-1.5 rounded-xl items-center gap-0.5 ${on ? 'bg-primary-soft' : ''}`}>
                <Ionicons name={on ? icon.replace('-outline', '') : icon} size={24} color={on ? C.primary : C.muted} />
                <Text className={`text-[13px] ${on ? 'text-primary font-bold' : 'text-muted font-medium'}`}>{title}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* окно узла */}
      <Sheet visible={!!sb} onClose={closeSheet}
        head={sb && (
          <View className="flex-1 gap-2">
            <Text className={T.h1}>{sb.c.name}</Text>
            <View className="self-start"><Pill status={sb.status} big /></View>
          </View>
        )}
        footer={sb && (
          <View className="gap-1 pt-1">
            <View className="flex-row gap-2">
              <Btn title="Проверено" kind="primary" icon="checkmark" onPress={() => record('checked')} className="flex-1" />
              <Btn title="Заменено" icon="refresh" onPress={() => record('replaced')} className="flex-1 min-h-[56px]" />
            </View>
            <View className="items-center"><Link title="Отметить дефект" onPress={() => record('defect')} /></View>
          </View>
        )}>
        {sb && (
          <>
            {sbFind[0] ? (
              <View className="bg-bg rounded-xl p-3 gap-1">
                <Text className="text-[14px] font-bold text-primary">Что делать</Text>
                <Text className={T.body}>{sbFind[0].action}</Text>
              </View>
            ) : <Text className={T.muted}>Замечаний по фото и датчикам нет.</Text>}
            <View className="gap-1.5">
              <Text className="text-[14px] font-bold text-muted">Ресурс</Text>
              <ResBar res={sb.res} />
            </View>
            {showNote ? (
              <TextInput className={`${INPUT} min-h-[80px]`} style={{ textAlignVertical: 'top' }} multiline value={note} onChangeText={setNote}
                autoFocus placeholder="Что увидели и что сделали" placeholderTextColor={C.faint} />
            ) : <Link title="Добавить заметку" icon="create-outline" onPress={() => setShowNote(true)} />}
            <Expand title="Подробнее">
              {sbFind.map((f) => (
                <View key={f.id} className={`border-l-4 pl-3 gap-1 ${st(f.status).borderL}`}>
                  <Text className={T.h3}>{f.label}</Text>
                  <Text className={T.body}>{f.detail}</Text>
                  {f !== sbFind[0] && <Text className={T.small}>Что делать: {f.action}</Text>}
                  <Text className={T.faint}>
                    {SRC_TEXT[f.src] || f.src} · правило {f.id}{f.confidence != null ? ` · уверенность ${Math.round(f.confidence * 100)} %` : ''}
                  </Text>
                </View>
              ))}
              <View>
                <KV k="Нормативный срок" v={sb.c.norm != null ? `${num(sb.c.norm, 0)} ч` : 'не задан'} />
                {sb.res.kind === 'calc' && <KV k="Наработка узла" v={`${num(sb.res.used, 0)} ч`} />}
                <KV k="Установлен" v={fmtDate(sb.res.s.date)} />
                <KV k="Последняя проверка" v={sb.res.s.lastCheck ? fmtTs(sb.res.s.lastCheck) : 'нет записей'} last />
              </View>
              <Text className={T.faint}>{sb.c.desc}</Text>
            </Expand>
          </>
        )}
      </Sheet>

      {/* выбор агрегата */}
      <Sheet visible={showUnits} onClose={() => setShowUnits(false)} title="Агрегат"
        footer={<Btn title="Сканировать QR-код" icon="qr-code-outline" onPress={() => { setShowUnits(false); setCamMode('qr'); }} />}>
        {UNITS.map((u) => {
          const on = u.id === unitId;
          return (
            <Pressable key={u.id} onPress={() => chooseUnit(u.id, '')}
              className={`flex-row items-center gap-3 border rounded-xl p-4 active:opacity-75 ${on ? 'border-primary bg-primary-soft' : 'border-line'}`}>
              <Text className={`${T.h3} flex-1`}>{u.name}</Text>
              {on && <Ionicons name="checkmark-circle" size={24} color={C.primary} />}
            </Pressable>
          );
        })}
      </Sheet>

      {/* профиль и настройки */}
      <Sheet visible={showProfile} onClose={closeProfile} title="Профиль">
        <View className="flex-row items-center gap-3">
          <Ionicons name="person-circle" size={52} color={C.primary} />
          <View className="flex-1">
            <Text className={T.h3}>{user.name}</Text>
            <Text className={T.small}>{user.role}</Text>
          </View>
        </View>
        {confirmLogout ? (
          <View className="gap-2 bg-bg rounded-xl p-3">
            <Text className={T.body}>Выйти? Журнал останется на телефоне.</Text>
            <View className="flex-row gap-2">
              <Btn title="Выйти" kind="danger" onPress={doLogout} className="flex-1" />
              <Btn title="Отмена" onPress={() => setConfirmLogout(false)} className="flex-1" />
            </View>
          </View>
        ) : <Btn title="Выйти" icon="log-out-outline" onPress={() => setConfirmLogout(true)} />}

        <View className="flex-row items-center gap-3 py-2 border-t border-divider pt-4">
          <View className="flex-1 gap-0.5">
            <Text className={T.h3}>Режим демонстрации</Text>
            <Text className={T.small}>Примеры фото из кейса и выбор ситуации на датчиках</Text>
          </View>
          <Switch value={demo} onValueChange={setDemo} trackColor={{ true: C.primary, false: C.line }} thumbColor="#fff" />
        </View>

        <View className="gap-2 border-t border-divider pt-4">
          <Text className={T.h3}>Сервис анализа фото</Text>
          <TextInput className={`${INPUT} min-h-[50px]`} value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false}
            keyboardType="url" placeholder="http://адрес-сервера:8000" placeholderTextColor={C.faint} />
          <Text className={T.small}>{apiUrl.trim() ? 'Адрес задан. Новые фото уходят на анализ.' : 'Без адреса ИИ не проверит ваши фото.'}</Text>
        </View>
      </Sheet>
    </View>
  );
}
