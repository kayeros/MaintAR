// MaintAR: AR-помощник инженера для диагностики промышленного оборудования.
// Всё работает на телефоне без сервера: правила, датчики из базы кейса, карточки, ресурс, история.
// Дефекты на фото определяет сервис анализа (адрес задаётся в настройках). Ручная правка нужна, только если ИИ ошибся.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Dimensions, Image, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import AuthScreen, { Splash } from './src/AuthScreen';
import { currentUser, logout } from './src/auth';
import { UNITS, SCENARIOS, SAMPLES } from './src/data/units';
import {
  RULES, SENS, SERIES, RULE_COMP, STATUS_TEXT, STATUS_SHORT, buildModel, cleanVision, fmtDate, fmtTs, num, sensorTime, sensorsAt,
} from './src/engine';

const C = {
  bg: '#eef2f5', surface: '#ffffff', sunken: '#e6ecf0', line: '#d5dde3', divider: '#e8edf1',
  fg: '#12202b', muted: '#5b6b78', faint: '#8a98a3',
  accent: '#0b5c7a', accentSoft: '#e1eef3',
  ok: '#1f7a4d', okBg: '#dcefe4', check: '#9a5b00', checkBg: '#fbe9c8', defect: '#b3261e', defectBg: '#f9dcd9',
};
const TABS = [['inspect', 'Осмотр', 'clipboard-outline'], ['card', 'Карточка', 'document-text-outline'], ['sensors', 'Датчики', 'pulse-outline'], ['history', 'История', 'time-outline']];
const ACTIONS = { checked: 'Проверено', defect: 'Дефект', replaced: 'Заменено' };
const ACTION_STATUS = { checked: 'ok', defect: 'defect', replaced: 'accent' };
const SRC_TEXT = { 'камера': 'по фото', 'датчики': 'по датчикам', 'камера + датчики': 'фото и датчики' };
const RANK = { defect: 2, check: 1, ok: 0 };

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
  return (
    <View style={[s.pill, big && s.pillBig, { backgroundColor: C[status + 'Bg'] || C.sunken }]}>
      <View style={[s.dot, { backgroundColor: C[status] || C.muted }]} />
      <Text style={[s.pillText, big && { fontSize: 15 }, { color: C[status] || C.muted }]}>{text || STATUS_SHORT[status]}</Text>
    </View>
  );
}
function Btn({ title, icon, onPress, kind = 'secondary', small, disabled, style }) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={({ pressed }) => [s.btn, s['btn_' + kind], small && s.btnSmall, (disabled || pressed) && { opacity: disabled ? 0.45 : 0.8 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {!!icon && <Ionicons name={icon} size={small ? 18 : 22} color={s['btnText_' + kind].color} />}
        <Text style={[s.btnText, s['btnText_' + kind], small && { fontSize: 14 }]}>{title}</Text>
      </View>
    </Pressable>
  );
}
function Chip({ title, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { backgroundColor: C.accent, borderColor: C.accent }]}>
      <Text style={[s.chipText, active && { color: '#fff', fontWeight: '600' }]}>{title}</Text>
    </Pressable>
  );
}
function Link({ title, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
      <Text style={s.link}>{title}</Text>
    </Pressable>
  );
}
const Card = ({ title, right, children, style }) => (
  <View style={[s.card, style]}>
    {(title || right) && <View style={s.rowBetween}><Text style={[s.h2, { flex: 1 }]}>{title}</Text>{right}</View>}
    {children}
  </View>
);
const Step = ({ n, title, hint, right, children }) => (
  <View style={s.card}>
    <View style={s.stepHead}>
      <View style={s.stepNum}><Text style={s.stepNumText}>{n}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.h2}>{title}</Text>
        {!!hint && <Text style={s.small}>{hint}</Text>}
      </View>
      {right}
    </View>
    {children}
  </View>
);
function Item({ status, onPress, children }) {
  const body = <View style={[s.item, { borderLeftColor: C[status] || C.line }]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.75 }}>{body}</Pressable> : body;
}
const KV = ({ k, v, last }) => (
  <View style={[s.kv, !last && s.kvLine]}>
    <Text style={s.kvK}>{k}</Text><Text style={s.kvV}>{v}</Text>
  </View>
);
const Chevron = () => <Text style={s.chevron}>›</Text>;

