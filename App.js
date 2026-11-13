// MaintAR: AR-помощник инженера для диагностики промышленного оборудования.
// Всё работает на телефоне без сервера: правила, датчики из базы кейса, карточки, ресурс, история.
// Дефекты на фото определяет сервис анализа (адрес задаётся в настройках). Ручная правка нужна, только если ИИ ошибся.
// Стили: Tailwind через NativeWind (className). Палитра в src/theme.js, inline style только для значений, вычисляемых на лету.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Dimensions, Image, Modal, Platform, Pressable, ScrollView, StatusBar, Text, TextInput, View,
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

const TABS = [['inspect', 'Осмотр', 'clipboard-outline'], ['card', 'Карточка', 'document-text-outline'], ['sensors', 'Датчики', 'pulse-outline'], ['history', 'История', 'time-outline']];
const ACTIONS = { checked: 'Проверено', defect: 'Дефект', replaced: 'Заменено' };
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

// Типографика.
const T = {
  h1: 'text-[21px] font-bold text-fg',
  h2: 'text-[18px] font-bold text-fg',
  h3: 'text-[16px] font-semibold text-fg',
  body: 'text-[15px] leading-[22px] text-fg',
  body2: 'text-[15px] leading-[21px] text-muted',
  body2c: 'text-[15px] leading-[21px] text-fg',
  muted: 'text-[15px] leading-[21px] text-muted',
  small: 'text-[13px] leading-[18px] text-muted',
  faint: 'text-[13px] leading-[18px] text-faint',
  note: 'text-[14px] leading-[20px] text-muted border-l-[3px] border-l-primary pl-2.5',
  src: 'self-start text-[13px] text-primary bg-primary-soft rounded-md px-2 py-0.5 overflow-hidden',
};
const ROW = 'flex-row flex-wrap items-center gap-2';
const BETWEEN = 'flex-row items-center justify-between gap-2';
const NUMS = { fontVariant: ['tabular-nums'] };

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

/* ---------- мелкие элементы ---------- */
function Pill({ status, text, big }) {
  const c = st(status);
  return (
    <View className={`flex-row items-center gap-1.5 rounded-full ${big ? 'px-3.5 py-2' : 'px-2.5 py-1'} ${c.soft}`}>
      <View className={`w-2 h-2 rounded-full ${c.bg}`} />
      <Text className={`font-bold ${big ? 'text-[15px]' : 'text-[13px]'} ${c.text}`}>{text || STATUS_SHORT[status]}</Text>
    </View>
  );
}

