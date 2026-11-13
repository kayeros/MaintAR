// Экран входа и регистрации сотрудника.
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DEMO, ROLES, login, register, validateRegistration } from './auth';

const C = {
  bg: '#eef2f5', surface: '#ffffff', line: '#d5dde3', fg: '#12202b', muted: '#5b6b78', faint: '#8a98a3',
  accent: '#0b5c7a', accentSoft: '#e1eef3', defect: '#b3261e', defectBg: '#f9dcd9',
};
const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 50;

export function Splash() {
  return (
    <View style={[s.root, { alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.accent} />
      <Text style={s.splashLogo}>MaintAR</Text>
      <ActivityIndicator color="#fff" style={{ marginTop: 16 }} />
    </View>
  );
}

function Field({ label, icon, error, secure, inputRef, ...props }) {
  const [hidden, setHidden] = useState(true);
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.inputWrap, !!error && { borderColor: C.defect }]}>
        <Ionicons name={icon} size={20} color={C.faint} />
        <TextInput ref={inputRef} style={s.input} placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false}
          secureTextEntry={secure && hidden} {...props} />
        {secure && (
          <Pressable onPress={() => setHidden(!hidden)} hitSlop={10} accessibilityLabel={hidden ? 'Показать пароль' : 'Скрыть пароль'}>
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={22} color={C.muted} />
          </Pressable>
        )}
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [f, setF] = useState({ name: '', role: ROLES[0], login: '', password: '', password2: '' });
  const [errs, setErrs] = useState({});
  const [common, setCommon] = useState('');
  const [busy, setBusy] = useState(false);
  const passRef = useRef(null);
  const set = (k) => (v) => { setF({ ...f, [k]: v }); if (errs[k]) setErrs({ ...errs, [k]: undefined }); setCommon(''); };
  const switchMode = (m) => { setMode(m); setErrs({}); setCommon(''); setF({ ...f, password: '', password2: '' }); };

  const submit = async () => {
    if (busy) return;
    setCommon('');
    if (mode === 'register') {
      const e = validateRegistration(f);
      setErrs(e);
      if (Object.keys(e).length) return;
    } else {
      const e = {};
      if (!f.login.trim()) e.login = 'Введите логин';
      if (!f.password) e.password = 'Введите пароль';
      setErrs(e);
      if (Object.keys(e).length) return;
    }
    setBusy(true);
    try {
      const r = mode === 'login' ? await login(f.login, f.password) : await register(f);
      if (r.ok) { onAuth(r.user); return; }
      if (r.field) setErrs({ [r.field]: r.error }); else setCommon(r.error);
    } catch (e) {
      setCommon('Не удалось выполнить вход. Попробуйте ещё раз.');
    }
    setBusy(false);
  };

  const isReg = mode === 'register';
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.accent} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={[s.hero, { paddingTop: TOP + 28 }]}>
            <View style={s.logoMark}><Ionicons name="scan-outline" size={34} color="#fff" /></View>
            <Text style={s.logo}>MaintAR</Text>
            <Text style={s.tagline}>AR-помощник инженера</Text>
          </View>

          <View style={s.cardWrap}>
          <View style={s.card}>
            <Text style={s.title}>{isReg ? 'Регистрация сотрудника' : 'Вход'}</Text>
            {isReg && (
              <>
                <Field label="Фамилия и имя" icon="person-outline" value={f.name} onChangeText={set('name')} error={errs.name}
                  placeholder="Иванов Иван" autoCapitalize="words" autoCorrect={false} />
                <View style={{ gap: 6 }}>
                  <Text style={s.label}>Должность</Text>
                  <View style={s.roles}>
                    {ROLES.map((r) => {
                      const on = f.role === r;
                      return (
                        <Pressable key={r} onPress={() => set('role')(r)} style={[s.role, on && s.roleOn]}>
                          <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? C.accent : C.faint} />
                          <Text style={[s.roleText, on && { color: C.accent, fontWeight: '600' }]}>{r}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {!!errs.role && <Text style={s.error}>{errs.role}</Text>}
                </View>
              </>
            )}
            <Field label="Логин" icon="at-outline" value={f.login} onChangeText={set('login')} error={errs.login}
              placeholder={isReg ? 'например, ivanov' : 'Ваш логин'} returnKeyType="next"
              onSubmitEditing={() => passRef.current && passRef.current.focus()} />
            <Field label="Пароль" icon="lock-closed-outline" secure inputRef={passRef} value={f.password} onChangeText={set('password')}
              error={errs.password} placeholder={isReg ? 'Не меньше 4 символов' : 'Ваш пароль'}
              returnKeyType={isReg ? 'next' : 'go'} onSubmitEditing={isReg ? undefined : submit} />
            {isReg && (
              <Field label="Повторите пароль" icon="lock-closed-outline" secure value={f.password2} onChangeText={set('password2')}
                error={errs.password2} placeholder="Ещё раз тот же пароль" returnKeyType="go" onSubmitEditing={submit} />
            )}
            {!!common && <View style={s.commonErr}><Text style={[s.error, { fontSize: 15 }]}>{common}</Text></View>}

            <Pressable onPress={submit} disabled={busy} style={({ pressed }) => [s.btn, (busy || pressed) && { opacity: 0.8 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{isReg ? 'Зарегистрироваться' : 'Войти'}</Text>}
            </Pressable>

            <Pressable onPress={() => switchMode(isReg ? 'login' : 'register')} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 6 }}>
              <Text style={s.switchText}>
                {isReg ? 'Уже есть учётная запись? ' : 'Нет учётной записи? '}
                <Text style={s.link}>{isReg ? 'Войти' : 'Зарегистрироваться'}</Text>
              </Text>
            </Pressable>
          </View>
          </View>

          {!isReg && (
            <Pressable onPress={() => setF({ ...f, login: DEMO.login, password: DEMO.password })} style={s.demo}>
              <Ionicons name="information-circle-outline" size={18} color={C.muted} />
              <Text style={s.demoText}>Демо-доступ: логин {DEMO.login}, пароль {DEMO.password}. Нажмите, чтобы подставить.</Text>
            </Pressable>
          )}
          <Text style={s.foot}>Учётные записи хранятся на этом устройстве</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, paddingBottom: 32 },
  splashLogo: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: 0.5 },
  hero: { backgroundColor: C.accent, alignItems: 'center', paddingBottom: 56, paddingHorizontal: 16, gap: 6 },
  logoMark: { width: 64, height: 64, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  logo: { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: 0.5 },
  tagline: { color: 'rgba(255,255,255,0.8)', fontSize: 15 },
  cardWrap: { paddingHorizontal: 16, marginTop: -36, alignItems: 'center' },
  card: { backgroundColor: C.surface, borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: '#e8edf1', maxWidth: 480, width: '100%', alignSelf: 'center' },
  title: { fontSize: 21, fontWeight: '700', color: C.fg },
  label: { fontSize: 14, fontWeight: '600', color: C.muted },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, minHeight: 50, backgroundColor: C.surface },
  input: { flex: 1, fontSize: 16, color: C.fg, paddingVertical: 10 },
  error: { fontSize: 13.5, color: C.defect },
  commonErr: { backgroundColor: C.defectBg, borderRadius: 10, padding: 10 },
  roles: { gap: 8 },
  role: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 },
  roleOn: { borderColor: C.accent, backgroundColor: C.accentSoft },
  roleText: { fontSize: 15, color: C.fg },
  btn: { backgroundColor: C.accent, borderRadius: 12, minHeight: 54, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  switchText: { fontSize: 15, color: C.muted, textAlign: 'center' },
  link: { color: C.accent, fontWeight: '700' },
  demo: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginHorizontal: 20, marginTop: 16 },
  demoText: { flex: 1, fontSize: 13.5, color: C.muted, lineHeight: 19 },
  foot: { fontSize: 12.5, color: C.faint, textAlign: 'center', marginTop: 12 },
});
