// MaintAR: AR-помощник инженера для диагностики промышленного оборудования.
// Всё работает на телефоне без сервера: правила, датчики из базы кейса, карточки, ресурс, история.
// Снимок автоматически проверяет сервис анализа команды.
// Стили: Tailwind через NativeWind (className). Палитра в src/theme.js, inline style только для значений, вычисляемых на лету.
//
// Дизайн-система:
//  - сетка 8: отступ экрана 16, между блоками 24, внутри карточек 16; радиус 12 у карточек и кнопок; одна граница на всё;
//  - три размера текста: заголовок 24, основной 17, подписи 14;
//  - основное действие высотой не менее 56, второстепенные действия не менее 48;
//  - статус всегда показан иконкой, словом и цветом.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, FlatList, Image, Linking, Modal, Platform, Pressable, ScrollView, StatusBar, Switch, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import AuthScreen, { Splash } from './src/AuthScreen';
import { currentUser, logout } from './src/auth';
import { colors as C } from './src/theme';
import { UNITS, SCENARIOS, SAMPLES } from './src/data/units';
import {
  RULES, SENS, SERIES, RULE_COMP, STATUS_TEXT, buildModel, cleanVision, fmtDate, fmtTs, num, sensorTime, sensorsAt,
} from './src/engine';

const TABS = [['inspect', 'Осмотр', 'scan-outline'], ['unit', 'Карточка', 'document-text-outline'], ['sensors', 'Датчики', 'pulse-outline'], ['history', 'Журнал', 'time-outline']];
const UNIT_SECTIONS = [['nodes', 'Узлы'], ['passport', 'Паспорт']];
const INSPECTION_SOURCE = { manual: 'Ручной осмотр', auto: 'Анализ фото', combined: 'Анализ и ручные отметки', demo: 'Демо-снимок' };
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_ANALYSIS_URL || '';
const EMPTY_FINDINGS = [];
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
const CONTENT = 'self-center w-full max-w-[720px]';

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