const BTN = {
  primary: { box: 'bg-primary border-primary min-h-[54px]', text: 'text-white text-[17px]', icon: '#fff' },
  secondary: { box: 'bg-surface border-line', text: 'text-fg', icon: C.fg },
  ghost: { box: 'bg-transparent border-transparent', text: 'text-muted', icon: C.muted },
  danger: { box: 'bg-surface border-defect', text: 'text-defect', icon: C.defect },
  dark: { box: 'bg-white/15 border-white/35', text: 'text-white', icon: '#fff' },
};
function Btn({ title, icon, onPress, kind = 'secondary', small, disabled, className = '' }) {
  const k = BTN[kind] || BTN.secondary;
  return (
    <Pressable onPress={onPress} disabled={disabled}
      className={`min-h-[48px] px-4 py-2.5 rounded-xl border items-center justify-center active:opacity-80 ${k.box} ${small ? 'min-h-[40px] px-3 py-1.5' : ''} ${disabled ? 'opacity-[0.45]' : ''} ${className}`}>
      <View className="flex-row items-center gap-2">
        {!!icon && <Ionicons name={icon} size={small ? 18 : 22} color={k.icon} />}
        <Text className={`font-semibold text-center ${small ? 'text-[14px]' : 'text-[16px]'} ${k.text}`}>{title}</Text>
      </View>
    </Pressable>
  );
}
function Chip({ title, active, onPress }) {
  return (
    <Pressable onPress={onPress}
      className={`border rounded-full px-3.5 py-[9px] active:opacity-80 ${active ? 'bg-primary border-primary' : 'bg-surface border-line'}`}>
      <Text className={`text-[14px] ${active ? 'text-white font-semibold' : 'text-fg'}`}>{title}</Text>
    </Pressable>
  );
}
function Link({ title, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} className="self-start py-1.5">
      <Text className="text-[15px] text-primary font-semibold underline">{title}</Text>
    </Pressable>
  );
}
const Card = ({ title, right, children }) => (
  <View className="bg-surface rounded-[14px] p-4 gap-3 border border-divider">
    {(title || right) && <View className={BETWEEN}><Text className={`${T.h2} flex-1`}>{title}</Text>{right}</View>}
    {children}
  </View>
);
const Step = ({ n, title, hint, right, children }) => (
  <View className="bg-surface rounded-[14px] p-4 gap-3 border border-divider">
    <View className="flex-row items-center gap-3">
      <View className="w-[30px] h-[30px] rounded-full bg-primary items-center justify-center">
        <Text className="text-white font-bold text-[15px]">{n}</Text>
      </View>
      <View className="flex-1">
        <Text className={T.h2}>{title}</Text>
        {!!hint && <Text className={T.small}>{hint}</Text>}
      </View>
      {right}
    </View>
    {children}
  </View>
);
function Item({ status, onPress, children }) {
  const body = (
    <View className={`border border-divider border-l-4 rounded-xl p-3 gap-2 bg-surface ${st(status).borderL}`}>{children}</View>
  );
  return onPress ? <Pressable onPress={onPress} className="active:opacity-75">{body}</Pressable> : body;
}
const KV = ({ k, v, last }) => (
  <View className={`flex-row gap-3 py-[9px] ${last ? '' : 'border-b border-divider'}`}>
    <Text className="flex-1 text-[14px] leading-[20px] text-muted">{k}</Text>
    <Text className="flex-[1.3] text-[15px] leading-[20px] text-fg text-right">{v}</Text>
  </View>
);
const Chevron = () => <Text className="text-[24px] text-faint ml-0.5 -mt-[3px]">›</Text>;

function ResBar({ res }) {
  if (res.kind !== 'calc') return <Text className={T.faint}>{res.text}</Text>;
  const c = st(res.status);
  return (
    <View className="gap-1.5">
      <View className="h-2.5 rounded-[5px] bg-sunken overflow-hidden">
        <View className={`h-full rounded-[5px] ${c.bg}`} style={{ width: `${Math.max(2, res.pct)}%` }} />
      </View>
      <View className={BETWEEN}>
        <Text className={T.small}>использовано {num(res.pct, 0)} %</Text>
        <Text className={`${T.small} font-semibold ${c.text}`}>{res.text}</Text>
      </View>
    </View>
  );
}

