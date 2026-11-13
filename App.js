// MaintAR: AR-помощник инженера для диагностики промышленного оборудования.
// Всё работает на телефоне без сервера: правила, датчики из базы кейса, карточки, ресурс, история.
// Дефекты на фото определяет сервис анализа (адрес задаётся в профиле). Ручная правка нужна, только если ИИ ошибся.
// Стили: Tailwind через NativeWind (className). Палитра в src/theme.js, inline style только для значений, вычисляемых на лету.
//
// Дизайн-система:
//  - сетка 8: отступ экрана 16, между блоками 24, внутри карточек 16; радиус 12 у карточек и кнопок; одна граница на всё;
//  - три размера текста: заголовок 24, основной 17, подписи 14;
//  - на экране одна главная кнопка (56, во всю ширину, внизу), второстепенные контурные (48), ссылки остаются ссылками;
//  - статус всегда показан иконкой, словом и цветом.
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
  RULES, SENS, SERIES, RULE_COMP, STATUS_SHORT, buildModel, cleanVision, fmtDate, fmtTs, num, sensorTime, sensorsAt,
} from './src/engine';

const TABS = [['inspect', 'Осмотр', 'scan-outline'], ['unit', 'Оборудование', 'construct-outline'], ['history', 'Журнал', 'time-outline']];
const ACTIONS = { inspection: 'Осмотр по фото', checked: 'Проверено', defect: 'Дефект', replaced: 'Заменено' };
const ACTION_STATUS = { checked: 'ok', defect: 'defect', replaced: 'ok' };
const ACTION_ICON = { inspection: 'camera', checked: 'checkmark', defect: 'warning-outline', replaced: 'refresh' };
const SRC_TEXT = { 'камера': 'по фото', 'датчики': 'по датчикам', 'камера + датчики': 'по фото и датчикам' };
const RANK = { defect: 2, check: 1, ok: 0 };
const SHORT = { 'CN-1': 'ЦН-1', 'AMS-21031004-1': 'Насос AMS' };
const COMP_ICON = {
  impeller: 'sync-outline', rotor: 'sync-outline', stator: 'disc-outline', bearing: 'radio-button-on-outline', seal: 'water-outline',
  coupling: 'link-outline', motor: 'flash-outline', terminal: 'git-network-outline', casing: 'cube-outline', frame: 'grid-outline',
  piping: 'git-commit-outline',
};
// Человеческие названия датчиков вместо аббревиатур из базы.
const SENSOR_NAME = {
  amp_1x: ['Вибрация: дисбаланс', 'pulse-outline'], amp_2x: ['Вибрация: центровка', 'pulse-outline'],
  hf_noise: ['Шум подшипника', 'volume-high-outline'], t_bearing: ['Температура подшипника', 'thermometer-outline'],
  t_winding: ['Температура двигателя', 'thermometer-outline'],
};

// Статус: цвет, слово и иконка вместе. Строки классов целиком, чтобы Tailwind их нашёл.
const ST = {
  ok: { text: 'text-ok', bg: 'bg-ok', soft: 'bg-ok-bg', border: 'border-ok', word: 'Норма', icon: 'checkmark-circle', color: C.ok },
  check: { text: 'text-check', bg: 'bg-check', soft: 'bg-check-bg', border: 'border-check', word: 'Проверить', icon: 'alert-circle', color: C.check },
  defect: { text: 'text-defect', bg: 'bg-defect', soft: 'bg-defect-bg', border: 'border-defect', word: 'Дефект', icon: 'close-circle', color: C.defect },
};
const st = (status) => ST[status] || ST.ok;

// Три размера текста.
const T = {
  title: 'text-[24px] leading-[30px] font-semibold text-fg',
  body: 'text-[17px] leading-[24px] text-fg',
  bodyB: 'text-[17px] leading-[24px] font-semibold text-fg',
  cap: 'text-[14px] leading-[20px] text-muted',
};
const CARD = 'bg-surface rounded-xl border border-divider p-4 gap-4';

const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : Platform.OS === 'web' ? 0 : 47;
const BOTTOM = (() => {
  if (Platform.OS === 'ios') return 24;
  if (Platform.OS === 'web') return 8;
  const scr = Dimensions.get('screen').height;
  const win = Dimensions.get('window').height;
  const nav = scr - win - (StatusBar.currentHeight || 0);
  return Math.max(16, Math.min(nav, 56));
})();

