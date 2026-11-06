import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Switch, Text, View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Settings, SettingsScreenProps } from '../types';
import { makeStyles, tokens, useColors } from '../theme';
import { formatNumber } from '../format';
import { PERSONALITIES } from '../personality';
import { DEFAULT_LIMIT_MB, memoryStats } from '../memory';

const CTX_OPTIONS: Settings['nCtx'][] = [512, 1024, 2048];
const THREAD_OPTIONS: Settings['nThreads'][] = [1, 2, 3, 4];
const TOKEN_OPTIONS: number[] = [64, 128, 256, 512];
const TEMP_MIN = 0.1;
const TEMP_MAX = 1.5;
const DEFAULT_VALUES: Pick<Settings, 'nCtx' | 'nThreads' | 'maxTokens' | 'temperature'> = {
  nCtx: 512,
  nThreads: 2,
  maxTokens: 128,
  temperature: 0.7,
};

function roundTemp(v: number): number {
  return Math.round(Math.min(TEMP_MAX, Math.max(TEMP_MIN, v)) * 10) / 10;
}

interface OptionRowProps<T extends number> {
  options: T[];
  value: T;
  onSelect: (v: T) => void;
  labelPrefix: string;
  s: ReturnType<typeof makeStyles>;
}

function OptionRow<T extends number>({ options, value, onSelect, labelPrefix, s }: OptionRowProps<T>) {
  return (
    <View style={local.optionRow} accessibilityRole="radiogroup">
      {options.map((opt) => {
        const selected = opt === value;
        return (
          <Pressable
            key={opt}
            accessibilityRole="radio"
            accessibilityLabel={`${labelPrefix} ${opt}`}
            accessibilityState={{ selected }}
            onPress={() => onSelect(opt)}
            style={({ pressed }) => [
              selected ? s.btnPrimary : s.btnSecondary,
              local.optionBtn,
              pressed && s.btnPressed,
            ]}
          >
            <Text style={[selected ? s.btnPrimaryText : s.btnSecondaryText, { fontFamily: tokens.mono }]}>
              {formatNumber(opt)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen({
  settings,
  onChange,
  onClearHistory,
  memories,
  onClearOldMemories,
}: SettingsScreenProps) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      onChange({ ...settings, ...patch });
    },
    [onChange, settings],
  );

  const isDefault =
    settings.nCtx === DEFAULT_VALUES.nCtx &&
    settings.nThreads === DEFAULT_VALUES.nThreads &&
    settings.maxTokens === DEFAULT_VALUES.maxTokens &&
    settings.temperature === DEFAULT_VALUES.temperature;

  const risky = settings.nCtx === 2048 || settings.nThreads === 4;
  const privacyUrl = (globalThis as { REMIX_PRIVACY_URL?: string }).REMIX_PRIVACY_URL;
  const temp = roundTemp(settings.temperature);
  const stats = memoryStats(memories);
  const oldCount = memories.filter((m) => m.tier === 'old').length;
  const activePersonality = PERSONALITIES.find((p) => p.id === settings.personality) ?? PERSONALITIES[0];

  const confirmClear = () => {
    setConfirmOpen(false);
    onClearHistory();
  };

  return (
    <View style={local.flex}>
      <ScrollView
        style={[local.flex, { backgroundColor: c.bg }]}
        contentContainerStyle={local.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.title} accessibilityRole="header">
          Ajustes
        </Text>

        <View style={s.card}>
          <Text style={s.heading} accessibilityRole="header">
            Personalidad
          </Text>
          <View style={local.personalityList} accessibilityRole="radiogroup">
            {PERSONALITIES.map((p) => {
              const selected = p.id === activePersonality.id;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="radio"
                  accessibilityLabel={`Personalidad ${p.name}`}
                  accessibilityState={{ selected }}
                  onPress={() => update({ personality: p.id })}
                  style={({ pressed }) => [
                    local.personalityItem,
                    { borderColor: selected ? c.accent : c.line },
                    pressed && s.btnPressed,
                  ]}
                >
                  <Feather
                    name={selected ? 'check-circle' : 'circle'}
                    size={20}
                    color={selected ? c.accent : c.inkMuted}
                  />
                  <View style={local.flex}>
                    <Text style={[s.body, local.strong]}>{p.name}</Text>
                    <Text style={s.muted}>{p.description}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={s.muted}>La siguiente respuesta ya usa el tono de {activePersonality.name}.</Text>
        </View>

        <View style={s.card}>
          <View style={local.cardHead}>
            <View style={local.flex}>
              <Text style={[s.body, local.strong]}>Autonomía</Text>
              <Text style={s.muted}>
                Un minuto después de cada mensaje lanza un dado: se aburre y escribe sola, o siente curiosidad y lee una página al azar de Wikipedia.
              </Text>
            </View>
            <Switch
              accessibilityRole="switch"
              accessibilityLabel="Autonomía de la IA"
              value={settings.autonomy}
              onValueChange={(v) => update({ autonomy: v })}
              trackColor={{ false: c.line, true: c.accent }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        <View style={s.card}>
          <View style={local.cardHead}>
            <Text style={[s.body, local.strong]}>Contexto</Text>
            <Text style={s.mono}>{formatNumber(settings.nCtx)} tokens</Text>
          </View>
          <OptionRow
            options={CTX_OPTIONS}
            value={settings.nCtx}
            onSelect={(v) => update({ nCtx: v })}
            labelPrefix="Contexto"
            s={s}
          />
          <Text style={s.muted}>
            Cuánto texto recuerda el modelo. Más contexto gasta más RAM; 512 es lo más seguro con 3 GB.
          </Text>
        </View>

        <View style={s.card}>
          <View style={local.cardHead}>
            <Text style={[s.body, local.strong]}>Hilos de CPU</Text>
            <Text style={s.mono}>{settings.nThreads}</Text>
          </View>
          <OptionRow
            options={THREAD_OPTIONS}
            value={settings.nThreads}
            onSelect={(v) => update({ nThreads: v })}
            labelPrefix="Hilos"
            s={s}
          />
          <Text style={s.muted}>Más hilos responden más rápido pero calientan el móvil y usan más memoria.</Text>
        </View>

        <View style={s.card}>
          <View style={local.cardHead}>
            <Text style={[s.body, local.strong]}>Tokens máximos</Text>
            <Text style={s.mono}>{formatNumber(settings.maxTokens)} por respuesta</Text>
          </View>
          <OptionRow
            options={TOKEN_OPTIONS}
            value={settings.maxTokens}
            onSelect={(v) => update({ maxTokens: v })}
            labelPrefix="Tokens máximos"
            s={s}
          />
          <Text style={s.muted}>Longitud máxima de cada respuesta. Un token es una palabra o un trozo de ella.</Text>
        </View>

        <View style={s.card}>
          <View style={local.cardHead}>
            <Text style={[s.body, local.strong]}>Temperatura</Text>
            <Text style={s.mono}>{formatNumber(temp, 1)}</Text>
          </View>
          <View style={local.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Bajar temperatura"
              disabled={temp <= TEMP_MIN}
              onPress={() => update({ temperature: roundTemp(temp - 0.1) })}
              style={({ pressed }) => [
                s.iconBtn,
                local.stepBtn,
                { borderColor: c.line },
                pressed && s.btnPressed,
                temp <= TEMP_MIN && s.btnDisabled,
              ]}
            >
              <Feather name="minus" size={20} color={c.ink} />
            </Pressable>
            <View style={local.track} accessibilityRole="progressbar" accessibilityLabel={`Temperatura ${formatNumber(temp, 1)}`}>
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${((temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100}%` }]} />
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Subir temperatura"
              disabled={temp >= TEMP_MAX}
              onPress={() => update({ temperature: roundTemp(temp + 0.1) })}
              style={({ pressed }) => [
                s.iconBtn,
                local.stepBtn,
                { borderColor: c.line },
                pressed && s.btnPressed,
                temp >= TEMP_MAX && s.btnDisabled,
              ]}
            >
              <Feather name="plus" size={20} color={c.ink} />
            </Pressable>
          </View>
          <Text style={s.muted}>Baja: respuestas más predecibles. Alta: más variadas y creativas.</Text>
        </View>

        {risky ? (
          <View style={s.warnBox} accessibilityRole="alert">
            <Text style={s.body}>
              Con 3 GB de RAM, {settings.nCtx === 2048 ? 'un contexto de 2048' : '4 hilos'} puede hacer que Android cierre la app.
            </Text>
          </View>
        ) : null}

        <View style={local.noteRow}>
          <Feather name="refresh-cw" size={16} color={c.inkMuted} />
          <Text style={[s.muted, local.flex]}>
            Los cambios se aplican la próxima vez que cargues el modelo y se guardan al cerrar la app.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restaurar valores seguros"
          disabled={isDefault}
          onPress={() => {
            onChange({ ...settings, ...DEFAULT_VALUES });
            showToast('Valores seguros restaurados');
          }}
          style={({ pressed }) => [s.btnSecondary, pressed && s.btnPressed, isDefault && s.btnDisabled]}
        >
          <Feather name="rotate-ccw" size={18} color={c.ink} />
          <Text style={s.btnSecondaryText}>Valores seguros</Text>
        </Pressable>

        <View style={s.card}>
          <Text style={s.heading} accessibilityRole="header">
            Memoria
          </Text>
          <View style={local.cardHead}>
            <Text style={s.body}>Base (default)</Text>
            <Text style={s.mono}>
              {formatNumber(stats.defaultMB, 1)} / {formatNumber(DEFAULT_LIMIT_MB)} MB
            </Text>
          </View>
          <View style={local.cardHead}>
            <Text style={s.body}>Viejas</Text>
            <Text style={s.mono}>{formatNumber(stats.oldMB, 1)} MB</Text>
          </View>
          <Text style={s.muted}>
            Los primeros {formatNumber(DEFAULT_LIMIT_MB)} MB definen su personalidad y nunca se borran. Lo posterior es borrable; si el teléfono se queda sin espacio se liberan 200 MB de las más antiguas.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Borrar memorias viejas"
            disabled={oldCount === 0}
            onPress={() => {
              onClearOldMemories();
              showToast('Memorias viejas borradas');
            }}
            style={({ pressed }) => [
              s.btnSecondary,
              { borderColor: c.danger },
              pressed && s.btnPressed,
              oldCount === 0 && s.btnDisabled,
            ]}
          >
            <Feather name="trash-2" size={18} color={c.danger} />
            <Text style={[s.btnSecondaryText, { color: c.danger }]}>Borrar memorias viejas</Text>
          </Pressable>
        </View>

        <View style={s.card}>
          <Text style={s.heading} accessibilityRole="header">
            Conversación
          </Text>
          <Text style={s.muted}>Tus mensajes se guardan solo en este teléfono.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Borrar historial de chat"
            onPress={() => setConfirmOpen(true)}
            style={({ pressed }) => [s.btnSecondary, { borderColor: c.danger }, pressed && s.btnPressed]}
          >
            <Feather name="trash-2" size={18} color={c.danger} />
            <Text style={[s.btnSecondaryText, { color: c.danger }]}>Borrar historial</Text>
          </Pressable>
        </View>

        <View style={s.card}>
          <Text style={s.heading} accessibilityRole="header">
            Sobre la app
          </Text>
          <View style={s.listRow}>
            <Feather name="cpu" size={20} color={c.accent} />
            <View style={local.flex}>
              <Text style={s.body}>TinyLlama 1.1B Chat</Text>
              <Text style={s.muted}>Modelo GGUF con licencia Apache 2.0</Text>
            </View>
          </View>
          <View style={s.listRow}>
            <Feather name="shield" size={20} color={c.accent} />
            <View style={local.flex}>
              <Text style={s.body}>Privado</Text>
              <Text style={s.muted}>
                El modelo y tus chats se quedan en el dispositivo. Sin cuentas ni servidor propio; internet solo se usa para descargar el modelo y el motor.
              </Text>
            </View>
          </View>
          <View style={s.listRow}>
            <Feather name="info" size={20} color={c.accent} />
            <View style={local.flex}>
              <Text style={s.body}>Versión</Text>
              <Text style={s.mono}>1.0.0</Text>
            </View>
          </View>
          {privacyUrl ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Política de privacidad"
              onPress={() => {
                Linking.openURL(privacyUrl).catch(() => showToast('No se pudo abrir el enlace'));
              }}
              style={({ pressed }) => [s.btnTertiary, local.start, pressed && s.btnPressed]}
            >
              <Text style={s.btnTertiaryText}>Política de privacidad</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={confirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmOpen(false)}
      >
        <View style={local.backdrop}>
          <View style={[s.card, local.dialog]} accessibilityViewIsModal>
            <Text style={s.heading} accessibilityRole="header">
              ¿Borrar historial?
            </Text>
            <Text style={s.muted}>Se eliminarán todos los mensajes de esta conversación. No se puede deshacer.</Text>
            <View style={local.dialogActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancelar"
                onPress={() => setConfirmOpen(false)}
                style={({ pressed }) => [s.btnSecondary, local.flex, pressed && s.btnPressed]}
              >
                <Text style={s.btnSecondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Borrar historial"
                onPress={confirmClear}
                style={({ pressed }) => [s.btnDanger, local.flex, pressed && s.btnPressed]}
              >
                <Text style={s.btnDangerText}>Borrar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {toast ? (
        <View style={s.toast} accessibilityLiveRegion="polite" pointerEvents="none">
          <Text style={s.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const local = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: tokens.space[4],
    gap: tokens.space[5],
    paddingBottom: tokens.space[8],
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.space[2],
  },
  strong: { fontWeight: '500' },
  personalityList: { gap: tokens.space[2] },
  personalityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space[3],
    padding: tokens.space[3],
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 48,
  },
  optionRow: { flexDirection: 'row', gap: tokens.space[2] },
  optionBtn: { flex: 1, paddingHorizontal: tokens.space[2] },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] },
  stepBtn: { borderWidth: 1 },
  track: { flex: 1 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space[2] },
  start: { alignSelf: 'flex-start' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: tokens.space[4],
  },
  dialog: { width: '100%', maxWidth: 400, gap: tokens.space[3] },
  dialogActions: { flexDirection: 'row', gap: tokens.space[2], marginTop: tokens.space[2] },
});