function ResBar({ res }) {
  if (res.kind !== 'calc') return <Text style={s.faint}>{res.text}</Text>;
  return (
    <View style={{ gap: 6 }}>
      <View style={s.bar}><View style={{ width: `${Math.max(2, res.pct)}%`, height: '100%', backgroundColor: C[res.status], borderRadius: 5 }} /></View>
      <View style={s.rowBetween}>
        <Text style={s.small}>использовано {num(res.pct, 0)} %</Text>
        <Text style={[s.small, { color: C[res.status], fontWeight: '600' }]}>{res.text}</Text>
      </View>
    </View>
  );
}

/* ---------- фото с рамками ---------- */
function PhotoStage({ photo, vis, model, busy, onPick }) {
  const [lw, setW] = useState(0);
  if (!photo) {
    return (
      <View key="empty" style={[s.stage, s.stageEmpty]}>
        <Text style={s.stageEmptyTitle}>Фото пока нет</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>Снимите узел. ИИ найдёт дефекты и обведёт их рамками.</Text>
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
    <View key="photo" style={[s.stage, { aspectRatio: ratio }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Image source={photo.source || { uri: photo.uri }} style={s.photoImg} resizeMode="contain" />
      {boxes.map((b) => {
        const inside = b.y * H < LABEL_H + 2; // рамка у верхнего края: подпись внутрь
        const rightSide = b.x > 0.5;          // рамка справа: подпись прижимаем к правому краю рамки
        const maxW = rightSide ? (b.x + b.w) * W - 4 : (1 - b.x) * W - 4;
        return (
          <Pressable key={b.key} onPress={() => onPick(b.comp)} hitSlop={4}
            style={[s.box, {
              left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
              borderColor: C[b.status], borderStyle: b.status === 'ok' ? 'dashed' : 'solid',
            }]}>
            <View style={[s.boxLabel, {
              backgroundColor: C[b.status], maxWidth: Math.max(60, maxW),
              top: inside ? 0 : -LABEL_H - 1,
              [rightSide ? 'right' : 'left']: -3,
            }]}>
              <Text numberOfLines={1} style={s.boxLabelText}>{b.label}</Text>
            </View>
          </Pressable>
        );
      })}
      {busy && (
        <View style={s.busy}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={s.busyText}>ИИ анализирует фото…</Text>
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
    <View style={{ height: H, marginTop: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: H, gap: 1 }}>
        {seg.map((v, i) => (
          <View key={i} style={{
            flex: 1, height: Math.max(1, (v / top) * H), borderTopLeftRadius: 1, borderTopRightRadius: 1,
            backgroundColor: v > rule.alarm ? C.defect : v > rule.warn ? C.check : '#7fa9bb',
          }} />
        ))}
      </View>
      <View style={[s.thresh, { bottom: (rule.warn / top) * H, borderColor: C.check }]} />
      <View style={[s.thresh, { bottom: (rule.alarm / top) * H, borderColor: C.defect }]} />
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

  if (!perm) return <View style={s.camWrap}><ActivityIndicator color="#fff" /></View>;
  if (!perm.granted) {
    return (
      <View style={[s.camWrap, { padding: 24, gap: 12 }]}>
        <Text style={[s.camText, { textAlign: 'center', marginBottom: 8 }]}>
          Нет доступа к камере. Разрешите его, чтобы снимать узлы и сканировать QR-коды.
        </Text>
        <Btn title="Разрешить камеру" kind="primary" onPress={requestPerm} style={{ alignSelf: 'stretch' }} />
        <Btn title="Назад" onPress={onClose} style={{ alignSelf: 'stretch' }} />
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
    <View style={s.camWrap}>
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)}
        barcodeScannerSettings={mode === 'qr' ? { barcodeTypes: ['qr'] } : undefined}
        onBarcodeScanned={mode === 'qr' ? (e) => { if (!scanned.current) { scanned.current = true; onQr(String(e.data || '')); } } : undefined} />
      {mode === 'qr' && <View style={s.qrFrame} pointerEvents="none" />}
      <View style={[s.camTop, { paddingTop: TOP + 10 }]}>
        <Text style={s.camTitle}>{mode === 'qr' ? 'Наведите камеру на QR-код агрегата' : 'Наведите камеру на узел'}</Text>
        {mode !== 'qr' && hints.length > 0 && <Text style={[s.camText, { opacity: 0.8 }]}>В первую очередь:</Text>}
        {mode !== 'qr' && hints.map((h) => (
          <View key={h.id} style={[s.camHint, { borderLeftColor: C[h.status] }]}>
            <Text style={[s.camText, { fontWeight: '600' }]}>{h.name}</Text>
            <Text style={[s.camText, { fontSize: 13, opacity: 0.85 }]}>{h.reason}</Text>
          </View>
        ))}
      </View>
      <View style={[s.camBottom, { paddingBottom: BOTTOM + 16 }]}>
        <Btn title="Назад" kind="dark" onPress={onClose} style={{ width: 96 }} />
        {mode !== 'qr' ? (
          <Pressable onPress={shoot} disabled={!ready || busy} style={[s.shutter, (!ready || busy) && { opacity: 0.5 }]}>
            <View style={s.shutterIn} />
          </Pressable>
        ) : <View />}
        <View style={{ width: 96 }} />
      </View>
    </View>
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
  const inspect = (
    <>
      <Step n="1" title="Что проверить" hint={attention.length ? 'По датчикам и ресурсу узлов' : null}>
        {attention.length ? (
          <>
            {attnShown.map((b) => (
              <Item key={b.c.id} status={b.status} onPress={() => setSheet(b.c.id)}>
                <View style={s.rowBetween}>
                  <Text style={[s.h3, { flex: 1 }]}>{b.c.name}</Text>
                  <Pill status={b.status} /><Chevron />
                </View>
                <Text style={s.body2}>{b.findings[0] ? b.findings[0].label : b.res.text}</Text>
              </Item>
            ))}
            {attention.length > 3 && (
              <Link title={showAllAttn ? 'Свернуть' : `Показать все (${attention.length})`} onPress={() => setShowAllAttn(!showAllAttn)} />
            )}
          </>
        ) : <Text style={s.muted}>По датчикам и ресурсу замечаний нет. Сделайте обзорное фото агрегата.</Text>}
      </Step>

      <Step n="2" title="Снимите узел" hint="ИИ сам найдёт дефекты на снимке">
        <PhotoStage photo={photo} vis={vis} model={model} busy={busy} onPick={setSheet} />
        {nBoxes > 0 && !busy && <Text style={s.hint}>Нажмите на рамку, чтобы открыть узел</Text>}
        <Btn title={photo ? 'Снять новое фото' : 'Снять фото'} kind="primary" icon="camera-outline" onPress={() => setCamMode('photo')} />
        <View style={s.row}>
          <Btn title="Из галереи" icon="images-outline" onPress={pickFromGallery} style={{ flex: 1 }} />
          {photo && <Btn title="Убрать фото" kind="ghost" onPress={resetPhoto} style={{ flex: 1 }} />}
        </View>
        {ai && ai.kind === 'noapi' && (
          <View style={[s.notice, { backgroundColor: C.checkBg }]}>
            <Text style={[s.body2, { color: C.fg }]}>{ai.text}</Text>
            <Btn small title="Открыть настройки" onPress={() => setShowSettings(true)} style={{ alignSelf: 'flex-start' }} />
          </View>
        )}
        {ai && ai.kind === 'error' && (
          <View style={[s.notice, { backgroundColor: C.defectBg }]}>
            <Text style={[s.body2, { color: C.fg }]}>{ai.text}</Text>
            <Btn small title="Открыть настройки" onPress={() => setShowSettings(true)} style={{ alignSelf: 'flex-start' }} />
          </View>
        )}
        {ai && ai.kind === 'info' && <Text style={s.note}>{ai.text}</Text>}
        <View style={s.samples}>
          <Text style={s.small}>Нет оборудования рядом? Откройте пример:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {SAMPLES.map((x) => <Chip key={x.key} title={x.label} onPress={() => pickSample(x)} />)}
          </ScrollView>
        </View>
      </Step>

      <Step n="3" title="Результат">
        <View style={[s.banner, { backgroundColor: C[model.overall + 'Bg'], borderColor: C[model.overall] }]}>
          <View style={s.rowBetween}>
            <Text style={[s.bannerTitle, { color: C[model.overall], flex: 1 }]}>{STATUS_TEXT[model.overall]}</Text>
          </View>
          <Text style={s.bannerText}>
            <Text style={{ fontWeight: '700' }}>В первую очередь: </Text>
            {top ? top.action : 'Замечаний нет. Продолжайте плановый обход.'}
          </Text>
        </View>
        <Text style={s.small}>
          {unit.sensors ? `Датчики: запись от ${fmtTs(sensorTime(idx))}` : 'Датчики к агрегату не подключены, вывод только по фото и ресурсу.'}
        </Text>
        {findings.map((f) => (
          <Item key={f.id} status={f.status} onPress={() => setSheet(f.comp)}>
            <View style={s.rowBetween}>
              <Text style={[s.h3, { flex: 1 }]}>{f.label}</Text>
              <Pill status={f.status} />
            </View>
            <View style={s.row}>
              <Text style={s.src}>{SRC_TEXT[f.src] || f.src}</Text>
              {f.confidence != null && <Text style={s.src}>уверенность {Math.round(f.confidence * 100)} %</Text>}
            </View>
            <Text style={s.body2}>{f.detail}</Text>
            <View style={s.todo}>
              <Text style={s.todoTitle}>Что делать</Text>
              <Text style={s.body2c}>{f.action}</Text>
            </View>
            <Text style={s.code}>Правило {f.id}</Text>
          </Item>
        ))}
        <Text style={s.faint}>Предварительный осмотр. Если видимых дефектов нет, это ещё не подтверждает исправность оборудования.</Text>
        <Link title={showManual ? 'Скрыть ручную правку' : 'ИИ ошибся? Исправить вручную'} onPress={() => setShowManual(!showManual)} />
        {showManual && (
          <View style={{ gap: 12 }}>
            <Text style={s.small}>Отметьте дефекты, которые видите сами. Отметку можно снять повторным нажатием.</Text>
            {unit.comps.map((c) => {
              const rules = RULES.visual_rules.filter((r) => RULE_COMP[r.id] === c.id);
              if (!rules.length) return null;
              return (
                <View key={c.id} style={{ gap: 6 }}>
                  <Text style={s.groupTitle}>{c.name}</Text>
                  <View style={s.row}>
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
        <Text style={s.note}>{unit.note}</Text>
      </Card>
      <Card title="Узлы и ресурс">
        <Text style={s.small}>Нажмите на узел, чтобы увидеть норматив, расчёт ресурса и фактическое состояние.</Text>
        {Object.values(model.byComp).map((b) => (
          <Item key={b.c.id} status={b.status} onPress={() => setSheet(b.c.id)}>
            <View style={s.rowBetween}>
              <Text style={[s.h3, { flex: 1 }]}>{b.c.name}</Text>
              <Pill status={b.status} /><Chevron />
            </View>
            {b.c.norm != null && <Text style={s.small}>Норматив {num(b.c.norm, 0)} ч</Text>}
            <ResBar res={b.res} />
          </Item>
        ))}
      </Card>
    </>
  );

  /* ----- вкладка «Датчики» ----- */
  const sensorsTab = !unit.sensors ? (
    <Card title="Датчики">
      <Text style={s.body}>К этому агрегату датчики не подключены. Диагноз строится по фото и ресурсу узлов.</Text>
    </Card>
  ) : (
    <>
      <Card title="Показать ситуацию">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
          {SCENARIOS.map(([t, i]) => <Chip key={t} title={t} active={idx === i} onPress={() => setIdx(i)} />)}
        </ScrollView>
        <View style={s.timeBox}>
          <Text style={s.small}>Момент времени</Text>
          <Text style={s.timeVal}>{fmtTs(sensorTime(idx))}</Text>
          <Text style={s.small}>{num(SENS.rpm[idx], 0)} об/мин · СКЗ {num(SENS.rms[idx], 2)} мм/с</Text>
        </View>
        <View style={s.row}>
          {[['−24 ч', -24], ['−1 ч', -1], ['+1 ч', 1], ['+24 ч', 24]].map(([t, d]) => (
            <Btn key={t} small title={t} style={{ flex: 1 }} onPress={() => setIdx(Math.max(0, Math.min(499, idx + d)))} />
          ))}
        </View>
        <Text style={s.faint}>Запись {idx + 1} из 500, шаг 1 час. Выбор момента заменяет живой поток с датчиков.</Text>
      </Card>
      <Card title="Показания">
        {RULES.sensor_rules.map((r) => {
          const v = sensorsAt(idx)[r.param];
          const lvl = v > r.alarm ? 'defect' : v > r.warn ? 'check' : 'ok';
          const unitTxt = (r.column.match(/\((.+)\)/) || [])[1] || '';
          const text = lvl === 'ok' ? 'Норма' : lvl === 'check' ? r.warn_label.replace('Пред: ', '') : r.alarm_label.replace('Тревога: ', '');
          return (
            <Item key={r.id} status={lvl}>
              <Text style={s.h3}>{r.column.replace(/\s*\(.+\)/, '')}</Text>
              <View style={s.rowBetween}>
                <Text style={s.val}>{num(v, r.param[0] === 't' ? 1 : 2)} <Text style={s.valUnit}>{unitTxt}</Text></Text>
                <Pill status={lvl} text={text} />
              </View>
              <Spark param={r.param} rule={r} idx={idx} />
              <View style={s.legend}>
                <View style={s.legendItem}><View style={[s.legendLine, { borderColor: C.check }]} /><Text style={s.small}>порог {num(r.warn, 1)}</Text></View>
                <View style={s.legendItem}><View style={[s.legendLine, { borderColor: C.defect }]} /><Text style={s.small}>тревога {num(r.alarm, 1)}</Text></View>
                <Text style={[s.small, { marginLeft: 'auto' }]}>96 ч</Text>
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
    <Card title="История осмотров" right={<Text style={s.faint}>на телефоне</Text>}>
      {rows.length ? rows.map((h) => {
        const st = ACTION_STATUS[h.action] || 'check';
        const col = st === 'accent' ? C.accent : C[st];
        const bg = st === 'accent' ? C.accentSoft : C[st + 'Bg'];
        return (
          <View key={h.ts + h.comp} style={[s.item, { borderLeftColor: col }]}>
            <View style={s.rowBetween}>
              <View style={[s.actTag, { backgroundColor: bg }]}><Text style={[s.actTagText, { color: col }]}>{ACTIONS[h.action] || h.action}</Text></View>
              <Text style={s.small}>{fmtTs(h.ts)}</Text>
            </View>
            <Text style={s.h3}>{h.compName}</Text>
            {!!h.findings && <Text style={s.body2}>{h.findings}</Text>}
            {!!h.note && <Text style={s.body2}><Text style={s.bold}>Заметка: </Text>{h.note}</Text>}
            {!!(h.user && h.user.name) && (
              <View style={s.who}>
                <Ionicons name="person-outline" size={15} color={C.muted} />
                <Text style={s.small}>{h.user.name}{h.user.role ? `, ${h.user.role}` : ''}</Text>
              </View>
            )}
          </View>
        );
      }) : (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>Записей пока нет</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            Откройте любой узел на вкладке «Осмотр» или «Карточка» и нажмите «Проверено», «Зафиксировать дефект» или «Заменено». Запись появится здесь.
          </Text>
        </View>
      )}
    </Card>
  );

  const sb = sheet ? model.byComp[sheet] : null;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.accent} />
      <View style={[s.header, { paddingTop: TOP + 10 }]}>
        <View style={s.rowBetween}>
          <View style={{ flex: 1 }}>
            <View style={s.appRow}>
              <Text style={s.appName}>MaintAR</Text>
              <Pressable onPress={() => setShowSettings(true)} style={s.userChip} hitSlop={6}>
                <Ionicons name="person-circle-outline" size={16} color="#fff" />
                <Text style={s.userChipText} numberOfLines={1}>{user.name}</Text>
              </Pressable>
            </View>
            <Text style={s.unitName} numberOfLines={2}>{unit.name}</Text>
            <Text style={s.unitCode}>{unit.id}{unit.demo ? ' · учебная карточка' : ' · по паспорту'}</Text>
          </View>
          <Pill status={model.overall} big />
        </View>
        <View style={s.headActions}>
          <Pressable style={s.headBtn} onPress={() => setCamMode('qr')}><Ionicons name="qr-code-outline" size={18} color="#fff" /><Text style={s.headBtnText}>Сканировать QR</Text></Pressable>
          <Pressable style={s.headBtn} onPress={() => setShowUnits(true)}><Ionicons name="swap-horizontal-outline" size={18} color="#fff" /><Text style={s.headBtnText}>Сменить агрегат</Text></Pressable>
          <Pressable style={s.headBtn} onPress={() => setShowSettings(true)}><Ionicons name="settings-outline" size={18} color="#fff" /><Text style={s.headBtnText}>Настройки</Text></Pressable>
        </View>
        {!!idNote && <Text style={s.idNote}>{idNote}</Text>}
      </View>

      <ScrollView ref={scroll} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {tab === 'inspect' ? inspect : tab === 'card' ? card : tab === 'sensors' ? sensorsTab : historyTab}
      </ScrollView>

      <View style={[s.tabs, { paddingBottom: BOTTOM }]}>
        {TABS.map(([id, title, icon]) => {
          const on = tab === id;
          return (
            <Pressable key={id} onPress={() => switchTab(id)} style={s.tab}>
              <View style={[s.tabInd, on && { backgroundColor: C.accent }]} />
              <View style={[s.tabPill, on && { backgroundColor: C.accentSoft }]}>
                <Ionicons name={on ? icon.replace('-outline', '') : icon} size={24} color={on ? C.accent : C.muted} />
                <Text style={[s.tabText, on && { color: C.accent, fontWeight: '700' }]}>{title}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* окно узла */}
      <Modal visible={!!sb} transparent animationType="slide" onRequestClose={closeSheet} statusBarTranslucent>
        <View style={s.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={closeSheet} />
          {sb && (
            <View style={[s.sheet, { paddingBottom: BOTTOM + 8 }]}>
              <View style={s.grabber} />
              <View style={s.sheetHead}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={s.h1}>{sb.c.name}</Text>
                  <View style={{ alignSelf: 'flex-start' }}><Pill status={sb.status} text={STATUS_TEXT[sb.status]} /></View>
                </View>
                <Pressable onPress={closeSheet} hitSlop={10} style={s.closeBtn}><Ionicons name="close" size={20} color={C.accent} /><Text style={s.closeText}>Закрыть</Text></Pressable>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
                <Text style={s.muted}>{sb.c.desc}</Text>
                <View style={s.block}>
                  <Text style={s.blockTitle}>По нормативу</Text>
                  <KV k="Нормативный срок" v={sb.c.norm != null ? `${num(sb.c.norm, 0)} ч` : 'не задан'} />
                  <KV k="Установлен" v={fmtDate(sb.res.s.date)} last />
                </View>
                <View style={s.block}>
                  <Text style={s.blockTitle}>Расчёт ресурса</Text>
                  {sb.res.kind === 'calc' && <KV k="Наработка узла" v={`${num(sb.res.used, 0)} ч`} />}
                  <ResBar res={sb.res} />
                </View>
                <View style={s.block}>
                  <Text style={s.blockTitle}>Фактическое состояние</Text>
                  <Text style={[s.body, { color: sb.findings.length ? C[sb.cond] : C.ok, fontWeight: '600' }]}>
                    {sb.findings.length ? STATUS_TEXT[sb.cond] : 'Замечаний по фото и датчикам нет'}
                  </Text>
                  <KV k="Последняя проверка" v={sb.res.s.lastCheck ? fmtTs(sb.res.s.lastCheck) : 'нет записей'} last />
                </View>
                {sb.findings.length > 0 && <Text style={s.h2}>Рекомендации</Text>}
                {sortFindings(sb.findings).map((f) => (
                  <Item key={f.id} status={f.status}>
                    <Text style={s.h3}>{f.label}</Text>
                    <Text style={s.src}>{SRC_TEXT[f.src] || f.src}</Text>
                    <Text style={s.body2}>{f.detail}</Text>
                    <View style={s.todo}>
                      <Text style={s.todoTitle}>Что делать</Text>
                      <Text style={s.body2c}>{f.action}</Text>
                    </View>
                  </Item>
                ))}
                <TextInput style={s.input} multiline value={note} onChangeText={setNote}
                  placeholder="Заметка: что увидели и что сделали" placeholderTextColor={C.faint} />
                <Btn title="Проверено" kind="primary" onPress={() => record('checked')} />
                <Btn title="Зафиксировать дефект" kind="danger" onPress={() => record('defect')} />
                <Btn title="Заменено" onPress={() => record('replaced')} />
              </ScrollView>
            </View>
          )}
        </View>
      </Modal>

      {/* выбор агрегата */}
      <Modal visible={showUnits} transparent animationType="slide" onRequestClose={() => setShowUnits(false)} statusBarTranslucent>
        <View style={s.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowUnits(false)} />
          <View style={[s.sheet, { paddingBottom: BOTTOM + 8 }]}>
            <View style={s.grabber} />
            <View style={s.sheetHead}>
              <Text style={[s.h1, { flex: 1 }]}>Выберите агрегат</Text>
              <Pressable onPress={() => setShowUnits(false)} hitSlop={10} style={s.closeBtn}><Ionicons name="close" size={20} color={C.accent} /><Text style={s.closeText}>Закрыть</Text></Pressable>
            </View>
            {UNITS.map((u) => {
              const on = u.id === unitId;
              return (
                <Pressable key={u.id} onPress={() => chooseUnit(u.id, '')}
                  style={[s.unitRow, on && { borderColor: C.accent, backgroundColor: C.accentSoft }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.h3}>{u.name}</Text>
                    <Text style={s.small}>{u.id}{u.sensors ? ' · есть датчики' : ' · без датчиков'}</Text>
                  </View>
                  {on ? <Text style={[s.small, { color: C.accent, fontWeight: '700' }]}>Выбран</Text> : <Chevron />}
                </Pressable>
              );
            })}
            <Btn title="Сканировать QR-код" onPress={() => { setShowUnits(false); setCamMode('qr'); }} />
          </View>
        </View>
      </Modal>

      {/* настройки */}
      <Modal visible={showSettings} transparent animationType="slide" onRequestClose={closeSettings} statusBarTranslucent>
        <View style={s.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={closeSettings} />
          <View style={[s.sheet, { paddingBottom: BOTTOM + 8 }]}>
            <View style={s.grabber} />
            <View style={s.sheetHead}>
              <Text style={[s.h1, { flex: 1 }]}>Настройки</Text>
              <Pressable onPress={closeSettings} hitSlop={10} style={s.closeBtn}><Ionicons name="close" size={20} color={C.accent} /><Text style={s.closeText}>Закрыть</Text></Pressable>
            </View>
            <View style={s.block}>
              <Text style={s.blockTitle}>Сотрудник</Text>
              <View style={[s.rowBetween, { alignItems: 'center' }]}>
                <Ionicons name="person-circle-outline" size={40} color={C.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={s.h3}>{user.name}</Text>
                  <Text style={s.small}>{user.role} · логин {user.login}</Text>
                </View>
              </View>
              {confirmLogout ? (
                <View style={{ gap: 8 }}>
                  <Text style={s.body}>Выйти из учётной записи? История осмотров останется на телефоне.</Text>
                  <View style={s.row}>
                    <Btn title="Выйти" kind="danger" icon="log-out-outline" onPress={doLogout} style={{ flex: 1 }} />
                    <Btn title="Отмена" onPress={() => setConfirmLogout(false)} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : (
                <Btn title="Выйти" icon="log-out-outline" onPress={() => setConfirmLogout(true)} />
              )}
            </View>
            <Text style={s.h3}>Сервис анализа фото</Text>
            <Text style={s.muted}>
              Адрес сервера, который находит дефекты на снимке. Например: http://192.168.1.50:8000
            </Text>
            <TextInput style={[s.input, { minHeight: 48 }]} value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false}
              keyboardType="url" placeholder="http://адрес-сервера:8000" placeholderTextColor={C.faint} />
            <Text style={s.faint}>{apiUrl.trim() ? 'Адрес задан. Новые фото будут отправляться на анализ.' : 'Адрес не задан. Без него ИИ не сможет проверить ваши фото.'}</Text>
            <Btn title="Готово" kind="primary" onPress={closeSettings} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 14, paddingBottom: 28, gap: 14 },

  header: { backgroundColor: C.accent, paddingHorizontal: 16, paddingBottom: 14, gap: 12 },
  appName: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  appRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  userChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, maxWidth: 190 },
  userChipText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unitName: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 2 },
  unitCode: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2 },
  headActions: { flexDirection: 'row', gap: 8 },
  headBtn: { flex: 1, minHeight: 52, gap: 3, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  headBtnText: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  idNote: { color: '#fff', fontSize: 13, opacity: 0.9 },

  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, gap: 12, borderWidth: 1, borderColor: C.divider },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  h1: { fontSize: 21, fontWeight: '700', color: C.fg },
  h2: { fontSize: 18, fontWeight: '700', color: C.fg },
  h3: { fontSize: 16, fontWeight: '600', color: C.fg },
  body: { fontSize: 15, color: C.fg, lineHeight: 22 },
  body2: { fontSize: 15, color: C.muted, lineHeight: 21 },
  body2c: { fontSize: 15, color: C.fg, lineHeight: 21 },
  small: { fontSize: 13, color: C.muted, lineHeight: 18 },
  faint: { fontSize: 13, color: C.faint, lineHeight: 18 },
  bold: { fontWeight: '700', color: C.fg },
  muted: { fontSize: 15, color: C.muted, lineHeight: 21 },
  hint: { fontSize: 14, color: C.accent, textAlign: 'center' },
  note: { fontSize: 14, color: C.muted, borderLeftWidth: 3, borderLeftColor: C.accent, paddingLeft: 10, lineHeight: 20 },
  link: { fontSize: 15, color: C.accent, fontWeight: '600', textDecorationLine: 'underline' },
  chevron: { fontSize: 24, color: C.faint, marginLeft: 2, marginTop: -3 },
  code: { fontSize: 11.5, color: C.faint, textAlign: 'right' },
  src: { alignSelf: 'flex-start', fontSize: 13, color: C.accent, backgroundColor: C.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  groupTitle: { fontSize: 14, fontWeight: '700', color: C.muted },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillBig: { paddingHorizontal: 14, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 13, fontWeight: '700' },

  btn: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btn_primary: { backgroundColor: C.accent, borderColor: C.accent, minHeight: 54 },
  btn_secondary: { backgroundColor: C.surface, borderColor: C.line },
  btn_ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  btn_danger: { backgroundColor: C.surface, borderColor: C.defect },
  btn_dark: { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.35)' },
  btnSmall: { minHeight: 40, paddingHorizontal: 12, paddingVertical: 6 },
  btnText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  btnText_primary: { color: '#fff', fontSize: 17 },
  btnText_secondary: { color: C.fg },
  btnText_ghost: { color: C.muted },
  btnText_danger: { color: C.defect },
  btnText_dark: { color: '#fff' },

  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: C.surface },
  chipText: { fontSize: 14, color: C.fg },

  item: { borderWidth: 1, borderColor: C.divider, borderLeftWidth: 4, borderRadius: 12, padding: 12, gap: 8, backgroundColor: C.surface },
  todo: { backgroundColor: C.bg, borderRadius: 10, padding: 10, gap: 2 },
  todoTitle: { fontSize: 13, fontWeight: '700', color: C.accent },
  notice: { borderRadius: 12, padding: 12, gap: 10 },
  samples: { gap: 8, borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 12 },

  banner: { borderRadius: 12, padding: 14, gap: 8, borderLeftWidth: 5 },
  bannerTitle: { fontSize: 18, fontWeight: '700' },
  bannerText: { fontSize: 15, color: C.fg, lineHeight: 21 },

  stage: { width: '100%', backgroundColor: C.sunken, borderRadius: 12, overflow: 'hidden' },
  stageEmpty: { padding: 28, gap: 6, alignItems: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: C.line, backgroundColor: C.bg },
  stageEmptyTitle: { fontSize: 16, fontWeight: '700', color: C.fg },
  photoImg: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  box: { position: 'absolute', borderWidth: 3, borderRadius: 4 },
  boxLabel: { position: 'absolute', height: 22, justifyContent: 'center', paddingHorizontal: 6, borderRadius: 4 },
  boxLabelText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,24,34,0.55)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  busyText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  bar: { height: 10, borderRadius: 5, backgroundColor: C.sunken, overflow: 'hidden' },
  thresh: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1.5, borderStyle: 'dashed' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: { width: 16, borderTopWidth: 2, borderStyle: 'dashed' },
  val: { fontSize: 28, fontWeight: '700', color: C.fg, fontVariant: ['tabular-nums'] },
  valUnit: { fontSize: 15, fontWeight: '500', color: C.muted },
  timeBox: { backgroundColor: C.bg, borderRadius: 12, padding: 12, gap: 2 },
  timeVal: { fontSize: 20, fontWeight: '700', color: C.fg, fontVariant: ['tabular-nums'] },

  kv: { flexDirection: 'row', gap: 12, paddingVertical: 9 },
  kvLine: { borderBottomWidth: 1, borderBottomColor: C.divider },
  kvK: { flex: 1, fontSize: 14, color: C.muted, lineHeight: 20 },
  kvV: { flex: 1.3, fontSize: 15, color: C.fg, lineHeight: 20, textAlign: 'right' },

  actTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  actTagText: { fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.fg },

  tabs: { flexDirection: 'row', backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line },
  tab: { flex: 1, alignItems: 'center', minHeight: 64, justifyContent: 'center' },
  tabInd: { position: 'absolute', top: 0, left: '22%', right: '22%', height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  tabPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, alignItems: 'center', gap: 2 },
  tabText: { fontSize: 13, color: C.muted, fontWeight: '500' },

  backdrop: { flex: 1, backgroundColor: 'rgba(5,12,18,0.5)' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8, gap: 12, maxHeight: '90%' },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.line },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  closeBtn: { minHeight: 40, paddingHorizontal: 12, flexDirection: 'row', gap: 4, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 15, fontWeight: '600', color: C.accent },
  block: { backgroundColor: C.bg, borderRadius: 12, padding: 12, gap: 6 },
  blockTitle: { fontSize: 13, fontWeight: '700', color: C.accent, letterSpacing: 0.5, textTransform: 'uppercase' },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, minHeight: 80, fontSize: 15, color: C.fg, textAlignVertical: 'top', backgroundColor: C.surface },

  camWrap: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  camTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 14, gap: 6, backgroundColor: 'rgba(0,0,0,0.5)' },
  camTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  camText: { color: '#fff', fontSize: 15 },
  camHint: { borderLeftWidth: 4, paddingLeft: 10, paddingVertical: 2 },
  camBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, backgroundColor: 'rgba(0,0,0,0.5)' },
  qrFrame: { width: 240, height: 240, borderWidth: 3, borderColor: '#fff', borderRadius: 20 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
});
