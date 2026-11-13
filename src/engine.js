// Движок правил: показания датчиков + дефекты с фото -> диагнозы и рекомендации.
// Логика та же, что в engine.py, проверенном на базах кейса.
import RULES from './data/rules.json';
import SENS from './data/sensors.json';

export { RULES, SENS };

export const STATUS_TEXT = {
  ok: 'Видимых проблем не обнаружено',
  check: 'Рекомендуется проверка',
  defect: 'Признаки возможного дефекта',
};
export const STATUS_SHORT = { ok: 'Норма', check: 'Проверить', defect: 'Дефект' };
const RANK = { ok: 0, check: 1, defect: 2 };
export const worse = (a, b) => (RANK[a] >= RANK[b] ? a : b);

// К какому узлу карточки относится каждое правило.
export const RULE_COMP = {
  S01: 'impeller', S02: 'coupling', S03: 'bearing', S04: 'bearing', S05: 'motor',
  V01: 'terminal', V02: 'motor', V03: 'motor', V04: 'terminal', V05: 'piping', V06: 'piping', V07: 'piping', V08: 'piping',
  V09: 'seal', V10: 'seal', V11: 'casing', V12: 'frame', V13: 'casing', V14: 'piping', V15: 'piping', V16: 'piping',
  V17: 'terminal', V18: 'piping',
  C01: 'bearing', C02: 'bearing', C03: 'bearing', C04: 'coupling', C05: 'motor', C06: 'terminal', C07: 'motor', C08: 'impeller', C09: 'terminal',
};

export const num = (v, d = 1) =>
  Number(v).toFixed(d).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function sensorsAt(i) {
  return { amp_1x: SENS.a1[i], amp_2x: SENS.a2[i], hf_noise: SENS.hf[i], t_bearing: SENS.tb[i], t_winding: SENS.tw[i] };
}
export const SERIES = { amp_1x: 'a1', amp_2x: 'a2', hf_noise: 'hf', t_bearing: 'tb', t_winding: 'tw' };

export function sensorTime(i) {
  const d = new Date(2026, 10, 10, 8, 0, 0);
  d.setHours(d.getHours() + i);
  return d;
}
const p2 = (n) => String(n).padStart(2, '0');
export const fmtTs = (t) => {
  const d = new Date(t);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
export const fmtDate = (s) => {
  if (!s) return 'нет данных';
  const d = new Date(s);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
};

// sensors: {param: value} или null; classes: [{cls, confidence, explanation}]
export function diagnose(sensors, classes) {
  const fired = {};
  const vis = new Set();
  const out = [];
  if (sensors) {
    for (const r of RULES.sensor_rules) {
      const v = sensors[r.param];
      if (v == null) continue;
      const lvl = v > r.alarm ? 'alarm' : v > r.warn ? 'warn' : null;
      if (!lvl) continue;
      fired[r.id] = lvl;
      out.push({
        id: r.id, src: 'датчики', comp: RULE_COMP[r.id], label: r[lvl + '_label'], status: lvl === 'alarm' ? 'defect' : 'check',
        detail: `${r.column}: ${num(v, 2)} при пороге ${num(r[lvl], 1)}`, action: r[lvl + '_action'],
      });
    }
  }
  for (const r of RULES.visual_rules) {
    const hit = (classes || []).find((c) => c.cls === r.class);
    if (!hit) continue;
    vis.add(r.id);
    out.push({
      id: r.id, src: 'камера', comp: RULE_COMP[r.id], label: r.name, status: r.status,
      detail: hit.explanation || r.signs, action: r.action, confidence: hit.confidence,
    });
  }
  for (const r of RULES.combined_rules) {
    if (!r.sensor.length) continue; // чисто визуальные правила уже перечислены выше
    const sOk = r.sensor.every((s) => fired[s]);
    const vOk = !r.visual.length || r.visual.some((v) => vis.has(v));
    if (!sOk || !vOk) continue;
    const used = r.sensor.concat(r.visual.filter((v) => vis.has(v)));
    out.push({
      id: r.id, src: r.visual.length ? 'камера + датчики' : 'датчики', comp: RULE_COMP[r.id], label: r.diagnosis, status: r.status,
      detail: `Совпали правила ${used.join(', ')}. Уверенность: ${r.confidence}.`, action: r.action, combined: true,
    });
  }
  return out;
}

// Расчёт ресурса узла. override: {at, date, lastCheck} из истории замен.
export function resource(unit, comp, override) {
  const o = override || {};
  const s = { at: o.at != null ? o.at : comp.at, date: o.date || comp.date, lastCheck: o.lastCheck || null };
  if (comp.norm == null) return { kind: 'none', status: 'ok', text: 'Нормативный срок не задан, обслуживание по состоянию', s };
  if (unit.hours == null || s.at == null) return { kind: 'nodata', status: 'check', text: 'Недостаточно данных: нет наработки и даты установки', s };
  const used = unit.hours - s.at;
  const rem = comp.norm - used;
  const pct = Math.max(0, Math.min(100, (used / comp.norm) * 100));
  const status = rem <= 0 ? 'defect' : rem < comp.norm * 0.2 ? 'check' : 'ok';
  const text = rem <= 0 ? `Норматив превышен на ${num(-rem, 0)} ч` : `Остаток около ${num(rem, 0)} ч (${num(100 - pct, 0)} %)`;
  return { kind: 'calc', used, rem, pct, status, text, s };
}

// Сводная модель агрегата: находки, состояние и ресурс по каждому узлу, общий статус.
export function buildModel(unit, idx, classes, compState) {
  const findings = diagnose(unit.sensors ? sensorsAt(idx) : null, classes);
  const byComp = {};
  for (const c of unit.comps) byComp[c.id] = { c, res: resource(unit, c, compState[`${unit.id}__${c.id}`]), findings: [] };
  for (const f of findings) if (byComp[f.comp]) byComp[f.comp].findings.push(f);
  let overall = 'ok';
  for (const k of Object.keys(byComp)) {
    const b = byComp[k];
    b.cond = b.findings.reduce((m, f) => worse(f.status, m), 'ok');
    b.status = worse(b.res.status, b.cond);
    overall = worse(b.status, overall);
  }
  return { unit, findings, byComp, overall };
}

// Проверка и очистка ответа сервиса анализа фото.
export function cleanVision(r, unit) {
  const okBox = (b) => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && isFinite(n));
  const classes = new Set(RULES.visual_rules.map((x) => x.class));
  const comps = new Set(unit.comps.map((c) => c.id));
  return {
    equipment: typeof r?.equipment === 'string' ? r.equipment.slice(0, 80) : '',
    findings: (Array.isArray(r?.findings) ? r.findings : [])
      .filter((f) => f && classes.has(f.cls) && !(typeof f.confidence === 'number' && f.confidence < 0.4))
      .slice(0, 12)
      .map((f) => ({
        cls: f.cls,
        confidence: typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : null,
        box: okBox(f.box) ? f.box : null,
        explanation: String(f.explanation || '').slice(0, 300),
      })),
    nodes: (Array.isArray(r?.nodes) ? r.nodes : []).filter((n) => n && comps.has(n.comp) && okBox(n.box)).slice(0, 12),
  };
}