function analysisAddress(value) {
  try {
    const url = new URL(value.trim());
    if (['http:', 'https:'].includes(url.protocol) && !url.search && !url.hash && !url.username && !url.password) {
      return url.href.replace(/\/+$/, '').replace(/\/analyze$/, '');
    }
  } catch {}
  return '';
}

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
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled }}
      className={`min-h-14 px-3 py-2 rounded-xl bg-primary flex-row items-center justify-center gap-2 active:opacity-85 ${disabled ? 'opacity-50' : ''}`}>
      {!!icon && <Ionicons name={icon} size={24} color="#fff" />}
      <Text className="shrink text-center text-[17px] font-semibold text-white">{title}</Text>
    </Pressable>
  );
}
function Secondary({ title, icon, onPress, danger, disabled, className = '' }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled }}
      className={`min-h-12 px-3 py-2 rounded-xl border bg-surface flex-row items-center justify-center gap-2 active:opacity-70 ${danger ? 'border-defect' : 'border-line'} ${disabled ? 'opacity-50' : ''} ${className}`}>
      {!!icon && <Ionicons name={icon} size={20} color={danger ? C.defect : C.primary} />}
      <Text className={`shrink text-center text-[16px] font-semibold ${danger ? 'text-defect' : 'text-primary'}`}>{title}</Text>
    </Pressable>
  );
}
function Link({ title, icon, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      className="min-h-[48px] self-start flex-row items-center gap-1.5 active:opacity-60">
      {!!icon && <Ionicons name={icon} size={20} color={C.primary} />}
      <Text className="shrink text-[16px] text-primary font-medium">{title}</Text>
    </Pressable>
  );
}
function Chip({ title, active, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={active === undefined ? undefined : { selected: active }}
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
      accessibilityLabel={[title, sub].filter(Boolean).join('. ')}
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
const Section = ({ title, children }) => (
  <View className="gap-2">
    <Text className="px-1 text-[14px] leading-[20px] font-semibold text-muted uppercase tracking-[0.5px]">{title}</Text>
    <View className="bg-surface rounded-xl border border-divider px-4">{children}</View>
  </View>
);
function InspectionStep({ number, title, hint, children, right }) {
  return (
    <View className={`${CARD} gap-3`}>
      <View className="flex-row items-start gap-3">
        <View className="h-8 w-8 rounded-full bg-primary-soft items-center justify-center">
          <Text className="text-[15px] font-bold text-primary">{number}</Text>
        </View>
        <View className="flex-1">
          <Text accessibilityRole="header" className={T.bodyB}>{title}</Text>
          {!!hint && <Text className={T.cap}>{hint}</Text>}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}
function UnitPicker({ unit, status, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Выбранный агрегат: ${unit.name}. ${st(status).word}`}
      accessibilityHint="Открывает список агрегатов"
      className="flex-row items-center gap-3 active:opacity-70">
      <View className="h-11 w-11 rounded-xl bg-primary-soft items-center justify-center">
        <Ionicons name="construct-outline" size={22} color={C.primary} />
      </View>
      <View className="flex-1 gap-1">
        <Text className={T.cap}>Выбранный агрегат</Text>
        <Text className={T.bodyB}>{unit.name}</Text>
        <Status status={status} />
      </View>
      <Ionicons name="chevron-down" size={22} color={C.primary} />
    </Pressable>
  );
}
function UnitSections({ section, onChange }) {
  return (
    <View className="flex-row gap-1 bg-sunken rounded-xl p-1">
      {UNIT_SECTIONS.map(([id, title]) => (
        <Pressable key={id} onPress={() => onChange(id)} accessibilityRole="tab" accessibilityState={{ selected: id === section }}
          className={`flex-1 min-h-11 items-center justify-center rounded-lg px-1 py-2 ${id === section ? 'bg-surface' : 'active:opacity-70'}`}>
          <Text className={`text-center text-[15px] font-semibold ${id === section ? 'text-primary' : 'text-muted'}`}>{title}</Text>
        </Pressable>
      ))}
    </View>
  );
}
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
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }}
        className="min-h-[48px] flex-row items-center gap-2 active:opacity-60">
        <Text className="text-[17px] text-primary font-semibold flex-1">{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={C.primary} />
      </Pressable>
      {open && <View className="gap-3 pt-1 pb-2">{children}</View>}
    </View>
  );
}
// Нумерованные шаги «что сделать».
function Steps({ items }) {
  return (
    <View className="gap-3">
      {items.map((s, i) => (
        <View key={s.text} className="flex-row gap-3">
          <View className="w-7 h-7 rounded-full bg-primary items-center justify-center mt-0.5">
            <Text className="text-[14px] font-semibold text-white">{i + 1}</Text>
          </View>
          <Text className={`${T.body} flex-1`}>{s.text}</Text>
        </View>
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
  const { height } = useWindowDimensions();
  const [lw, setW] = useState(0);
  const ratio = (photo.width || 4) / (photo.height || 3);
  const W = lw || 340; // ширина до первого замера: подписи всё равно разместятся разумно
  const H = W / ratio;
  const boxes = [];
  const used = new Set();
  const add = (box, status, label, comp, key, ruleId) => {
    const [left, top, width, height] = box;
    const x = Math.max(0, left);
    const y = Math.max(0, top);
    const w = Math.min(1, left + width) - x;
    const h = Math.min(1, top + height) - y;
    if (w < 0.02 || h < 0.02) return;
    boxes.push({ key, comp, status, label, x, y, w, h, ruleId });
  };
  if (vis) {
    vis.findings.forEach((f, i) => {
      const r = RULES.visual_rules.find((x) => x.class === f.cls);
      if (!r || !f.box) return;
      used.add(RULE_COMP[r.id]);
      add(f.box, r.status, r.name, RULE_COMP[r.id], 'f' + i, r.id);
    });
    (vis.nodes || []).forEach((n, i) => {
      const b = model.byComp[n.comp];
      if (!b || used.has(n.comp)) return;
      add(n.box, b.status, b.c.name, n.comp, 'n' + i);
    });
  }
  const LABEL_H = 24;
  return (
    <View className="w-full self-center bg-sunken rounded-xl overflow-hidden" style={{ aspectRatio: ratio, maxWidth: Math.max(192, height * 0.65) * ratio }}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {/* Размеры картинки задаём через style: на вебе className проигрывает встроенным размерам изображения. */}
      <Image source={photo.source || { uri: photo.uri }} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} resizeMode="contain" />
      {boxes.map((b) => {
        const inside = b.y * H < LABEL_H + 2; // рамка у верхнего края: подпись внутрь
        const rightSide = b.x > 0.5;          // рамка справа: подпись прижимаем к правому краю рамки
        const maxW = rightSide ? (b.x + b.w) * W - 4 : (1 - b.x) * W - 4;
        const c = st(b.status);
        return (
          <Pressable key={b.key} onPress={() => onPick(b.comp, b.ruleId)} hitSlop={6} accessibilityRole="button" accessibilityLabel={b.label}
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
  const { top, bottom } = useSafeAreaInsets();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scanned = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  const wrap = 'flex-1 bg-black justify-center items-center';
  if (!perm) return <View className={wrap}><ActivityIndicator color="#fff" /></View>;
  if (!perm.granted) {
    return (
      <View className={`${wrap} p-6 gap-4`}>
        <Text className="text-white text-[17px] text-center">Нет доступа к камере. Разрешите его, чтобы снимать узлы и сканировать QR-коды.</Text>
        <View className="self-stretch gap-3">
          {(perm.canAskAgain || Platform.OS !== 'web') && (
            <Primary title={perm.canAskAgain ? 'Разрешить камеру' : 'Открыть настройки'}
              onPress={() => (perm.canAskAgain ? requestPerm() : Linking.openSettings()).catch(() => setError('Откройте настройки камеры вручную.'))} />
          )}
          {!!error && <Text className="text-white text-center">{error}</Text>}
          <Secondary title="Назад" onPress={onClose} />
        </View>
      </View>
    );
  }
  const shoot = async () => {
    if (!cam.current || busy || !ready) return;
    setBusy(true);
    setError('');
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.6 });
      if (active.current) onPhoto({ uri: pic.uri, width: pic.width, height: pic.height });
    } catch {
      if (active.current) { setBusy(false); setError('Снимок не получился. Попробуйте ещё раз.'); }
    }
  };
  return (
    <View className={wrap}>
      <StatusBar barStyle="light-content" />
      <CameraView ref={cam} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} facing="back"
        onCameraReady={() => { setReady(true); setError(''); }}
        onMountError={() => { setReady(false); setError('Камера недоступна. Вернитесь назад и выберите фото из галереи.'); }}
        barcodeScannerSettings={mode === 'qr' ? { barcodeTypes: ['qr'] } : undefined}
        onBarcodeScanned={mode === 'qr' ? (e) => { if (!scanned.current) { scanned.current = true; onQr(String(e.data || '')); } } : undefined} />
      {mode === 'qr' && <View className="w-60 h-60 border-[3px] border-white rounded-xl" pointerEvents="none" />}
      <View className="absolute top-0 left-0 right-0 px-4 pb-4 gap-2 bg-black/60" style={{ paddingTop: top + 16 }}>
        <Text className="text-white text-[24px] font-semibold">{mode === 'qr' ? 'Наведите на QR-код' : 'Наведите на узел'}</Text>
        {mode !== 'qr' && hints.length > 0 && <Text className="text-white text-[17px]">Сначала: {hints.join(', ')}</Text>}
        {!!error && <Text accessibilityLiveRegion="polite" className="text-white text-[16px]">{error}</Text>}
      </View>
      <View className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-6 pt-6 bg-black/60"
        style={{ paddingBottom: bottom + 16 }}>
        <Pressable onPress={onClose} accessibilityRole="button" className="w-20 h-12 items-center justify-center rounded-xl border border-white/50 active:opacity-70">
          <Text className="text-white text-[17px] font-semibold">Назад</Text>
        </Pressable>
        {mode !== 'qr' ? (
          <Pressable onPress={shoot} disabled={!ready || busy} accessibilityRole="button" accessibilityLabel="Сделать снимок"
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
  const { top, bottom } = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View className="flex-1 bg-[#050c12]/50" style={{ paddingTop: top }}>
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Закрыть окно" />
        {visible && (
          <View accessibilityViewIsModal className={`${CONTENT} bg-bg rounded-t-2xl px-4 pt-2 gap-4 max-h-[92%]`} style={{ paddingBottom: bottom + 8 }}>
            <View className="self-center w-10 h-1 rounded-full bg-line" />
            <View className="flex-row items-start gap-3">
              {head || <Text className={`${T.title} flex-1`}>{title}</Text>}
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть"
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
  const { top, bottom } = useSafeAreaInsets();
  const [tab, setTab] = useState('inspect');
  const [unitSection, setUnitSection] = useState('nodes');
  const [unitId, setUnitId] = useState('CN-1');
  const [idx, setIdx] = useState(410);
  const [photo, setPhoto] = useState(null);
  const [vis, setVis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState(null);
  const [toast, setToast] = useState('');
  const [history, setHistory] = useState([]);
  const [compState, setCompState] = useState({});
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [analysisSettings, setAnalysisSettings] = useState(null);
  const [addressError, setAddressError] = useState('');
  const [demo, setDemo] = useState(false); // режим демонстрации: примеры фото, сценарии датчиков
  const [camMode, setCamMode] = useState(null); // null | 'photo' | 'qr'
  const [cameraNode, setCameraNode] = useState(null);
  const [sheet, setSheet] = useState(null); // id узла
  const [unlinkedFinding, setUnlinkedFinding] = useState(null);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [inspectionNote, setInspectionNote] = useState(null);
  const [openSensor, setOpenSensor] = useState(null);
  const [openHist, setOpenHist] = useState(null);
  const [onlyCurrentUnit, setOnlyCurrentUnit] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showUnits, setShowUnits] = useState(false);
  const [pendingUnit, setPendingUnit] = useState(null);
  const [recordsReady, setRecordsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState(null); // вошедший сотрудник {name, role, login}
  const [authReady, setAuthReady] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const run = useRef(0);
  const request = useRef(null);
  const savingRef = useRef(false);
  const scroll = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    currentUser().then((r) => { if (r.ok) setUser(r.user); }).catch(() => {}).finally(() => setAuthReady(true));
  }, []);
  useEffect(() => {
    (async () => {
      const [records, oldHistory, oldComponents, ui] = await Promise.all([
        load('obh.records', null), load('obh.history', []), load('obh.comp', {}), load('obh.ui', {}),
      ]);
      setHistory(records?.history ?? oldHistory);
      setCompState(records?.components ?? oldComponents);
      if (ui.unitId && UNITS.some((u) => u.id === ui.unitId)) setUnitId(ui.unitId);
      if (Number.isInteger(ui.idx)) setIdx(Math.max(0, Math.min(499, ui.idx)));
      if (typeof ui.apiUrl === 'string' && ui.apiUrl.trim()) setApiUrl(ui.apiUrl);
      if (typeof ui.demo === 'boolean') setDemo(ui.demo);
      setRecordsReady(true);
    })();
    return () => {
      request.current?.abort();
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (recordsReady) save('obh.ui', { unitId, idx, apiUrl, demo });
  }, [recordsReady, unitId, idx, apiUrl, demo]);

  const unit = UNITS.find((u) => u.id === unitId);
  const classes = vis?.findings ?? EMPTY_FINDINGS;
  const model = useMemo(() => buildModel(unit, idx, classes, compState), [unit, idx, classes, compState]);
  const components = useMemo(() => Object.values(model.byComp).sort((a, b) => RANK[b.status] - RANK[a.status]), [model]);
  const attention = components.filter((b) => b.status !== 'ok');
  const findings = useMemo(() => sortFindings(model.findings), [model]);
  // Для результата осмотра берём только то, что видно на фото (в том числе подтверждённое датчиками).
  const photoFindings = findings.filter((f) => f.src.includes('камера'));

  const flash = (text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2800);
  };
  const resetPhoto = () => {
    run.current++;
    request.current?.abort();
    request.current = null;
    setPhoto(null); setVis(null); setAi(null); setBusy(false);
    setInspectionNote(null);
  };
  const chooseUnit = (id, msg) => {
    setShowUnits(false);
    setPendingUnit(null);
    if (id !== unitId) {
      resetPhoto();
      setUnitId(id);
      setUnitSection('nodes');
      setOpenSensor(null);
      setShowAllAttention(false);
    }
    if (msg) flash(msg);
  };
  const selectUnit = (id, msg) => {
    if (savingRef.current) return;
    if (id !== unitId && photo) { setPendingUnit({ id, msg }); setShowUnits(true); }
    else chooseUnit(id, msg);
  };
  const toTop = () => scroll.current?.scrollTo({ y: 0, animated: false });

  // Анализ фото через сервис команды. Если сервиса нет, понятно сообщаем об этом.
  const analyze = async (p, retry = false, address = apiUrl) => {
    if (retry) {
      request.current?.abort();
      setAi(null);
    } else resetPhoto();
    const my = ++run.current;
    setPhoto(p); setTab('inspect'); toTop();
    const url = analysisAddress(address);
    if (!url) { setBusy(false); setAi('setup'); return; }
    setBusy(true);
    const ctl = new AbortController();
    request.current = ctl;
    const timer = setTimeout(() => ctl.abort(), 60000);
    try {
      const form = new FormData();
      if (Platform.OS === 'web') {
        const file = p.file ?? await (await fetch(p.uri, { signal: ctl.signal })).blob();
        form.append('photo', file, p.fileName || (file.type === 'image/png' ? 'photo.png' : 'photo.jpg'));
      } else {
        form.append('photo', { uri: p.uri, name: p.fileName || 'photo.jpg', type: p.mimeType || 'image/jpeg' });
      }
      form.append('unit_id', unit.id);
      const res = await fetch(url + '/analyze', { method: 'POST', body: form, signal: ctl.signal });
      if (!res.ok) throw new Error('http ' + res.status);
      const result = await res.json();
      if (!Array.isArray(result?.findings) || result.findings.some((f) => !RULES.visual_rules.some((rule) => rule.class === f?.cls))) {
        if (my === run.current) setAi('response');
        return;
      }
      const v = cleanVision(result, unit);
      if (my !== run.current) return;
      setVis(v);
    } catch (e) {
      if (my !== run.current) return;
      setAi(ctl.signal.aborted ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
      if (my === run.current) { request.current = null; setBusy(false); }
    }
  };
  const openAnalysisSettings = () => {
    setAddressError('');
    setAnalysisSettings(apiUrl);
  };
  const saveAnalysisSettings = () => {
    const url = analysisAddress(analysisSettings);
    if (!url) { setAddressError('Укажите адрес сервиса, начиная с http:// или https://.'); return; }
    setApiUrl(url);
    setAnalysisSettings(null);
    if (photo && !vis && !busy) analyze(photo, true, url);
  };
  const pickFromGallery = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (r.canceled || !r.assets || !r.assets[0]) return;
      const a = r.assets[0];
      analyze({ uri: a.uri, width: a.width, height: a.height, file: a.file, fileName: a.fileName, mimeType: a.mimeType });
    } catch (e) { flash('Не удалось открыть галерею'); }
  };
  const pickSample = (smp) => {
    // Пример из кейса: готовая разметка, сервис не вызывается.
    resetPhoto();
    setPhoto({ source: smp.source, width: smp.width, height: smp.height, demo: true });
    setVis(smp.preset); setTab('inspect'); toTop();
  };
  const closeCamera = () => { setCamMode(null); setCameraNode(null); };
  const onQr = (data) => {
    closeCamera();
    const u = UNITS.find((x) => x.qr === data.trim());
    if (u) selectUnit(u.id, `Агрегат: ${SHORT[u.id] || u.id}`);
    else { setShowUnits(true); setPendingUnit(null); flash('Такого QR-кода нет в базе'); }
  };
  const who = () => (user ? { name: user.name, role: user.role, login: user.login } : null);
  const writeRecord = async (entry, componentsAfter = compState) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    const next = [entry, ...history].slice(0, 300);
    try {
      await AsyncStorage.setItem('obh.records', JSON.stringify({ history: next, components: componentsAfter }));
      setHistory(next);
      setCompState(componentsAfter);
      return true;
    } catch {
      flash('Не удалось сохранить запись. Попробуйте ещё раз.');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  // Отметка по узлу: проверено, дефект или замена.
  const record = async (action) => {
    const b = model.byComp[sheet];
    if (!b) return;
    const now = Date.now();
    const entry = {
      unit: unit.id, comp: b.c.id, compName: b.c.name, action, note: note.trim().slice(0, 500), status: b.status,
      user: who(), findings: b.findings.map((f) => f.label).join('; '), ts: now,
    };
    const key = `${unit.id}__${b.c.id}`;
    const cs = { ...(compState[key] || {}), lastCheck: now };
    if (action === 'replaced') {
      cs.at = unit.hours;
      const date = new Date(now);
      cs.date = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
    }
    const c = { ...compState, [key]: cs };
    if (!await writeRecord(entry, c)) return;
    closeSheet();
    flash(`${b.c.name}: ${ACTIONS[action].toLowerCase()}`);
  };
  // Итог осмотра по фото в журнал.
  const saveInspection = async () => {
    if (busy || !photo || !vis) return;
    const source = photo.demo ? 'demo' : 'auto';
    if (!await writeRecord({
      unit: unit.id, comp: null, compName: 'Осмотр по фото', action: 'inspection',
      source, note: (inspectionNote || '').trim(), status: worst(photoFindings),
      user: who(), findings: photoFindings.map((f) => f.label).join('; '), ts: Date.now(),
    })) return;
    resetPhoto();
    toTop();
    flash('Сохранено в журнал');
  };
  const closeSheet = () => { setSheet(null); setNote(''); setShowNote(false); setConfirmReplacement(false); };
  const switchTab = (id) => { setTab(id); toTop(); };
  const closeProfile = () => { setShowProfile(false); setConfirmLogout(false); };
  const doLogout = async () => {
    if (savingRef.current) return;
    await logout();
    closeProfile(); closeSheet(); setShowUnits(false); setPendingUnit(null); resetPhoto(); setUser(null);
  };

  if (!authReady || !recordsReady) return <Splash />;
  if (!user) return <AuthScreen onAuth={(u) => { setUser(u); setTab('inspect'); }} />;

  if (camMode) {
    return (
      <CameraScreen mode={camMode} onClose={closeCamera} onQr={onQr}
        hints={cameraNode ? [cameraNode] : attention.slice(0, 2).map((b) => b.c.name)}
        onPhoto={(p) => { closeCamera(); analyze(p); }} />
    );
  }

  const inspectStart = (
    <>
      <View className={`${CARD} flex-row items-center gap-2`}>
        <View className="flex-1">
          <UnitPicker unit={unit} status={model.overall} onPress={() => setShowUnits(true)} />
        </View>
        <Pressable onPress={() => setCamMode('qr')} accessibilityRole="button" accessibilityLabel="Сканировать QR-код"
          className="w-12 h-12 rounded-xl border border-line items-center justify-center active:opacity-70">
          <Ionicons name="qr-code-outline" size={22} color={C.primary} />
          <Text className="text-[12px] font-medium text-primary">QR</Text>
        </Pressable>
      </View>
      <InspectionStep number="1" title="Что проверить" hint="По датчикам и ресурсу узлов"
        right={attention.length > 1 && <Link title={showAllAttention ? 'Свернуть' : `Все (${attention.length})`}
          onPress={() => setShowAllAttention(!showAllAttention)} />}>
        {attention.length ? (
          <View>
            {(showAllAttention ? attention : attention.slice(0, 1)).map((b, i, list) => (
              <Row key={b.c.id} icon={COMP_ICON[b.c.id]} status={b.status} title={b.c.name}
                sub={`${st(b.status).word} · ${reasonOf(b)}`} onPress={() => setSheet(b.c.id)}
                last={i === list.length - 1} />
            ))}
          </View>
        ) : <Text className={T.body}>По доступным данным отклонений нет. Сделайте обзорное фото агрегата.</Text>}
      </InspectionStep>
      <InspectionStep number="2" title="Снимите узел" hint="ИИ автоматически определит признаки на фото">
        <Primary title="Сделать фото" icon="camera" onPress={() => setCamMode('photo')} />
        <Secondary title="Из галереи" icon="images-outline" onPress={pickFromGallery} />
        {!analysisAddress(apiUrl) && (
          <View className="border-t border-divider pt-2">
            <Link title="Подключить сервис ИИ" icon="settings-outline" onPress={openAnalysisSettings} />
          </View>
        )}
      </InspectionStep>
      {demo && (
        <Section title="Демо-примеры">
          {SAMPLES.map((x, i) => (
            <Row key={x.key} icon="images-outline" title={x.label} sub="Готовая разметка из кейса" onPress={() => pickSample(x)} last={i === SAMPLES.length - 1} />
          ))}
        </Section>
      )}
    </>
  );

  const vStatus = worst(photoFindings);
  const vc = st(vStatus);
  const priority = photoFindings[0];
  const analysisError = {
    setup: 'Укажите адрес сервиса ИИ. Текущий снимок отправится после сохранения настроек.',
    network: 'Сервис анализа недоступен. Проверьте подключение или адрес сервиса.',
    timeout: 'Сервис не успел обработать снимок. Попробуйте ещё раз.',
    response: 'Сервис вернул результат в неподдерживаемом формате.',
  }[ai];
  const inspectResult = photo && (
    <>
      {vis && (
        <View className={`rounded-xl px-4 py-3 gap-1 ${vc.soft}`}>
          <Text className={`${T.bodyB} ${vc.text}`}>{STATUS_TEXT[vStatus]}</Text>
          {priority
            ? <Text className={T.body}><Text className="font-semibold">Что сделать. </Text>{priority.action}</Text>
            : <Text className={T.cap}>Вывод относится к видимым признакам на этом снимке.</Text>}
        </View>
      )}
      <InspectionStep number="2" title="Снимок узла" hint={`${unit.name}${photo.demo ? ' · Демо-снимок' : ''}`}>
        <PhotoStage photo={photo} vis={vis} model={model} busy={busy} onPick={(comp, ruleId) => {
          if (model.byComp[comp]) setSheet(comp);
          else setUnlinkedFinding(photoFindings.find((f) => f.id === ruleId) ?? null);
        }} />
        {!!vis && (vis.nodes.length > 0 || vis.findings.some((f) => f.box)) && (
          <Text className={T.cap}>Нажмите на метку, чтобы открыть сведения об узле или признаке.</Text>
        )}
      </InspectionStep>

      {!busy && (
        <InspectionStep number="3" title={photo.demo ? 'Результат примера' : 'Результат ИИ'}
          hint={vis?.equipment || undefined}>
          {!vis && (
            <View className="rounded-xl bg-check-bg p-3 gap-1">
              <Text className="text-[17px] font-semibold text-check">Анализ не завершён</Text>
              <Text className={T.body}>{analysisError}</Text>
              {ai !== 'setup' && (
                <Link title="Повторить анализ" icon="refresh-outline" onPress={() => analyze(photo, true)} />
              )}
              <Link title={ai === 'setup' ? 'Подключить сервис ИИ' : 'Настройки сервиса ИИ'}
                icon="settings-outline" onPress={openAnalysisSettings} />
            </View>
          )}
          {photoFindings.length > 0 && (
            <View>
              <Text className={T.cap}>Найденные признаки</Text>
              {photoFindings.map((f, i) => (
                <Row key={f.id} icon={COMP_ICON[f.comp] || 'scan-outline'} status={f.status} title={f.label}
                  sub={f.confidence != null ? `Уверенность ИИ: ${Math.round(f.confidence * 100)} %` : SRC_TEXT[f.src]}
                  onPress={() => model.byComp[f.comp] ? setSheet(f.comp) : setUnlinkedFinding(f)}
                  last={i === photoFindings.length - 1} />
              ))}
            </View>
          )}
          {vis && inspectionNote !== null && (
            <TextInput value={inspectionNote} onChangeText={setInspectionNote} multiline maxLength={500}
              accessibilityLabel="Заметка к осмотру" placeholder="Заметка к осмотру" placeholderTextColor={C.muted}
              className="min-h-[88px] rounded-xl border border-line bg-surface p-3 text-[16px] text-fg" />
          )}
          {vis && inspectionNote === null && <Link title="Добавить заметку" icon="create-outline" onPress={() => setInspectionNote('')} />}
        </InspectionStep>
      )}
    </>
  );

  const reading = tab === 'sensors' && unit.sensors ? sensorsAt(idx) : null;
  const sensorRows = reading ? RULES.sensor_rules.map((r) => {
    const v = reading[r.param];
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
        <UnitPicker unit={unit} status={model.overall} onPress={() => setShowUnits(true)} />
        {tab === 'unit' && <UnitSections section={unitSection} onChange={setUnitSection} />}
      </View>

      {tab === 'unit' && unitSection === 'nodes' && <Section title="Узлы по приоритету">
        {components.map((b, i) => (
          <Row key={b.c.id} icon={COMP_ICON[b.c.id] || 'hardware-chip-outline'} status={b.status} title={b.c.name}
            sub={`${st(b.status).word} · ${resShort(b.res)}`} onPress={() => setSheet(b.c.id)} last={i === components.length - 1} />
        ))}
      </Section>}

      {tab === 'sensors' && <Section title="Датчики">
        {unit.sensors && <Text className={`${T.cap} border-b border-divider py-3`}>Из архива · {fmtTs(sensorTime(idx))}</Text>}
        {!unit.sensors && <Empty icon="pulse-outline" text="Датчики к этому агрегату не подключены." />}
        {sensorRows.map(({ r, v, lvl, unitTxt, name, icon }, i) => {
          const open = openSensor === r.id;
          const c = st(lvl);
          return (
            <View key={r.id} className={i === sensorRows.length - 1 ? '' : 'border-b border-divider'}>
              <Pressable onPress={() => setOpenSensor(open ? null : r.id)} accessibilityRole="button" accessibilityState={{ expanded: open }}
                className="flex-row items-center gap-2 min-h-[64px] py-3 active:opacity-60">
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
      </Section>}

      {tab === 'sensors' && demo && unit.sensors && (
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

      {tab === 'unit' && unitSection === 'passport' && (
        <Section title="Характеристики агрегата">
          <View>{specRows.map(([k, v], i) => <KV key={k} k={k} v={v} last={i === specRows.length - 1} />)}</View>
          <Text className={`${T.cap} py-3`}>{unit.note}</Text>
        </Section>
      )}
    </>
  );

  /* ----- Журнал ----- */
  const historyTab = (
    <FlatList key="history" className="flex-1" contentContainerClassName={`${CONTENT} px-4 pb-6`}
      data={onlyCurrentUnit ? history.filter((h) => h.unit === unit.id) : history} extraData={openHist} initialNumToRender={12}
      keyExtractor={(h, i) => `${h.ts}-${h.comp || 'inspection'}-${i}`}
      ListHeaderComponent={history.length > 0 ? (
        <View className="flex-row flex-wrap gap-2 py-3">
          <Chip title="Все агрегаты" active={!onlyCurrentUnit} onPress={() => { setOnlyCurrentUnit(false); setOpenHist(null); }} />
          <Chip title={SHORT[unit.id] || unit.id} active={onlyCurrentUnit} onPress={() => { setOnlyCurrentUnit(true); setOpenHist(null); }} />
        </View>
      ) : <View className="h-4" />}
      ListEmptyComponent={
        <View className="bg-surface rounded-xl border border-divider">
          <Empty icon="document-text-outline" text={onlyCurrentUnit ? 'Для выбранного агрегата записей пока нет.' : 'Здесь появятся осмотры и отметки по узлам.'}>
            <View className="self-stretch pt-2"><Primary title="Открыть осмотр" onPress={() => switchTab('inspect')} /></View>
          </Empty>
        </View>
      }
      renderItem={({ item: h, index }) => {
        const key = `${h.ts}-${index}`;
        const open = openHist === key;
        const inspection = h.action === 'inspection';
        const c = st(inspection ? h.status : ACTION_STATUS[h.action] || 'check');
        const label = inspection && h.status === 'ok' ? 'Без видимых дефектов' : inspection ? c.word : ACTIONS[h.action];
        return (
          <View className="border-b border-divider px-1">
            <Pressable onPress={() => setOpenHist(open ? null : key)} accessibilityRole="button" accessibilityState={{ expanded: open }}
              accessibilityLabel={`${h.compName}. ${label}. ${fmtTs(h.ts)}`}
              className="flex-row items-center gap-3 min-h-[64px] py-3 active:opacity-60">
              <View className={`w-10 h-10 rounded-full items-center justify-center ${c.soft}`}>
                <Ionicons name={ACTION_ICON[h.action] || 'document-text-outline'} size={22} color={c.color} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className={T.bodyB}>{h.compName}</Text>
                <Text className={T.cap}>{fmtTs(h.ts)} · {SHORT[h.unit] || h.unit}{h.source ? ` · ${INSPECTION_SOURCE[h.source]}` : ''}</Text>
                <Text className={`text-[14px] font-semibold ${c.text}`}>{label}</Text>
              </View>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={C.muted} />
            </Pressable>
            {open && (
              <View className="pb-4 gap-2">
                {!!h.findings && <Text className={T.body}>{h.findings}</Text>}
                {!!h.note && <Text className={T.body}>Заметка: {h.note}</Text>}
                {!!h.user?.name && <Text className={T.cap}>{h.user.name}{h.user.role ? `, ${h.user.role}` : ''}</Text>}
              </View>
            )}
          </View>
        );
      }}
    />
  );

  const action = tab === 'inspect' && photo && (
    <>
      {!!vis && <Primary title={saving ? 'Сохраняем…' : 'Сохранить в журнал'} icon="checkmark" onPress={saveInspection}
        disabled={saving || busy} />}
      {!saving && (
        <View className="flex-row flex-wrap justify-center gap-x-6">
          <Link title="Переснять" icon="camera-outline" onPress={() => setCamMode('photo')} />
          <Link title={busy ? 'Отменить анализ' : 'Убрать снимок'} icon="close" onPress={() => { resetPhoto(); toTop(); }} />
        </View>
      )}
    </>
  );

  const sb = sheet ? model.byComp[sheet] : null;
  const sbFind = sb ? sortFindings(sb.findings) : [];
  const sbSteps = uniq(sbFind.map((f) => f.action)).map((text) => ({ text }));

  return (
    <View className="flex-1 bg-bg">
      <StatusBar barStyle="light-content" backgroundColor={C.primary} />
      <View className="bg-primary px-4 pb-2" style={{ paddingTop: top + 8 }}>
        <View className={`${CONTENT} flex-row items-center justify-between gap-2`}>
          <Text className="shrink text-white text-[23px] font-semibold">{TABS.find(([id]) => id === tab)[1]}</Text>
          <Pressable onPress={() => setShowProfile(true)} accessibilityRole="button" accessibilityLabel="Настройки"
            className="w-11 h-11 rounded-full bg-white/15 items-center justify-center active:opacity-75">
            <Ionicons name="settings-outline" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>

      {tab === 'history' ? historyTab : (
        <ScrollView key={tab} ref={scroll} className="flex-1" contentContainerClassName={`${CONTENT} p-4 pb-6 gap-4`}
          keyboardShouldPersistTaps="handled">
          {tab === 'inspect' ? (photo ? inspectResult : inspectStart) : unitTab}
        </ScrollView>
      )}

      {!!toast && !sb && !showUnits && (
        <Text accessibilityLiveRegion="polite" className={`${CONTENT} bg-fg px-4 py-2 text-white text-center text-[15px]`}>{toast}</Text>
      )}

      {action && (
        <View className="px-4 pt-2 bg-surface border-t border-divider">
          <View className={`${CONTENT} gap-1`}>{action}</View>
        </View>
      )}

      <View className="bg-surface border-t border-divider" style={{ paddingBottom: bottom }}>
        <View className={`${CONTENT} flex-row`}>
        {TABS.map(([id, title, icon]) => {
          const on = tab === id;
          return (
            <Pressable key={id} onPress={() => switchTab(id)} accessibilityRole="tab" accessibilityLabel={title} accessibilityState={{ selected: on }}
              className="flex-1 items-center justify-center min-h-[60px] px-0.5 pt-1">
              <View className={`absolute top-0 h-[3px] w-12 rounded-b-full ${on ? 'bg-primary' : ''}`} />
              <View className={`w-16 h-8 rounded-full items-center justify-center ${on ? 'bg-primary-soft' : ''}`}>
                <Ionicons name={on ? icon.replace('-outline', '') : icon} size={24} color={on ? C.primary : C.muted} />
              </View>
              <Text className={`text-[13px] text-center mt-0.5 ${on ? 'text-primary font-semibold' : 'text-muted'}`}>{title}</Text>
            </Pressable>
          );
        })}
        </View>
      </View>

      {/* окно узла */}
      <Sheet visible={!!sb} onClose={() => { if (!savingRef.current) closeSheet(); }}
        head={sb && (
          <View className="flex-1 gap-2">
            <Text className={T.title}>{sb.c.name}</Text>
            <Status status={sb.status} big />
          </View>
        )}
        footer={sb && (
          <View className="gap-3">
            {!!toast && <Text accessibilityLiveRegion="polite" className={T.cap}>{toast}</Text>}
            {confirmReplacement ? (
              <>
                <Text className={T.cap}>Дата установки обновится. При известной наработке отсчёт ресурса начнётся заново.</Text>
                <Primary title={saving ? 'Сохраняем…' : 'Подтвердить замену'} disabled={saving} onPress={() => record('replaced')} />
                <Secondary title="Назад" disabled={saving} onPress={() => setConfirmReplacement(false)} />
              </>
            ) : (
              <>
                <Primary title={saving ? 'Сохраняем…' : 'Проверено'} disabled={saving} icon="checkmark" onPress={() => record('checked')} />
                <View className="flex-row gap-2">
                  <Secondary title="Есть дефект" danger disabled={saving} onPress={() => record('defect')} className="flex-1" />
                  <Secondary title="Заменено" disabled={saving} onPress={() => setConfirmReplacement(true)} className="flex-1" />
                </View>
              </>
            )}
          </View>
        )}>
        {sb && (
          <>
            {sbFind.length > 0 && <View className={CARD}>
              <View className="gap-1">
                <Text className={T.cap}>Состояние узла</Text>
                <Text className={T.body}>{sbFind.map((f) => f.label).join('; ')}</Text>
              </View>
              {sbSteps.length > 0 && (
                <View className="gap-2">
                  <Text className={T.cap}>Что сделать</Text>
                  <Steps items={sbSteps} />
                </View>
              )}
            </View>}
            <View className={CARD}>
              <Text className={T.cap}>Ресурс</Text>
              <ResBar res={sb.res} />
            </View>
            {!photo && <Link title="Снять этот узел" icon="camera-outline" onPress={() => {
              setCameraNode(sb.c.name);
              closeSheet();
              setCamMode('photo');
            }} />}
            {showNote ? (
              <TextInput className="border border-line rounded-xl p-4 text-[17px] text-fg bg-surface min-h-[96px]" style={{ textAlignVertical: 'top' }}
                multiline maxLength={500} value={note} onChangeText={setNote} accessibilityLabel="Заметка по узлу" autoFocus
                placeholder="Что увидели и что сделали" placeholderTextColor={C.muted} />
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
      <Sheet visible={showUnits} onClose={() => { setPendingUnit(null); setShowUnits(false); }}
        title={pendingUnit ? 'Сменить агрегат?' : 'Выберите агрегат'}
        footer={pendingUnit ? (
          <View className="gap-2">
            <Primary title="Сменить агрегат" onPress={() => chooseUnit(pendingUnit.id, pendingUnit.msg)} />
            <Secondary title="Продолжить осмотр" onPress={() => { setPendingUnit(null); setShowUnits(false); }} />
          </View>
        ) : <Secondary title="Сканировать QR-код" icon="qr-code-outline" onPress={() => { setShowUnits(false); setCamMode('qr'); }} />}>
        {pendingUnit ? <Text className={T.body}>Текущий снимок и отметки ещё не сохранены. При смене агрегата черновик будет удалён.</Text> : (
        <View className="bg-surface rounded-xl border border-divider px-4">
          {!!toast && <Text accessibilityLiveRegion="polite" className={`${T.cap} pt-3`}>{toast}</Text>}
          {UNITS.map((u, i) => {
            const on = u.id === unitId;
            return (
              <Row key={u.id} icon="construct-outline" title={u.name} sub={on ? 'Выбран сейчас' : SHORT[u.id]}
                right={on ? <Ionicons name="checkmark-circle" size={26} color={C.primary} /> : null}
                onPress={() => selectUnit(u.id, '')} last={i === UNITS.length - 1} />
            );
          })}
        </View>
        )}
      </Sheet>

      {/* профиль и настройки */}
      <Sheet visible={!!unlinkedFinding} onClose={() => setUnlinkedFinding(null)} title={unlinkedFinding?.label}>
        {unlinkedFinding && (
          <View className={CARD}>
            <Status status={unlinkedFinding.status} />
            <Text className={T.body}>{unlinkedFinding.detail}</Text>
            <Text className={T.body}>{unlinkedFinding.action}</Text>
            {unlinkedFinding.confidence != null && <Text className={T.cap}>Уверенность ИИ: {Math.round(unlinkedFinding.confidence * 100)} %</Text>}
          </View>
        )}
      </Sheet>

      <Sheet visible={showProfile} onClose={closeProfile} title="Настройки">
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
              <Switch value={demo} onValueChange={setDemo} accessibilityLabel="Режим демонстрации" trackColor={{ true: C.primary, false: C.line }} thumbColor="#fff" activeThumbColor="#fff" />
          </View>
        </View>

        <View className={CARD}>
          <Row title="Сервис анализа фото" icon="settings-outline" sub={analysisAddress(apiUrl) ? 'Адрес задан' : 'Адрес не задан'}
            onPress={() => { closeProfile(); openAnalysisSettings(); }} last />
        </View>
      </Sheet>
      <Sheet visible={analysisSettings !== null} onClose={() => setAnalysisSettings(null)} title="Сервис анализа фото"
        footer={<Primary title={photo && !vis && !busy ? 'Сохранить и анализировать' : 'Сохранить адрес'} onPress={saveAnalysisSettings} />}>
        <Text className={T.body}>Введите адрес сервиса команды. Снимки будут отправляться туда для анализа.</Text>
        <TextInput className="border border-line rounded-xl px-4 h-12 text-[17px] text-fg bg-surface"
          value={analysisSettings ?? ''} onChangeText={(value) => { setAnalysisSettings(value); setAddressError(''); }}
          accessibilityLabel="Адрес сервиса" autoCapitalize="none" autoCorrect={false} keyboardType="url"
          placeholder="http://адрес-сервера:8000" placeholderTextColor={C.muted} onSubmitEditing={saveAnalysisSettings} />
        {!!addressError && <Text accessibilityLiveRegion="polite" className="text-[15px] text-defect">{addressError}</Text>}
      </Sheet>
    </View>
  );
}