/* ---------- фото с рамками ---------- */
function PhotoStage({ photo, vis, model, busy, onPick }) {
  const [lw, setW] = useState(0);
  if (!photo) {
    return (
      <View key="empty" className="w-full rounded-xl overflow-hidden p-7 gap-1.5 items-center border-2 border-dashed border-line bg-bg">
        <Text className="text-[16px] font-bold text-fg">Фото пока нет</Text>
        <Text className={`${T.muted} text-center`}>Снимите узел. ИИ найдёт дефекты и обведёт их рамками.</Text>
      </View>
    );
  }
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
    <View key="photo" className="w-full bg-sunken rounded-xl overflow-hidden" style={{ aspectRatio: ratio }}
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
const countBoxes = (vis) => !vis ? 0 : vis.findings.filter((f) => f.box).length + (vis.nodes || []).length;

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
        <Text className="text-white text-[15px] text-center mb-2">
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
            <Text className="text-white text-[15px] font-semibold">{h.name}</Text>
            <Text className="text-white text-[13px] opacity-85">{h.reason}</Text>
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
function Sheet({ visible, onClose, title, head, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-[#050c12]/50">
        <Pressable className="flex-1" onPress={onClose} />
        {visible && (
          <View className="bg-surface rounded-t-[20px] px-4 pt-2 gap-3 max-h-[90%]" style={{ paddingBottom: BOTTOM + 8 }}>
            <View className="self-center w-10 h-[5px] rounded-[3px] bg-line" />
            <View className="flex-row items-start gap-3">
              {head || <Text className={`${T.h1} flex-1`}>{title}</Text>}
              <Pressable onPress={onClose} hitSlop={10}
                className="min-h-[40px] px-3 flex-row gap-1 rounded-[10px] bg-bg items-center justify-center active:opacity-75">
                <Ionicons name="close" size={20} color={C.primary} />
                <Text className="text-[15px] font-semibold text-primary">Закрыть</Text>
              </Pressable>
            </View>
            {children}
          </View>
        )}
      </View>
    </Modal>
  );
}
const Block = ({ title, children }) => (
  <View className="bg-bg rounded-xl p-3 gap-1.5">
    <Text className="text-[13px] font-bold text-primary tracking-[0.5px] uppercase">{title}</Text>
    {children}
  </View>
);
const Todo = ({ text }) => (
  <View className="bg-bg rounded-[10px] p-2.5 gap-0.5">
    <Text className="text-[13px] font-bold text-primary">Что делать</Text>
    <Text className={T.body2c}>{text}</Text>
  </View>
);
const INPUT = 'border border-line rounded-xl p-3 text-[15px] text-fg bg-surface';

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
  const [idNote, setIdNote] = useState('');
  const [history, setHistory] = useState([]);
  const [compState, setCompState] = useState({});
  const [apiUrl, setApiUrl] = useState('');
  const [camMode, setCamMode] = useState(null); // null | 'photo' | 'qr'
  const [sheet, setSheet] = useState(null); // id узла
  const [note, setNote] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [showAllAttn, setShowAllAttn] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showUnits, setShowUnits] = useState(false);
  const [user, setUser] = useState(null); // вошедший сотрудник {name, role, login}
  const [authReady, setAuthReady] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const run = useRef(0);
  const scroll = useRef(null);

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
    })();
  }, []);
  useEffect(() => { save('obh.ui', { unitId, idx, apiUrl }); }, [unitId, idx, apiUrl]);

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

  const resetPhoto = () => { run.current++; setPhoto(null); setVis(null); setManual([]); setAi(null); setBusy(false); };
  const chooseUnit = (id, msg) => { setUnitId(id); setIdNote(msg || ''); resetPhoto(); setShowUnits(false); setShowAllAttn(false); };

  // Анализ фото через сервис команды. Если сервиса нет, понятно сообщаем об этом.
  const analyze = async (p) => {
    const my = ++run.current;
    setPhoto(p); setVis(null); setManual([]); setAi(null); setShowManual(false);
    const url = apiUrl.trim().replace(/\/+$/, '');
    if (!url) { setAi({ kind: 'noapi', text: 'Сервис анализа фото не подключён. Укажите его адрес в настройках.' }); return; }
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
      setAi({ kind: 'info', text: (v.equipment ? `На фото: ${v.equipment}. ` : '') +
        (v.findings.length ? `Найдено дефектов: ${v.findings.length}.` : 'Видимых дефектов не найдено.') });
    } catch (e) {
      if (my !== run.current) return;
      setAi({ kind: 'error', text: 'Сервис анализа не ответил. Проверьте адрес в настройках и подключение к сети.' });
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
    } catch (e) { setAi({ kind: 'error', text: 'Не удалось открыть галерею.' }); }
  };
  const pickSample = (smp) => {
    // Пример из кейса: готовая разметка, сервис не вызывается.
    run.current++; setBusy(false); setManual([]); setShowManual(false);
    setPhoto({ source: smp.source, width: smp.width, height: smp.height });
    setVis(smp.preset); setAi({ kind: 'info', text: 'Пример из кейса с готовой разметкой.' });
  };
  const onQr = (data) => {
    setCamMode(null);
    const u = UNITS.find((x) => x.qr === data.trim());
    if (u) chooseUnit(u.id, 'Агрегат определён по QR-коду.');
    else setIdNote('QR-код прочитан, но такого агрегата нет в базе. Выберите его из списка.');
  };
  const record = (action) => {
    const b = model.byComp[sheet];
    if (!b) return;
    const now = Date.now();
    const entry = {
      unit: unit.id, comp: b.c.id, compName: b.c.name, action, note: note.trim().slice(0, 500), status: b.status,
      user: user ? { name: user.name, role: user.role, login: user.login } : null,
      findings: b.findings.map((f) => f.label).join('; '), ts: now,
    };
    const key = `${unit.id}__${b.c.id}`;
    const cs = { ...(compState[key] || {}), lastCheck: now };
    if (action === 'replaced') { cs.at = unit.hours != null ? unit.hours : 0; cs.date = new Date(now).toISOString().slice(0, 10); }
    const h = [entry, ...history].slice(0, 300);
    const c = { ...compState, [key]: cs };
    setHistory(h); setCompState(c); save('obh.history', h); save('obh.comp', c);
    setSheet(null); setNote('');
  };
  const closeSheet = () => { setSheet(null); setNote(''); };
  const switchTab = (id) => { setTab(id); scroll.current?.scrollTo({ y: 0, animated: false }); };

  const closeSettings = () => { setShowSettings(false); setConfirmLogout(false); };
  const doLogout = async () => {
    await logout();
    setConfirmLogout(false); setShowSettings(false); setSheet(null); resetPhoto(); setUser(null);
  };

  if (!authReady) return <Splash />;
  if (!user) return <AuthScreen onAuth={(u) => { setUser(u); setTab('inspect'); }} />;

  if (camMode) {
    return (
      <CameraScreen mode={camMode} onClose={() => setCamMode(null)} onQr={onQr}
        hints={attention.slice(0, 3).map((b) => ({ id: b.c.id, name: b.c.name, status: b.status, reason: b.findings[0] ? b.findings[0].label : b.res.text }))}
        onPhoto={(p) => { setCamMode(null); analyze(p); }} />
    );
  }

  /* ----- вкладка «Осмотр» ----- */
  const attnShown = showAllAttn ? attention : attention.slice(0, 3);
  const top = findings[0];
  const nBoxes = countBoxes(vis);
  const ov = st(model.overall);
  const inspect = (
    <>
      <Step n="1" title="Что проверить" hint={attention.length ? 'По датчикам и ресурсу узлов' : null}>
        {attention.length ? (
          <>
            {attnShown.map((b) => (
              <Item key={b.c.id} status={b.status} onPress={() => setSheet(b.c.id)}>
                <View className={BETWEEN}>
                  <Text className={`${T.h3} flex-1`}>{b.c.name}</Text>
                  <Pill status={b.status} /><Chevron />
                </View>
                <Text className={T.body2}>{b.findings[0] ? b.findings[0].label : b.res.text}</Text>
              </Item>
            ))}
            {attention.length > 3 && (
              <Link title={showAllAttn ? 'Свернуть' : `Показать все (${attention.length})`} onPress={() => setShowAllAttn(!showAllAttn)} />
            )}
          </>
        ) : <Text className={T.muted}>По датчикам и ресурсу замечаний нет. Сделайте обзорное фото агрегата.</Text>}
      </Step>

      <Step n="2" title="Снимите узел" hint="ИИ сам найдёт дефекты на снимке">
        <PhotoStage photo={photo} vis={vis} model={model} busy={busy} onPick={setSheet} />
        {nBoxes > 0 && !busy && <Text className="text-[14px] text-primary text-center">Нажмите на рамку, чтобы открыть узел</Text>}
        <Btn title={photo ? 'Снять новое фото' : 'Снять фото'} kind="primary" icon="camera-outline" onPress={() => setCamMode('photo')} />
        <View className={ROW}>
          <Btn title="Из галереи" icon="images-outline" onPress={pickFromGallery} className="flex-1" />
          {photo && <Btn title="Убрать фото" kind="ghost" onPress={resetPhoto} className="flex-1" />}
        </View>
        {ai && (ai.kind === 'noapi' || ai.kind === 'error') && (
          <View className={`rounded-xl p-3 gap-2.5 ${ai.kind === 'noapi' ? 'bg-check-bg' : 'bg-defect-bg'}`}>
            <Text className={T.body2c}>{ai.text}</Text>
            <Btn small title="Открыть настройки" onPress={() => setShowSettings(true)} className="self-start" />
          </View>
        )}
        {ai && ai.kind === 'info' && <Text className={T.note}>{ai.text}</Text>}
        <View className="gap-2 border-t border-divider pt-3">
          <Text className={T.small}>Нет оборудования рядом? Откройте пример:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            {SAMPLES.map((x) => <Chip key={x.key} title={x.label} onPress={() => pickSample(x)} />)}
          </ScrollView>
        </View>
      </Step>

      <Step n="3" title="Результат">
        <View className={`rounded-xl p-3.5 gap-2 border-l-[5px] ${ov.soft} ${ov.borderL}`}>
          <Text className={`text-[18px] font-bold ${ov.text}`}>{STATUS_TEXT[model.overall]}</Text>
          <Text className={T.body2c}>
            <Text className="font-bold">В первую очередь: </Text>
            {top ? top.action : 'Замечаний нет. Продолжайте плановый обход.'}
          </Text>
        </View>
        <Text className={T.small}>
          {unit.sensors ? `Датчики: запись от ${fmtTs(sensorTime(idx))}` : 'Датчики к агрегату не подключены, вывод только по фото и ресурсу.'}
        </Text>
        {findings.map((f) => (
          <Item key={f.id} status={f.status} onPress={() => setSheet(f.comp)}>
            <View className={BETWEEN}>
              <Text className={`${T.h3} flex-1`}>{f.label}</Text>
              <Pill status={f.status} />
            </View>
            <View className={ROW}>
              <Text className={T.src}>{SRC_TEXT[f.src] || f.src}</Text>
              {f.confidence != null && <Text className={T.src}>уверенность {Math.round(f.confidence * 100)} %</Text>}
            </View>
            <Text className={T.body2}>{f.detail}</Text>
            <Todo text={f.action} />
            <Text className="text-[11.5px] text-faint text-right">Правило {f.id}</Text>
          </Item>
        ))}
        <Text className={T.faint}>Предварительный осмотр. Если видимых дефектов нет, это ещё не подтверждает исправность оборудования.</Text>
        <Link title={showManual ? 'Скрыть ручную правку' : 'ИИ ошибся? Исправить вручную'} onPress={() => setShowManual(!showManual)} />
        {showManual && (
          <View className="gap-3">
            <Text className={T.small}>Отметьте дефекты, которые видите сами. Отметку можно снять повторным нажатием.</Text>
            {unit.comps.map((c) => {
              const rules = RULES.visual_rules.filter((r) => RULE_COMP[r.id] === c.id);
              if (!rules.length) return null;
              return (
                <View key={c.id} className="gap-1.5">
                  <Text className="text-[14px] font-bold text-muted">{c.name}</Text>
                  <View className={ROW}>
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
      </Step>
    </>
  );

  /* ----- вкладка «Карточка» ----- */
  const specRows = [['Модель', unit.model], ...unit.specs,
    ['Ввод в эксплуатацию', fmtDate(unit.commissioned)],
    ['Наработка', unit.hours != null ? `${num(unit.hours, 0)} ч` : 'нет данных'],
    ['Срок службы', `${unit.lifeYears} лет${unit.lifeHours ? `, ресурс ${num(unit.lifeHours, 0)} ч` : ''}`],
    ['Код для QR', unit.qr],
  ];
  const card = (
    <>
      <Card title="Характеристики">
        <View>{specRows.map(([k, v], i) => <KV key={k} k={k} v={v} last={i === specRows.length - 1} />)}</View>
        <Text className={T.note}>{unit.note}</Text>
      </Card>
      <Card title="Узлы и ресурс">
        <Text className={T.small}>Нажмите на узел, чтобы увидеть норматив, расчёт ресурса и фактическое состояние.</Text>
        {Object.values(model.byComp).map((b) => (
          <Item key={b.c.id} status={b.status} onPress={() => setSheet(b.c.id)}>
            <View className={BETWEEN}>
              <Text className={`${T.h3} flex-1`}>{b.c.name}</Text>
              <Pill status={b.status} /><Chevron />
            </View>
            {b.c.norm != null && <Text className={T.small}>Норматив {num(b.c.norm, 0)} ч</Text>}
            <ResBar res={b.res} />
          </Item>
        ))}
      </Card>
    </>
  );

  /* ----- вкладка «Датчики» ----- */
  const sensorsTab = !unit.sensors ? (
    <Card title="Датчики">
      <Text className={T.body}>К этому агрегату датчики не подключены. Диагноз строится по фото и ресурсу узлов.</Text>
    </Card>
  ) : (
    <>
      <Card title="Показать ситуацию">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-1">
          {SCENARIOS.map(([t, i]) => <Chip key={t} title={t} active={idx === i} onPress={() => setIdx(i)} />)}
        </ScrollView>
        <View className="bg-bg rounded-xl p-3 gap-0.5">
          <Text className={T.small}>Момент времени</Text>
          <Text className="text-[20px] font-bold text-fg" style={NUMS}>{fmtTs(sensorTime(idx))}</Text>
          <Text className={T.small}>{num(SENS.rpm[idx], 0)} об/мин · СКЗ {num(SENS.rms[idx], 2)} мм/с</Text>
        </View>
        <View className={ROW}>
          {[['−24 ч', -24], ['−1 ч', -1], ['+1 ч', 1], ['+24 ч', 24]].map(([t, d]) => (
            <Btn key={t} small title={t} className="flex-1" onPress={() => setIdx(Math.max(0, Math.min(499, idx + d)))} />
          ))}
        </View>
        <Text className={T.faint}>Запись {idx + 1} из 500, шаг 1 час. Выбор момента заменяет живой поток с датчиков.</Text>
      </Card>
      <Card title="Показания">
        {RULES.sensor_rules.map((r) => {
          const v = sensorsAt(idx)[r.param];
          const lvl = v > r.alarm ? 'defect' : v > r.warn ? 'check' : 'ok';
          const unitTxt = (r.column.match(/\((.+)\)/) || [])[1] || '';
          const text = lvl === 'ok' ? 'Норма' : lvl === 'check' ? r.warn_label.replace('Пред: ', '') : r.alarm_label.replace('Тревога: ', '');
          return (
            <Item key={r.id} status={lvl}>
              <Text className={T.h3}>{r.column.replace(/\s*\(.+\)/, '')}</Text>
              <View className={BETWEEN}>
                <Text className="text-[28px] font-bold text-fg" style={NUMS}>
                  {num(v, r.param[0] === 't' ? 1 : 2)} <Text className="text-[15px] font-medium text-muted">{unitTxt}</Text>
                </Text>
                <Pill status={lvl} text={text} />
              </View>
              <Spark param={r.param} rule={r} idx={idx} />
              <View className="flex-row items-center gap-3.5">
                <View className="flex-row items-center gap-1.5">
                  <View className="w-4 border-t-2 border-dashed border-check" /><Text className={T.small}>порог {num(r.warn, 1)}</Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <View className="w-4 border-t-2 border-dashed border-defect" /><Text className={T.small}>тревога {num(r.alarm, 1)}</Text>
                </View>
                <Text className={`${T.small} ml-auto`}>96 ч</Text>
              </View>
            </Item>
          );
        })}
      </Card>
    </>
  );

  /* ----- вкладка «История» ----- */
  const rows = history.filter((h) => h.unit === unit.id);
  const historyTab = (
    <Card title="История осмотров" right={<Text className={T.faint}>на телефоне</Text>}>
      {rows.length ? rows.map((h) => {
        const c = st(ACTION_STATUS[h.action] || 'check');
        return (
          <View key={h.ts + h.comp} className={`border border-divider border-l-4 rounded-xl p-3 gap-2 bg-surface ${c.borderL}`}>
            <View className={BETWEEN}>
              <View className={`rounded-md px-2 py-[3px] ${c.soft}`}>
                <Text className={`text-[13px] font-bold ${c.text}`}>{ACTIONS[h.action] || h.action}</Text>
              </View>
              <Text className={T.small}>{fmtTs(h.ts)}</Text>
            </View>
            <Text className={T.h3}>{h.compName}</Text>
            {!!h.findings && <Text className={T.body2}>{h.findings}</Text>}
            {!!h.note && <Text className={T.body2}><Text className="font-bold text-fg">Заметка: </Text>{h.note}</Text>}
            {!!(h.user && h.user.name) && (
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="person-outline" size={15} color={C.muted} />
                <Text className={T.small}>{h.user.name}{h.user.role ? `, ${h.user.role}` : ''}</Text>
              </View>
            )}
          </View>
        );
      }) : (
        <View className="items-center gap-2 py-6 px-2">
          <Text className="text-[17px] font-bold text-fg">Записей пока нет</Text>
          <Text className={`${T.muted} text-center`}>
            Откройте любой узел на вкладке «Осмотр» или «Карточка» и нажмите «Проверено», «Зафиксировать дефект» или «Заменено». Запись появится здесь.
          </Text>
        </View>
      )}
    </Card>
  );

  const sb = sheet ? model.byComp[sheet] : null;
  const HEAD_BTN = 'flex-1 min-h-[52px] gap-[3px] py-1.5 px-1.5 rounded-[10px] bg-white/15 items-center justify-center active:opacity-75';

  return (
    <View className="flex-1 bg-bg">
      <StatusBar barStyle="light-content" backgroundColor={C.primary} />
      <View className="bg-primary px-4 pb-3.5 gap-3" style={{ paddingTop: TOP + 10 }}>
        <View className={BETWEEN}>
          <View className="flex-1">
            <View className="flex-row items-center gap-2.5">
              <Text className="text-white text-[15px] font-extrabold tracking-[0.5px]">MaintAR</Text>
              <Pressable onPress={() => setShowSettings(true)} hitSlop={6}
                className="flex-row items-center gap-[5px] bg-white/15 rounded-full px-[9px] py-[3px] max-w-[190px]">
                <Ionicons name="person-circle-outline" size={16} color="#fff" />
                <Text className="text-white text-[12.5px] font-semibold" numberOfLines={1}>{user.name}</Text>
              </Pressable>
            </View>
            <Text className="text-white text-[20px] font-bold mt-0.5" numberOfLines={2}>{unit.name}</Text>
            <Text className="text-white/75 text-[13px] mt-0.5">{unit.id}{unit.demo ? ' · учебная карточка' : ' · по паспорту'}</Text>
          </View>
          <Pill status={model.overall} big />
        </View>
        <View className="flex-row gap-2">
          <Pressable className={HEAD_BTN} onPress={() => setCamMode('qr')}>
            <Ionicons name="qr-code-outline" size={18} color="#fff" /><Text className="text-white text-[12px] font-semibold text-center">Сканировать QR</Text>
          </Pressable>
          <Pressable className={HEAD_BTN} onPress={() => setShowUnits(true)}>
            <Ionicons name="swap-horizontal-outline" size={18} color="#fff" /><Text className="text-white text-[12px] font-semibold text-center">Сменить агрегат</Text>
          </Pressable>
          <Pressable className={HEAD_BTN} onPress={() => setShowSettings(true)}>
            <Ionicons name="settings-outline" size={18} color="#fff" /><Text className="text-white text-[12px] font-semibold text-center">Настройки</Text>
          </Pressable>
        </View>
        {!!idNote && <Text className="text-white text-[13px] opacity-90">{idNote}</Text>}
      </View>

      <ScrollView ref={scroll} contentContainerClassName="p-3.5 pb-7 gap-3.5" keyboardShouldPersistTaps="handled">
        {tab === 'inspect' ? inspect : tab === 'card' ? card : tab === 'sensors' ? sensorsTab : historyTab}
      </ScrollView>

      <View className="flex-row bg-surface border-t border-line" style={{ paddingBottom: BOTTOM }}>
        {TABS.map(([id, title, icon]) => {
          const on = tab === id;
          return (
            <Pressable key={id} onPress={() => switchTab(id)} className="flex-1 items-center min-h-[64px] justify-center">
              <View className={`absolute top-0 left-[22%] right-[22%] h-[3px] rounded-b-[3px] ${on ? 'bg-primary' : ''}`} />
              <View className={`px-3.5 py-1.5 rounded-xl items-center gap-0.5 ${on ? 'bg-primary-soft' : ''}`}>
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
          <View className="flex-1 gap-1.5">
            <Text className={T.h1}>{sb.c.name}</Text>
            <View className="self-start"><Pill status={sb.status} text={STATUS_TEXT[sb.status]} /></View>
          </View>
        )}>
        {sb && (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3 pb-2">
            <Text className={T.muted}>{sb.c.desc}</Text>
            <Block title="По нормативу">
              <KV k="Нормативный срок" v={sb.c.norm != null ? `${num(sb.c.norm, 0)} ч` : 'не задан'} />
              <KV k="Установлен" v={fmtDate(sb.res.s.date)} last />
            </Block>
            <Block title="Расчёт ресурса">
              {sb.res.kind === 'calc' && <KV k="Наработка узла" v={`${num(sb.res.used, 0)} ч`} />}
              <ResBar res={sb.res} />
            </Block>
            <Block title="Фактическое состояние">
              <Text className={`${T.body} font-semibold ${sb.findings.length ? st(sb.cond).text : 'text-ok'}`}>
                {sb.findings.length ? STATUS_TEXT[sb.cond] : 'Замечаний по фото и датчикам нет'}
              </Text>
              <KV k="Последняя проверка" v={sb.res.s.lastCheck ? fmtTs(sb.res.s.lastCheck) : 'нет записей'} last />
            </Block>
            {sb.findings.length > 0 && <Text className={T.h2}>Рекомендации</Text>}
            {sortFindings(sb.findings).map((f) => (
              <Item key={f.id} status={f.status}>
                <Text className={T.h3}>{f.label}</Text>
                <Text className={T.src}>{SRC_TEXT[f.src] || f.src}</Text>
                <Text className={T.body2}>{f.detail}</Text>
                <Todo text={f.action} />
              </Item>
            ))}
            <TextInput className={`${INPUT} min-h-[80px]`} style={{ textAlignVertical: 'top' }} multiline value={note} onChangeText={setNote}
              placeholder="Заметка: что увидели и что сделали" placeholderTextColor={C.faint} />
            <Btn title="Проверено" kind="primary" onPress={() => record('checked')} />
            <Btn title="Зафиксировать дефект" kind="danger" onPress={() => record('defect')} />
            <Btn title="Заменено" onPress={() => record('replaced')} />
          </ScrollView>
        )}
      </Sheet>

      {/* выбор агрегата */}
      <Sheet visible={showUnits} onClose={() => setShowUnits(false)} title="Выберите агрегат">
        {UNITS.map((u) => {
          const on = u.id === unitId;
          return (
            <Pressable key={u.id} onPress={() => chooseUnit(u.id, '')}
              className={`flex-row items-center gap-2.5 border rounded-xl p-3.5 active:opacity-75 ${on ? 'border-primary bg-primary-soft' : 'border-line'}`}>
              <View className="flex-1 gap-0.5">
                <Text className={T.h3}>{u.name}</Text>
                <Text className={T.small}>{u.id}{u.sensors ? ' · есть датчики' : ' · без датчиков'}</Text>
              </View>
              {on ? <Text className={`${T.small} text-primary font-bold`}>Выбран</Text> : <Chevron />}
            </Pressable>
          );
        })}
        <Btn title="Сканировать QR-код" onPress={() => { setShowUnits(false); setCamMode('qr'); }} />
      </Sheet>

      {/* настройки */}
      <Sheet visible={showSettings} onClose={closeSettings} title="Настройки">
        <Block title="Сотрудник">
          <View className={BETWEEN}>
            <Ionicons name="person-circle-outline" size={40} color={C.primary} />
            <View className="flex-1">
              <Text className={T.h3}>{user.name}</Text>
              <Text className={T.small}>{user.role} · логин {user.login}</Text>
            </View>
          </View>
          {confirmLogout ? (
            <View className="gap-2">
              <Text className={T.body}>Выйти из учётной записи? История осмотров останется на телефоне.</Text>
              <View className={ROW}>
                <Btn title="Выйти" kind="danger" icon="log-out-outline" onPress={doLogout} className="flex-1" />
                <Btn title="Отмена" onPress={() => setConfirmLogout(false)} className="flex-1" />
              </View>
            </View>
          ) : (
            <Btn title="Выйти" icon="log-out-outline" onPress={() => setConfirmLogout(true)} />
          )}
        </Block>
        <Text className={T.h3}>Сервис анализа фото</Text>
        <Text className={T.muted}>Адрес сервера, который находит дефекты на снимке. Например: http://192.168.1.50:8000</Text>
        <TextInput className={`${INPUT} min-h-[48px]`} value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false}
          keyboardType="url" placeholder="http://адрес-сервера:8000" placeholderTextColor={C.faint} />
        <Text className={T.faint}>{apiUrl.trim() ? 'Адрес задан. Новые фото будут отправляться на анализ.' : 'Адрес не задан. Без него ИИ не сможет проверить ваши фото.'}</Text>
        <Btn title="Готово" kind="primary" onPress={closeSettings} />
      </Sheet>
    </View>
  );
}