async function load(key, fallback) {
  try { const v = await AsyncStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function save(key, value) { AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {}); }

const sortFindings = (list) => [...list].sort((a, b) =>
  (b.combined ? 1 : 0) - (a.combined ? 1 : 0) || RANK[b.status] - RANK[a.status]);
const worst = (list) => list.reduce((m, f) => (RANK[f.status] > RANK[m] ? f.status : m), 'ok');
const uniq = (arr) => [...new Set(arr)];
const resText = (res) => (res.kind === 'calc' ? (res.rem <= 0 ? 'Ресурс исчерпан' : `Осталось ${num(res.rem, 0)} ч`) : res.kind === 'nodata' ? 'Нет данных о наработке' : 'Обслуживание по состоянию');
const resShort = (res) => (res.kind === 'calc' ? resText(res) : res.kind === 'nodata' ? 'Нет данных' : 'Без норматива');
const reasonOf = (b) => (b.findings[0] ? b.findings[0].label.replace(/^(Пред|Тревога):\s*/, '') : resText(b.res));

/* ---------- базовые элементы ---------- */
function Status({ status, big }) {
  const c = st(status);
  return (
    <View className={`flex-row items-center self-start gap-1.5 rounded-full ${big ? 'px-3 py-1.5' : 'px-2.5 py-1'} ${c.soft}`}>
      <Ionicons name={c.icon} size={big ? 20 : 16} color={c.color} />
      <Text className={`text-[14px] font-semibold ${c.text}`}>{c.word}</Text>
    </View>
  );
}
function Primary({ title, icon, onPress, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      className={`h-14 rounded-xl bg-primary flex-row items-center justify-center gap-2 active:opacity-85 ${disabled ? 'opacity-50' : ''}`}>
      {!!icon && <Ionicons name={icon} size={24} color="#fff" />}
      <Text className="text-[17px] font-semibold text-white">{title}</Text>
    </Pressable>
  );
}
function Secondary({ title, icon, onPress, danger, className = '' }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      className={`h-12 px-4 rounded-xl border bg-surface flex-row items-center justify-center gap-2 active:opacity-70 ${danger ? 'border-defect' : 'border-line'} ${className}`}>
      {!!icon && <Ionicons name={icon} size={20} color={danger ? C.defect : C.primary} />}
      <Text className={`text-[17px] font-semibold ${danger ? 'text-defect' : 'text-primary'}`}>{title}</Text>
    </Pressable>
  );
}
function Link({ title, icon, onPress, center }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="link"
      className={`min-h-[48px] flex-row items-center gap-1.5 active:opacity-60 ${center ? 'self-center' : 'self-start'}`}>
      {!!icon && <Ionicons name={icon} size={20} color={C.primary} />}
      <Text className="text-[17px] text-primary underline">{title}</Text>
    </Pressable>
  );
}
function Chip({ title, active, onPress }) {
  return (
    <Pressable onPress={onPress}
      className={`min-h-[48px] justify-center border rounded-xl px-4 active:opacity-80 ${active ? 'bg-primary border-primary' : 'bg-surface border-line'}`}>
      <Text className={`text-[17px] ${active ? 'text-white font-semibold' : 'text-fg'}`}>{title}</Text>
    </Pressable>
  );
}
// Строка списка: иконка в кружке цвета статуса, заголовок, подпись, стрелка.
function Row({ icon, status, title, sub, right, onPress, last }) {
  const c = status ? st(status) : null;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      className={`flex-row items-center gap-3 min-h-[64px] py-3 active:opacity-60 ${last ? '' : 'border-b border-divider'}`}>
      {!!icon && (
        <View className={`w-10 h-10 rounded-full items-center justify-center ${c ? c.soft : 'bg-sunken'}`}>
          <Ionicons name={icon} size={22} color={c ? c.color : C.primary} />
        </View>
      )}
      <View className="flex-1 gap-0.5">
        <Text className={T.bodyB} numberOfLines={2}>{title}</Text>
        {!!sub && <Text className={T.cap} numberOfLines={2}>{sub}</Text>}
      </View>
      {right}
      {!!onPress && <Ionicons name="chevron-forward" size={22} color={C.muted} />}
    </Pressable>
  );
}
const Section = ({ title, children, right }) => (
  <View className="gap-2">
    <View className="flex-row items-center justify-between px-1">
      <Text className="text-[14px] leading-[20px] font-semibold text-muted uppercase tracking-[0.5px]">{title}</Text>
      {right}
    </View>
    <View className="bg-surface rounded-xl border border-divider px-4">{children}</View>
  </View>
);
const KV = ({ k, v, last }) => (
  <View className={`flex-row gap-3 py-3 ${last ? '' : 'border-b border-divider'}`}>
    <Text className={`${T.cap} flex-1`}>{k}</Text>
    <Text className="flex-[1.3] text-[17px] leading-[24px] text-fg text-right">{v}</Text>
  </View>
);
function Expand({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable onPress={() => setOpen(!open)} className="min-h-[48px] flex-row items-center gap-2 active:opacity-60">
        <Text className="text-[17px] text-primary font-semibold flex-1">{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={C.primary} />
      </Pressable>
      {open && <View className="gap-3 pt-1 pb-2">{children}</View>}
    </View>
  );
}
// Нумерованные шаги «что сделать».
function Steps({ items, onPress }) {
  return (
    <View className="gap-3">
      {items.map((s, i) => (
        <Pressable key={i} onPress={onPress ? () => onPress(s) : undefined} disabled={!onPress} className="flex-row gap-3 active:opacity-60">
          <View className="w-7 h-7 rounded-full bg-primary items-center justify-center mt-0.5">
            <Text className="text-[14px] font-semibold text-white">{i + 1}</Text>
          </View>
          <Text className={`${T.body} flex-1`}>{s.text}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const Empty = ({ icon, text, children }) => (
  <View className="items-center gap-3 py-8 px-4">
    <View className="w-16 h-16 rounded-full bg-sunken items-center justify-center">
      <Ionicons name={icon} size={32} color={C.primary} />
    </View>
    <Text className={`${T.body} text-center`}>{text}</Text>
    {children}
  </View>
);

function ResBar({ res }) {
  if (res.kind !== 'calc') return <Text className={T.body}>{resText(res)}</Text>;
  const c = st(res.status);
  return (
    <View className="gap-2">
      <Text className={T.body}>{resText(res)}</Text>
      <View className="h-3 rounded-full bg-sunken overflow-hidden">
        <View className={`h-full rounded-full ${c.bg}`} style={{ width: `${Math.max(3, res.pct)}%` }} />
      </View>
      <Text className={T.cap}>Использовано {num(res.pct, 0)} % срока</Text>
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
  const LABEL_H = 24;
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
          <Pressable key={b.key} onPress={() => onPick(b.comp)} hitSlop={6}
            className={`absolute border-[3px] rounded ${c.border} ${b.status === 'ok' ? 'border-dashed' : 'border-solid'}`}
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
            <View className={`absolute h-6 justify-center px-2 rounded ${c.bg}`}
              style={{ maxWidth: Math.max(60, maxW), top: inside ? 0 : -LABEL_H - 1, [rightSide ? 'right' : 'left']: -3 }}>
              <Text numberOfLines={1} className="text-white text-[14px] font-semibold">{b.label}</Text>
            </View>
          </Pressable>
        );
      })}
      {busy && (
        <View className="absolute inset-0 bg-[#081822]/60 items-center justify-center gap-3">
          <ActivityIndicator color="#fff" size="large" />
          <Text className="text-white text-[17px] font-semibold">ИИ проверяет фото…</Text>
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
  const H = 72;
  return (
    <View style={{ height: H }}>
      <View className="flex-row items-end gap-px" style={{ height: H }}>
        {seg.map((v, i) => (
          <View key={i} className={`flex-1 rounded-t-[1px] ${v > rule.alarm ? 'bg-defect' : v > rule.warn ? 'bg-check' : 'bg-[#7fa9bb]'}`}
            style={{ height: Math.max(1, (v / top) * H) }} />
        ))}
      </View>
      <View className="absolute left-0 right-0 border-t-2 border-dashed border-check" style={{ bottom: (rule.warn / top) * H }} />
      <View className="absolute left-0 right-0 border-t-2 border-dashed border-defect" style={{ bottom: (rule.alarm / top) * H }} />
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
      <View className={`${wrap} p-6 gap-4`}>
        <Text className="text-white text-[17px] text-center">Нет доступа к камере. Разрешите его, чтобы снимать узлы и сканировать QR-коды.</Text>
        <View className="self-stretch gap-3">
          <Primary title="Разрешить камеру" onPress={requestPerm} />
          <Secondary title="Назад" onPress={onClose} />
        </View>
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
      {mode === 'qr' && <View className="w-60 h-60 border-[3px] border-white rounded-xl" pointerEvents="none" />}
      <View className="absolute top-0 left-0 right-0 px-4 pb-4 gap-2 bg-black/60" style={{ paddingTop: TOP + 16 }}>
        <Text className="text-white text-[24px] font-semibold">{mode === 'qr' ? 'Наведите на QR-код' : 'Наведите на узел'}</Text>
        {mode !== 'qr' && hints.length > 0 && <Text className="text-white text-[17px]">Сначала: {hints.join(', ')}</Text>}
      </View>
      <View className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-6 pt-6 bg-black/60"
        style={{ paddingBottom: BOTTOM + 16 }}>
        <Pressable onPress={onClose} className="w-20 h-12 items-center justify-center rounded-xl border border-white/50 active:opacity-70">
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

/* ---------- выезжающее снизу окно ---------- */
function Sheet({ visible, onClose, title, head, children, footer }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-[#050c12]/50">
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Закрыть окно" />
        {visible && (
          <View className="bg-bg rounded-t-2xl px-4 pt-2 gap-4 max-h-[92%]" style={{ paddingBottom: BOTTOM + 8 }}>
            <View className="self-center w-10 h-1 rounded-full bg-line" />
            <View className="flex-row items-start gap-3">
              {head || <Text className={`${T.title} flex-1`}>{title}</Text>}
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Закрыть"
                className="w-12 h-12 rounded-full bg-surface border border-divider items-center justify-center active:opacity-70">
                <Ionicons name="close" size={24} color={C.fg} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 pb-2">{children}</ScrollView>
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
  const [ai, setAi] = useState(null); // {kind: 'noapi' | 'error', text}
  const [toast, setToast] = useState('');
  const [history, setHistory] = useState([]);
  const [compState, setCompState] = useState({});
  const [apiUrl, setApiUrl] = useState('');
  const [demo, setDemo] = useState(false); // режим демонстрации: примеры фото, сценарии датчиков
  const [tips, setTips] = useState(true);  // подсказка-шаги для новичка
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
      if (typeof ui.tips === 'boolean') setTips(ui.tips);
    })();
  }, []);
  useEffect(() => { save('obh.ui', { unitId, idx, apiUrl, demo, tips }); }, [unitId, idx, apiUrl, demo, tips]);

  const unit = UNITS.find((u) => u.id === unitId);
  const classes = useMemo(() => [
    ...(vis ? vis.findings : []),
    ...manual.map((cls) => ({ cls, confidence: null, explanation: 'Отмечено инженером вручную.' })),
  ], [vis, manual]);
  const model = useMemo(() => buildModel(unit, idx, classes, compState), [unit, idx, classes, compState]);
  const attention = Object.values(model.byComp).filter((b) => b.status !== 'ok').sort((a, b) => RANK[b.status] - RANK[a.status]);
  const findings = sortFindings(model.findings);
  // Для результата осмотра берём только то, что видно на фото (в том числе подтверждённое датчиками).
  const photoFindings = findings.filter((f) => f.src.includes('камера'));

  const flash = (text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2800);
  };
  const resetPhoto = () => { run.current++; setPhoto(null); setVis(null); setManual([]); setAi(null); setBusy(false); setShowManual(false); };
  const chooseUnit = (id, msg) => { setUnitId(id); resetPhoto(); setShowUnits(false); setOpenSensor(null); if (msg) flash(msg); };
  const toTop = () => scroll.current?.scrollTo({ y: 0, animated: false });

  // Анализ фото через сервис команды. Если сервиса нет, понятно сообщаем об этом.
  const analyze = async (p) => {
    const my = ++run.current;
    setPhoto(p); setVis(null); setManual([]); setAi(null); setShowManual(false); setTab('inspect'); toTop();
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
    } catch (e) {
      if (my !== run.current) return;
      setAi({ kind: 'error', text: 'Сервис анализа не ответил. Проверьте адрес в профиле и интернет.' });
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
    } catch (e) { flash('Не удалось открыть галерею'); }
  };
  const pickSample = (smp) => {
    // Пример из кейса: готовая разметка, сервис не вызывается.
    run.current++; setBusy(false); setManual([]); setShowManual(false); setAi(null);
    setPhoto({ source: smp.source, width: smp.width, height: smp.height });
    setVis(smp.preset); setTab('inspect'); toTop();
  };
  const onQr = (data) => {
    setCamMode(null);
    const u = UNITS.find((x) => x.qr === data.trim());
    if (u) chooseUnit(u.id, `Агрегат: ${SHORT[u.id] || u.id}`);
    else flash('Такого агрегата нет в базе');
  };
  const who = () => (user ? { name: user.name, role: user.role, login: user.login } : null);
  const pushHistory = (entry) => { const h = [entry, ...history].slice(0, 300); setHistory(h); save('obh.history', h); };
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
      unit: unit.id, comp: null, compName: 'Осмотр по фото', action: 'inspection', note: '', status: worst(photoFindings),
      user: who(), findings: photoFindings.map((f) => f.label).join('; '), ts: Date.now(),
    });
    resetPhoto();
    flash('Сохранено в журнал');
  };
  const closeSheet = () => { setSheet(null); setNote(''); setShowNote(false); };
  const switchTab = (id) => { setTab(id); toTop(); };
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
        hints={attention.slice(0, 2).map((b) => b.c.name)}
        onPhoto={(p) => { setCamMode(null); analyze(p); }} />
    );
  }

  const ov = st(model.overall);

  /* ----- Осмотр: стартовый экран ----- */
  const first = attention[0];
  const inspectStart = (
    <>
      <View className={CARD}>
        <View className="gap-2">
          <Text className={T.title}>{unit.name}</Text>
          <Status status={model.overall} big />
        </View>
        <Text className={T.body}>
          {first
            ? <>Требуют внимания: {attention.length}. Начните с узла <Text className="font-semibold">«{first.c.name}»</Text>.</>
            : 'Все узлы в норме. Сделайте обзорное фото агрегата.'}
        </Text>
        <Secondary title="Сменить агрегат" icon="swap-horizontal" onPress={() => setShowUnits(true)} />
      </View>

      {tips && (
        <View className={CARD}>
          <Text className={T.bodyB}>Как пройти осмотр</Text>
          <Steps items={[
            { text: 'Сфотографируйте узел кнопкой внизу.' },
            { text: 'Посмотрите, что нашёл ИИ, и что нужно сделать.' },
            { text: 'Сохраните результат в журнал.' },
          ]} />
          <Link title="Понятно, скрыть" onPress={() => setTips(false)} />
        </View>
      )}

      {attention.length > 0 && (
        <Section title="Требуют внимания">
          {attention.map((b, i) => (
            <Row key={b.c.id} icon={COMP_ICON[b.c.id] || 'hardware-chip-outline'} status={b.status} title={b.c.name}
              sub={`${st(b.status).word}: ${reasonOf(b)}`} onPress={() => setSheet(b.c.id)} last={i === attention.length - 1} />
          ))}
        </Section>
      )}

      {demo && (
        <Section title="Режим демонстрации: примеры фото">
          {SAMPLES.map((x, i) => (
            <Row key={x.key} icon="images-outline" title={x.label} sub="Готовая разметка из кейса" onPress={() => pickSample(x)} last={i === SAMPLES.length - 1} />
          ))}
        </Section>
      )}
    </>
  );

  /* ----- Осмотр: результат по фото ----- */
  const vStatus = worst(photoFindings);
  const vc = st(vStatus);
  const steps = uniq(photoFindings.map((f) => f.action)).slice(0, 3).map((text) => ({ text, comp: photoFindings.find((f) => f.action === text).comp }));
  const sensorOnly = findings.filter((f) => !f.src.includes('камера'));
  const inspectResult = photo && (
    <>
      {busy ? (
        <View className={`${CARD} flex-row items-center`}>
          <ActivityIndicator color={C.primary} />
          <Text className={T.body}>ИИ проверяет фото…</Text>
        </View>
      ) : ai ? (
        <View className={`${CARD} bg-check-bg border-check`}>
          <View className="flex-row items-center gap-2">
            <Ionicons name="alert-circle" size={28} color={C.check} />
            <Text className={`${T.title} text-check`}>Нет проверки ИИ</Text>
          </View>
          <Text className={T.body}>{ai.text}</Text>
          <Secondary title="Открыть профиль" icon="person" onPress={() => setShowProfile(true)} />
        </View>
      ) : (
        <View className={`rounded-xl p-4 gap-2 border ${vc.soft} ${vc.border}`}>
          <View className="flex-row items-center gap-2">
            <Ionicons name={vc.icon} size={32} color={vc.color} />
            <Text className={`${T.title} ${vc.text}`}>{vc.word}</Text>
          </View>
          <Text className={T.body}>
            {photoFindings.length ? `На фото найдено проблем: ${photoFindings.length}.` : 'На фото дефектов не видно.'}
          </Text>
        </View>
      )}

      <PhotoStage photo={photo} vis={vis} model={model} busy={busy} onPick={setSheet} />

      {!busy && !ai && (
        <>
          <View className={CARD}>
            <Text className={T.bodyB}>Что сделать</Text>
            {steps.length
              ? <Steps items={steps} onPress={(s) => setSheet(s.comp)} />
              : <Steps items={[{ text: 'Ничего срочного. Продолжайте обход.' }]} />}
          </View>
          {photoFindings.length > 0 && (
            <Section title="Найдено на фото">
              {photoFindings.map((f, i) => (
                <Row key={f.id} icon={COMP_ICON[f.comp] || 'hardware-chip-outline'} status={f.status} title={f.label}
                  sub={st(f.status).word} onPress={() => setSheet(f.comp)} last={i === photoFindings.length - 1} />
              ))}
            </Section>
          )}
          {sensorOnly.length > 0 && (
            <Text className={`${T.cap} px-1`}>По датчикам есть ещё замечания: смотрите вкладку «Оборудование».</Text>
          )}
          <Link center title={showManual ? 'Скрыть ручную правку' : 'ИИ ошибся? Исправить'} onPress={() => setShowManual(!showManual)} />
          {showManual && (
            <View className={CARD}>
              <Text className={T.cap}>Отметьте то, что видите сами. Повторное нажатие снимает отметку.</Text>
              {unit.comps.map((c) => {
                const rules = RULES.visual_rules.filter((r) => RULE_COMP[r.id] === c.id);
                if (!rules.length) return null;
                return (
                  <View key={c.id} className="gap-2">
                    <Text className={T.bodyB}>{c.name}</Text>
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
      )}
    </>
  );

  /* ----- Оборудование ----- */
  const comps = Object.values(model.byComp);
  const sensorRows = unit.sensors ? RULES.sensor_rules.map((r) => {
    const v = sensorsAt(idx)[r.param];
    const lvl = v > r.alarm ? 'defect' : v > r.warn ? 'check' : 'ok';
    const unitTxt = (r.column.match(/\((.+)\)/) || [])[1] || '';
    const [name, icon] = SENSOR_NAME[r.param] || [r.column, 'pulse-outline'];
    return { r, v, lvl, unitTxt, name, icon };
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
        <View className="gap-2">
          <Text className={T.title}>{unit.name}</Text>
          <Status status={model.overall} big />
        </View>
        <Secondary title="Сменить агрегат" icon="swap-horizontal" onPress={() => setShowUnits(true)} />
      </View>

      <Section title="Узлы">
        {comps.map((b, i) => (
          <Row key={b.c.id} icon={COMP_ICON[b.c.id] || 'hardware-chip-outline'} status={b.status} title={b.c.name}
            sub={`${st(b.status).word} · ${resShort(b.res)}`} onPress={() => setSheet(b.c.id)} last={i === comps.length - 1} />
        ))}
      </Section>

      <Section title="Датчики" right={unit.sensors ? <Text className={T.cap}>{fmtTs(sensorTime(idx))}</Text> : null}>
        {!unit.sensors && <Empty icon="pulse-outline" text="Датчики к этому агрегату не подключены." />}
        {sensorRows.map(({ r, v, lvl, unitTxt, name, icon }, i) => {
          const open = openSensor === r.id;
          const c = st(lvl);
          return (
            <View key={r.id} className={i === sensorRows.length - 1 ? '' : 'border-b border-divider'}>
              <Pressable onPress={() => setOpenSensor(open ? null : r.id)} className="flex-row items-center gap-3 min-h-[64px] py-3 active:opacity-60">
                <View className={`w-10 h-10 rounded-full items-center justify-center ${c.soft}`}>
                  <Ionicons name={icon} size={22} color={c.color} />
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className={T.bodyB} numberOfLines={2}>{name}</Text>
                  <Text className={`text-[14px] leading-[20px] font-semibold ${c.text}`}>{c.word}</Text>
                </View>
                <Text className={T.bodyB} style={{ fontVariant: ['tabular-nums'] }}>
                  {num(v, r.param[0] === 't' ? 1 : 2)} <Text className="text-[14px] font-normal text-muted">{unitTxt}</Text>
                </Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={C.muted} />
              </Pressable>
              {open && (
                <View className="pb-4 gap-2">
                  <Spark param={r.param} rule={r} idx={idx} />
                  <Text className={T.cap}>Последние 96 часов. Жёлтая линия: внимание ({num(r.warn, 1)}), красная: опасно ({num(r.alarm, 1)}).</Text>
                </View>
              )}
            </View>
          );
        })}
      </Section>

      {demo && unit.sensors && (
        <View className={CARD}>
          <Text className={T.bodyB}>Режим демонстрации: ситуация на датчиках</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            {SCENARIOS.map(([t, i]) => <Chip key={t} title={t} active={idx === i} onPress={() => setIdx(i)} />)}
          </ScrollView>
          <View className="flex-row gap-2">
            <Secondary title="−1 час" onPress={() => setIdx(Math.max(0, idx - 1))} className="flex-1" />
            <Secondary title="+1 час" onPress={() => setIdx(Math.min(499, idx + 1))} className="flex-1" />
          </View>
        </View>
      )}

      <View className="bg-surface rounded-xl border border-divider px-4">
        <Expand title="Характеристики агрегата">
          <View>{specRows.map(([k, v], i) => <KV key={k} k={k} v={v} last={i === specRows.length - 1} />)}</View>
          <Text className={T.cap}>{unit.note}</Text>
        </Expand>
      </View>
    </>
  );

  /* ----- Журнал ----- */
  const historyTab = history.length ? (
    <Section title="Последние записи">
      {history.map((h, i) => {
        const key = h.ts + (h.comp || 'insp');
        const open = openHist === key;
        const status = h.action === 'inspection' ? h.status : ACTION_STATUS[h.action] || 'check';
        const c = st(status);
        return (
          <View key={key} className={i === history.length - 1 ? '' : 'border-b border-divider'}>
            <Pressable onPress={() => setOpenHist(open ? null : key)} className="flex-row items-center gap-3 min-h-[64px] py-3 active:opacity-60">
              <View className={`w-10 h-10 rounded-full items-center justify-center ${c.soft}`}>
                <Ionicons name={ACTION_ICON[h.action] || 'document-text-outline'} size={22} color={c.color} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className={T.bodyB} numberOfLines={1}>{h.compName}</Text>
                <Text className={T.cap} numberOfLines={1}>{fmtTs(h.ts)} · {SHORT[h.unit] || h.unit}</Text>
              </View>
              <Text className={`text-[14px] font-semibold ${c.text}`}>{h.action === 'inspection' ? c.word : ACTIONS[h.action]}</Text>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={C.muted} />
            </Pressable>
            {open && (
              <View className="pb-4 gap-2">
                {!!h.findings && <Text className={T.body}>{h.findings}</Text>}
                {!h.findings && <Text className={T.body}>Замечаний не было.</Text>}
                {!!h.note && <Text className={T.body}>Заметка: {h.note}</Text>}
                {!!(h.user && h.user.name) && <Text className={T.cap}>{h.user.name}{h.user.role ? `, ${h.user.role}` : ''}</Text>}
              </View>
            )}
          </View>
        );
      })}
    </Section>
  ) : (
    <View className="bg-surface rounded-xl border border-divider">
      <Empty icon="document-text-outline" text="Здесь появятся ваши осмотры и отметки по узлам.">
        <View className="self-stretch pt-2"><Primary title="Начать осмотр" icon="camera" onPress={() => { setTab('inspect'); setCamMode('photo'); }} /></View>
      </Empty>
    </View>
  );

  /* ----- нижняя панель с главным действием ----- */
  let action = null;
  if (tab === 'inspect' && !photo) {
    action = (
      <>
        <Primary title="Сфотографировать узел" icon="camera" onPress={() => setCamMode('photo')} />
        <View className="flex-row justify-center gap-8">
          <Link title="Из галереи" icon="images-outline" onPress={pickFromGallery} />
          <Link title="QR-код" icon="qr-code-outline" onPress={() => setCamMode('qr')} />
        </View>
      </>
    );
  } else if (tab === 'inspect' && photo) {
    action = (
      <>
        <Primary title="Сохранить в журнал" icon="checkmark" onPress={saveInspection} disabled={busy || !!ai} />
        <View className="flex-row justify-center gap-8">
          <Link title="Новое фото" icon="camera-outline" onPress={() => setCamMode('photo')} />
          <Link title="Отмена" icon="close" onPress={resetPhoto} />
        </View>
      </>
    );
  }

  const sb = sheet ? model.byComp[sheet] : null;
  const sbFind = sb ? sortFindings(sb.findings) : [];
  const sbSteps = uniq(sbFind.map((f) => f.action)).map((text) => ({ text }));

  return (
    <View className="flex-1 bg-bg">
      <StatusBar barStyle="light-content" backgroundColor={C.primary} />
      <View className="bg-primary px-4 flex-row items-center justify-between" style={{ paddingTop: TOP + 8, paddingBottom: 8 }}>
        <Text className="text-white text-[24px] font-semibold">MaintAR</Text>
        <Pressable onPress={() => setShowProfile(true)} hitSlop={4} accessibilityLabel="Профиль"
          className="w-12 h-12 rounded-full bg-white/15 items-center justify-center active:opacity-75">
          <Ionicons name="person" size={24} color="#fff" />
        </Pressable>
      </View>

      <ScrollView ref={scroll} contentContainerClassName="p-4 pb-8 gap-6" keyboardShouldPersistTaps="handled">
        {tab === 'inspect' ? (photo ? inspectResult : inspectStart) : tab === 'unit' ? unitTab : historyTab}
      </ScrollView>

      {!!toast && (
        <View className="absolute left-4 right-4 items-center" style={{ bottom: (action ? 160 : 96) + BOTTOM }} pointerEvents="none">
          <View className="bg-fg rounded-xl px-4 py-3 flex-row items-center gap-2">
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text className="text-white text-[17px]">{toast}</Text>
          </View>
        </View>
      )}

      {action && <View className="px-4 pt-4 gap-1 bg-surface border-t border-divider">{action}</View>}

      <View className="flex-row bg-surface border-t border-divider" style={{ paddingBottom: BOTTOM }}>
        {TABS.map(([id, title, icon]) => {
          const on = tab === id;
          return (
            <Pressable key={id} onPress={() => switchTab(id)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              className="flex-1 items-center justify-center min-h-[64px] pt-2">
              <View className={`absolute top-0 h-[3px] w-12 rounded-b-full ${on ? 'bg-primary' : ''}`} />
              <View className={`w-16 h-8 rounded-full items-center justify-center ${on ? 'bg-primary-soft' : ''}`}>
                <Ionicons name={on ? icon.replace('-outline', '') : icon} size={24} color={on ? C.primary : C.muted} />
              </View>
              <Text className={`text-[14px] mt-0.5 ${on ? 'text-primary font-semibold' : 'text-muted'}`}>{title}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* окно узла */}
      <Sheet visible={!!sb} onClose={closeSheet}
        head={sb && (
          <View className="flex-1 gap-2">
            <Text className={T.title}>{sb.c.name}</Text>
            <Status status={sb.status} big />
          </View>
        )}
        footer={sb && (
          <View className="gap-3">
            <Primary title="Проверено" icon="checkmark" onPress={() => record('checked')} />
            <View className="flex-row gap-3">
              <Secondary title="Заменено" icon="refresh" onPress={() => record('replaced')} className="flex-1" />
              <Secondary title="Есть дефект" icon="warning-outline" danger onPress={() => record('defect')} className="flex-1" />
            </View>
          </View>
        )}>
        {sb && (
          <>
            <View className={CARD}>
              <View className="gap-1">
                <Text className={T.cap}>Что не так</Text>
                <Text className={T.body}>{sbFind.length ? sbFind.map((f) => f.label).join('; ') : 'Замечаний по фото и датчикам нет.'}</Text>
              </View>
              {sbSteps.length > 0 && (
                <View className="gap-2">
                  <Text className={T.cap}>Что сделать</Text>
                  <Steps items={sbSteps} />
                </View>
              )}
            </View>
            <View className={CARD}>
              <Text className={T.cap}>Ресурс</Text>
              <ResBar res={sb.res} />
            </View>
            {showNote ? (
              <TextInput className="border border-line rounded-xl p-4 text-[17px] text-fg bg-surface min-h-[96px]" style={{ textAlignVertical: 'top' }}
                multiline value={note} onChangeText={setNote} autoFocus placeholder="Что увидели и что сделали" placeholderTextColor={C.muted} />
            ) : <Link title="Добавить заметку" icon="create-outline" onPress={() => setShowNote(true)} />}
            <View className="bg-surface rounded-xl border border-divider px-4">
              <Expand title="Подробнее">
                {sbFind.map((f) => (
                  <View key={f.id} className="gap-1">
                    <Text className={T.bodyB}>{f.label}</Text>
                    <Text className={T.body}>{f.detail}</Text>
                    <Text className={T.cap}>
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
                <Text className={T.cap}>{sb.c.desc}</Text>
              </Expand>
            </View>
          </>
        )}
      </Sheet>

      {/* выбор агрегата */}
      <Sheet visible={showUnits} onClose={() => setShowUnits(false)} title="Выберите агрегат"
        footer={<Secondary title="Сканировать QR-код" icon="qr-code-outline" onPress={() => { setShowUnits(false); setCamMode('qr'); }} />}>
        <View className="bg-surface rounded-xl border border-divider px-4">
          {UNITS.map((u, i) => {
            const on = u.id === unitId;
            return (
              <Row key={u.id} icon="construct-outline" title={u.name} sub={on ? 'Выбран сейчас' : SHORT[u.id]}
                right={on ? <Ionicons name="checkmark-circle" size={26} color={C.primary} /> : null}
                onPress={() => chooseUnit(u.id, '')} last={i === UNITS.length - 1} />
            );
          })}
        </View>
      </Sheet>

      {/* профиль и настройки */}
      <Sheet visible={showProfile} onClose={closeProfile} title="Профиль">
        <View className={CARD}>
          <View className="flex-row items-center gap-3">
            <Ionicons name="person-circle" size={56} color={C.primary} />
            <View className="flex-1">
              <Text className={T.bodyB}>{user.name}</Text>
              <Text className={T.cap}>{user.role}</Text>
            </View>
          </View>
          {confirmLogout ? (
            <View className="gap-3">
              <Text className={T.body}>Выйти? Журнал останется на телефоне.</Text>
              <View className="flex-row gap-3">
                <Secondary title="Выйти" danger onPress={doLogout} className="flex-1" />
                <Secondary title="Отмена" onPress={() => setConfirmLogout(false)} className="flex-1" />
              </View>
            </View>
          ) : <Secondary title="Выйти" icon="log-out-outline" onPress={() => setConfirmLogout(true)} />}
        </View>

        <View className={CARD}>
          <View className="flex-row items-center gap-3 min-h-[48px]">
            <View className="flex-1 gap-0.5">
              <Text className={T.bodyB}>Режим демонстрации</Text>
              <Text className={T.cap}>Примеры фото из кейса и выбор ситуации на датчиках</Text>
            </View>
            <Switch value={demo} onValueChange={setDemo} trackColor={{ true: C.primary, false: C.line }} thumbColor="#fff" activeThumbColor="#fff" />
          </View>
          <View className="flex-row items-center gap-3 min-h-[48px] border-t border-divider pt-4">
            <View className="flex-1 gap-0.5">
              <Text className={T.bodyB}>Подсказка для новичка</Text>
              <Text className={T.cap}>Шаги осмотра на главном экране</Text>
            </View>
            <Switch value={tips} onValueChange={setTips} trackColor={{ true: C.primary, false: C.line }} thumbColor="#fff" activeThumbColor="#fff" />
          </View>
        </View>

        <View className={CARD}>
          <Text className={T.bodyB}>Сервис анализа фото</Text>
          <TextInput className="border border-line rounded-xl px-4 h-12 text-[17px] text-fg bg-surface" value={apiUrl} onChangeText={setApiUrl}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://адрес-сервера:8000" placeholderTextColor={C.muted} />
          <Text className={T.cap}>{apiUrl.trim() ? 'Адрес задан. Новые фото уходят на проверку ИИ.' : 'Без адреса ИИ не проверит ваши фото.'}</Text>
        </View>
      </Sheet>
    </View>
  );
}
