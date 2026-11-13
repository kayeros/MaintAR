// Экран входа и регистрации сотрудника. Стили: Tailwind (NativeWind).
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DEMO, ROLES, login, register, validateRegistration } from './auth';
import { colors as C } from './theme';

const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 50;
const ERR = 'text-[13.5px] text-defect';

export function Splash() {
  return (
    <View className="flex-1 items-center justify-center bg-primary">
      <StatusBar barStyle="light-content" backgroundColor={C.primary} />
      <Text className="text-white text-[34px] font-extrabold tracking-[0.5px]">MaintAR</Text>
      <ActivityIndicator color="#fff" style={{ marginTop: 16 }} />
    </View>
  );
}

function Field({ label, icon, error, secure, inputRef, ...props }) {
  const [hidden, setHidden] = useState(true);
  return (
    <View className="gap-1.5">
      <Text className="text-[14px] font-semibold text-muted">{label}</Text>
      <View className={`flex-row items-center gap-2.5 border rounded-xl px-3 min-h-[50px] bg-surface ${error ? 'border-defect' : 'border-line'}`}>
        <Ionicons name={icon} size={20} color={C.faint} />
        <TextInput ref={inputRef} className="flex-1 text-[16px] text-fg py-2.5" placeholderTextColor={C.faint}
          autoCapitalize="none" autoCorrect={false} secureTextEntry={secure && hidden} {...props} />
        {secure && (
          <Pressable onPress={() => setHidden(!hidden)} hitSlop={10} accessibilityLabel={hidden ? 'Показать пароль' : 'Скрыть пароль'}>
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={22} color={C.muted} />
          </Pressable>
        )}
      </View>
      {!!error && <Text className={ERR}>{error}</Text>}
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
    <View className="flex-1 bg-bg">
      <StatusBar barStyle="light-content" backgroundColor={C.primary} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerClassName="grow pb-8" keyboardShouldPersistTaps="handled">
          <View className="bg-primary items-center pb-14 px-4 gap-1.5" style={{ paddingTop: TOP + 28 }}>
            <View className="w-16 h-16 rounded-[18px] bg-white/15 items-center justify-center mb-1.5">
              <Ionicons name="scan-outline" size={34} color="#fff" />
            </View>
            <Text className="text-white text-[32px] font-extrabold tracking-[0.5px]">MaintAR</Text>
            <Text className="text-white/80 text-[15px]">AR-помощник инженера</Text>
          </View>

          <View className="px-4 -mt-9 items-center">
            <View className="bg-surface rounded-2xl p-[18px] gap-3.5 border border-divider w-full max-w-[480px]">
              <Text className="text-[21px] font-bold text-fg">{isReg ? 'Регистрация сотрудника' : 'Вход'}</Text>
              {isReg && (
                <>
                  <Field label="Фамилия и имя" icon="person-outline" value={f.name} onChangeText={set('name')} error={errs.name}
                    placeholder="Иванов Иван" autoCapitalize="words" autoCorrect={false} />
                  <View className="gap-1.5">
                    <Text className="text-[14px] font-semibold text-muted">Должность</Text>
                    <View className="gap-2">
                      {ROLES.map((r) => {
                        const on = f.role === r;
                        return (
                          <Pressable key={r} onPress={() => set('role')(r)}
                            className={`flex-row items-center gap-2.5 border rounded-xl px-3 min-h-[48px] ${on ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                            <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? C.primary : C.faint} />
                            <Text className={`text-[15px] ${on ? 'text-primary font-semibold' : 'text-fg'}`}>{r}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {!!errs.role && <Text className={ERR}>{errs.role}</Text>}
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
              {!!common && <View className="bg-defect-bg rounded-[10px] p-2.5"><Text className="text-[15px] text-defect">{common}</Text></View>}

              <Pressable onPress={submit} disabled={busy}
                className={`bg-primary rounded-xl min-h-[54px] items-center justify-center mt-1 active:opacity-80 ${busy ? 'opacity-80' : ''}`}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white text-[17px] font-bold">{isReg ? 'Зарегистрироваться' : 'Войти'}</Text>}
              </Pressable>

              <Pressable onPress={() => switchMode(isReg ? 'login' : 'register')} hitSlop={8} className="self-center py-1.5">
                <Text className="text-[15px] text-muted text-center">
                  {isReg ? 'Уже есть учётная запись? ' : 'Нет учётной записи? '}
                  <Text className="text-primary font-bold">{isReg ? 'Войти' : 'Зарегистрироваться'}</Text>
                </Text>
              </Pressable>
            </View>
          </View>

          {!isReg && (
            <Pressable onPress={() => setF({ ...f, login: DEMO.login, password: DEMO.password })} className="flex-row gap-2 items-start mx-5 mt-4">
              <Ionicons name="information-circle-outline" size={18} color={C.muted} />
              <Text className="flex-1 text-[13.5px] text-muted leading-[19px]">
                Демо-доступ: логин {DEMO.login}, пароль {DEMO.password}. Нажмите, чтобы подставить.
              </Text>
            </Pressable>
          )}
          <Text className="text-[12.5px] text-faint text-center mt-3">Учётные записи хранятся на этом устройстве</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
