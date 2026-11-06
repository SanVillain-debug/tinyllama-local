import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { DownloadHandle, DownloadState, InstalledModel, ModelOption, ModelsScreenProps } from '../types';
import { makeStyles, tokens, useColors } from '../theme';
import { fitFor, SAFETY_MARGIN_MB } from '../models';
import { deleteModelFile, getFreeMB, modelPath, startDownload } from '../downloader';
import { formatNumber } from '../format';

/* ---------- Download registry (module level: a download survives switching tabs) ---------- */
interface Job { handle?: DownloadHandle; state: DownloadState; cancelled: boolean }
const jobs = new Map<string, Job>();
const failures = new Map<string, DownloadState>();
const listeners = new Set<() => void>();
let latestOnInstalled: ((m: InstalledModel) => void) | null = null;
let latestAfterChange: (() => void) | null = null;
function emit() { listeners.forEach((l) => l()); }

const KEEP_AWAKE_TAG = 'tinyllama-download';
const RECOMMENDED_BADGE = 'Recomendado para 3 GB';

function beginDownload(m: ModelOption) {
  if (jobs.has(m.id)) return;
  failures.delete(m.id);
  const job: Job = { state: { modelId: m.id, status: 'downloading', progress: 0, receivedMB: 0 }, cancelled: false };
  jobs.set(m.id, job);
  emit();
  let handle: DownloadHandle;
  try {
    handle = startDownload(m, (p) => {
      if (job.cancelled) return;
      job.state = p;
      emit();
    });
  } catch (e) {
    jobs.delete(m.id);
    failures.set(m.id, { modelId: m.id, status: 'error', progress: 0, receivedMB: 0, error: e instanceof Error ? e.message : 'No se pudo iniciar la descarga.' });
    emit();
    return;
  }
  job.handle = handle;
  handle.done
    .then((inst) => {
      jobs.delete(m.id);
      if (inst) {
        failures.delete(m.id);
        latestOnInstalled?.(inst);
      } else if (!job.cancelled) {
        const s = job.state;
        failures.set(m.id, s.status === 'error' && s.error ? s : { modelId: m.id, status: 'error', progress: s.progress, receivedMB: s.receivedMB, error: 'La descarga no se completó. Revisa tu conexión e inténtalo de nuevo.' });
      }
      emit();
      latestAfterChange?.();
    })
    .catch((e: unknown) => {
      jobs.delete(m.id);
      if (!job.cancelled) {
        failures.set(m.id, { modelId: m.id, status: 'error', progress: job.state.progress, receivedMB: job.state.receivedMB, error: e instanceof Error && e.message ? e.message : 'Se cortó la descarga. Revisa tu conexión.' });
      }
      emit();
      latestAfterChange?.();
    });
}

async function abortDownload(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  job.cancelled = true;
  try { await job.handle?.cancel(); } catch { /* ignore */ }
  jobs.delete(id);
  failures.delete(id);
  emit();
  latestAfterChange?.();
}

const SYSTEM_RAM_MB = 1800;
const TOTAL_RAM_MB = 3072;

function ProgressBar({ value, label }: { value: number; label: string }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const anim = useRef(new Animated.Value(value)).current;
  const reduce = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((r) => { reduce.current = r; }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const v = Math.max(0, Math.min(1, value));
    if (reduce.current) { anim.setValue(v); return; }
    Animated.timing(anim, { toValue: v, duration: tokens.motion.base, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [value, anim]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={s.progressTrack} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
      <Animated.View style={[s.progressFill, { width }]} />
    </View>
  );
}

type BtnKind = 'primary' | 'secondary' | 'tertiary' | 'danger';
function Btn({ kind, label, icon, onPress, disabled, flex }: { kind: BtnKind; label: string; icon?: React.ComponentProps<typeof Feather>['name']; onPress: () => void; disabled?: boolean; flex?: boolean }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const base = kind === 'primary' ? s.btnPrimary : kind === 'secondary' ? s.btnSecondary : kind === 'danger' ? s.btnDanger : s.btnTertiary;
  const textStyle = kind === 'primary' ? s.btnPrimaryText : kind === 'secondary' ? s.btnSecondaryText : kind === 'danger' ? s.btnDangerText : s.btnTertiaryText;
  const iconColor = kind === 'primary' ? c.accentInk : kind === 'secondary' ? c.ink : kind === 'danger' ? '#FFFFFF' : c.accentStrong;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [base, flex && { flex: 1 }, pressed && !disabled && (kind === 'primary' ? s.btnPrimaryPressed : s.btnPressed), pressed && !disabled && { transform: [{ scale: 0.97 }] }, disabled && s.btnDisabled]}
    >
      {icon ? <Feather name={icon} size={20} color={iconColor} /> : null}
      <Text style={textStyle} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/* ---------- Screen ---------- */
export default function ModelsScreen({ state, models, onInstalled, onDelete, onLoad, engineProgress }: ModelsScreenProps) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const fmt = formatNumber;
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [freeMB, setFreeMB] = useState<number | null>(null);
  const [freeFailed, setFreeFailed] = useState(false);
  const [reading, setReading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const mounted = useRef(true);

  const refreshFree = useCallback(async () => {
    try {
      const v = await getFreeMB();
      if (!mounted.current) return;
      setFreeMB(v);
      setFreeFailed(v === null);
    } catch {
      if (!mounted.current) return;
      setFreeMB(null);
      setFreeFailed(true);
    } finally {
      if (mounted.current) setReading(false);
    }
  }, []);

  latestOnInstalled = (m) => {
    onInstalled(m);
  };
  latestAfterChange = () => { if (mounted.current) refreshFree(); };

  useEffect(() => {
    mounted.current = true;
    listeners.add(force);
    refreshFree();
    return () => {
      mounted.current = false;
      listeners.delete(force);
    };
  }, [refreshFree]);

  useEffect(() => { refreshFree(); }, [state.installed.length, refreshFree]);

  const anyDownloading = jobs.size > 0;

  /* Screen stays on while a model downloads. */
  useEffect(() => {
    if (!anyDownloading) return;
    try {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    } catch {
      /* not available here */
    }
    return () => {
      try {
        deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      } catch {
        /* not available here */
      }
    };
  }, [anyDownloading]);

  const loadedModel = (state.engine.status === 'ready' || state.engine.status === 'generating') && state.engine.modelId
    ? models.find((m) => m.id === state.engine.modelId) : undefined;
  const modelRam = loadedModel ? loadedModel.ramMB : 0;
  const freeRam = Math.max(0, TOTAL_RAM_MB - SYSTEM_RAM_MB - modelRam);

  const confirmModel = confirmId ? models.find((m) => m.id === confirmId) : undefined;

  const retryFree = () => {
    setReading(true);
    refreshFree();
  };

  const doDelete = async () => {
    if (!confirmId || deleting) return;
    const id = confirmId;
    const inst = state.installed.find((i) => i.id === id);
    const m = models.find((x) => x.id === id);
    setDeleting(true);
    try {
      await deleteModelFile(inst ? inst.localPath : m ? modelPath(m) : '');
    } catch { /* file may already be gone */ }
    onDelete(id);
    setDeleting(false);
    setConfirmId(null);
    refreshFree();
  };

  const discardFailure = async (m: ModelOption) => {
    try { await deleteModelFile(modelPath(m)); } catch { /* ignore */ }
    failures.delete(m.id);
    force();
    refreshFree();
  };

  const renderCard = (m: ModelOption) => {
    const inst = state.installed.find((i) => i.id === m.id);
    const job = jobs.get(m.id);
    const failure = failures.get(m.id);
    const isLoaded = !!loadedModel && loadedModel.id === m.id;
    const isLoading = state.engine.status === 'loading' && state.engine.modelId === m.id;
    const fit = freeMB != null ? fitFor(m, freeMB) : { ok: true, missingMB: 0 };
    const damaged = !!inst && Math.abs(inst.sizeMB - m.sizeMB) / m.sizeMB > 0.15;
    const heavyRam = m.ramMB > 1200;
    const recommended = m.badge === RECOMMENDED_BADGE;

    return (
      <View key={m.id} style={s.card} accessibilityLabel={`${m.label}, ${fmt(m.sizeMB)} MB`}>
        <View style={st.rowTop}>
          <View style={st.titleWrap}>
            <Text style={s.heading}>{m.label}</Text>
            {m.badge ? (
              <View style={[s.chip, st.chipRow]}>
                <Feather name="star" size={16} color={c.accentStrong} />
                <Text style={s.chipText}>{m.badge}</Text>
              </View>
            ) : null}
          </View>
          {isLoaded ? (
            <View style={[s.chip, st.chipRow]}>
              <Feather name="check-circle" size={16} color={c.success} />
              <Text style={s.chipText}>Cargado</Text>
            </View>
          ) : inst ? (
            <View style={[s.chip, st.chipRow]}>
              <Feather name="check" size={16} color={c.accentStrong} />
              <Text style={s.chipText}>{damaged ? 'Dañado' : 'Instalado'}</Text>
            </View>
          ) : null}
        </View>

        <View style={st.facts}>
          <Text style={s.mono}>{fmt(m.sizeMB)} MB</Text>
          <Text style={[s.mono, heavyRam && { color: c.warning }]}>RAM ~{fmt(m.ramMB)} MB</Text>
          <Text style={s.muted}>Calidad {m.quality}</Text>
        </View>
        {m.note ? <Text style={s.muted}>{m.note}</Text> : null}

        {/* State area */}
        {job ? (
          <View style={st.block}>
            <ProgressBar value={job.state.progress} label={`Descargando ${m.label}`} />
            <View style={st.rowBetween}>
              <Text style={s.mono}>{fmt(Math.round(job.state.progress * 100))} %</Text>
              <Text style={s.mono}>{fmt(job.state.receivedMB)} / {fmt(m.sizeMB)} MB</Text>
            </View>
            <Btn kind="secondary" label="Cancelar" icon="x" onPress={() => abortDownload(m.id)} />
          </View>
        ) : isLoading ? (
          <View style={st.block}>
            <ProgressBar value={engineProgress ?? 0} label="Cargando el modelo en el motor" />
            <Text style={s.muted}>Cargando en el motor{engineProgress != null ? ` · ${fmt(Math.round(engineProgress * 100))} %` : '…'}</Text>
          </View>
        ) : inst ? (
          <View style={st.block}>
            {damaged ? (
              <View style={st.inline}>
                <Feather name="alert-triangle" size={20} color={c.danger} />
                <Text style={[s.muted, st.grow, { color: c.danger }]}>
                  El archivo pesa {fmt(inst.sizeMB)} MB y se esperaban {fmt(m.sizeMB)} MB. Bórralo y vuelve a descargarlo.
                </Text>
              </View>
            ) : null}
            <View style={st.btnRow}>
              {!damaged && !isLoaded ? <Btn kind="primary" label="Cargar" icon="play" flex onPress={() => onLoad(m.id)} disabled={state.engine.status === 'loading' || state.engine.status === 'generating'} /> : null}
              {!damaged && isLoaded ? <Btn kind="secondary" label="Recargar" icon="refresh-cw" flex onPress={() => onLoad(m.id)} disabled={state.engine.status === 'generating'} /> : null}
              <Btn kind={damaged ? 'danger' : 'secondary'} label="Borrar" icon="trash-2" flex onPress={() => setConfirmId(m.id)} />
            </View>
          </View>
        ) : failure ? (
          <View style={st.block}>
            <View style={st.inline}>
              <Feather name="alert-circle" size={20} color={c.danger} />
              <Text style={[s.muted, st.grow, { color: c.danger }]}>{failure.error ?? 'Se cortó la descarga.'}</Text>
            </View>
            <View style={st.btnRow}>
              <Btn kind="primary" label="Reintentar" icon="refresh-cw" flex onPress={() => beginDownload(m)} disabled={!fit.ok || anyDownloading} />
              <Btn kind="secondary" label="Descartar" flex onPress={() => discardFailure(m)} />
            </View>
          </View>
        ) : (
          <View style={st.block}>
            {!fit.ok ? (
              <View style={st.inline}>
                <Feather name="lock" size={20} color={c.warning} />
                <Text style={[s.muted, st.grow]}>
                  Sin espacio: faltan {fmt(fit.missingMB)} MB (incluye {fmt(SAFETY_MARGIN_MB)} MB de margen). Libera espacio para descargarlo.
                </Text>
              </View>
            ) : anyDownloading ? (
              <Text style={s.muted}>Espera a que termine la otra descarga.</Text>
            ) : freeMB == null ? (
              <Text style={s.muted}>
                Necesita unos {fmt(m.sizeMB + SAFETY_MARGIN_MB)} MB libres ({fmt(m.sizeMB)} MB más {fmt(SAFETY_MARGIN_MB)} MB de margen).
              </Text>
            ) : null}
            <Btn kind={recommended ? 'primary' : 'secondary'} label="Descargar" icon="download" onPress={() => beginDownload(m)} disabled={!fit.ok || anyDownloading} />
          </View>
        )}
      </View>
    );
  };

  const storageUnknown = !reading && (freeFailed || freeMB == null);

  return (
    <View style={[st.root, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
        <Text style={s.title} accessibilityRole="header">Modelos</Text>

        {/* Memory card: RAM warning, memory strip and free storage */}
        <View style={s.card}>
          <View style={st.warnRow}>
            <Feather name="alert-triangle" size={20} color={c.warning} />
            <Text style={[s.body, st.grow]}>3 GB de RAM está en el límite · usa Q3_K_S y contexto 512</Text>
            <Btn kind="tertiary" label="Más info" onPress={() => setInfoOpen(true)} />
          </View>
          <View style={[st.divider, { backgroundColor: c.line }]} />
          <View style={st.rowBetween}>
            <Text style={s.body}>Memoria del teléfono</Text>
            <Text style={s.mono}>{fmt(TOTAL_RAM_MB)} MB</Text>
          </View>
          <View
            style={[st.strip, { borderColor: c.line, backgroundColor: c.bg }]}
            accessible
            accessibilityLabel={`Franja de memoria: sistema ${fmt(SYSTEM_RAM_MB)} MB, modelo ${fmt(modelRam)} MB, libre ${fmt(freeRam)} MB`}
          >
            <View style={{ flex: SYSTEM_RAM_MB, backgroundColor: c.inkMuted, opacity: 0.45 }} />
            {modelRam > 0 ? <View style={{ flex: modelRam, backgroundColor: c.accent }} /> : null}
            <View style={{ flex: freeRam }} />
          </View>
          <View style={st.legend}>
            <View style={st.legendItem}>
              <View style={[st.dot, { backgroundColor: c.inkMuted, opacity: 0.45 }]} />
              <Text style={s.muted}>Sistema ~{fmt(SYSTEM_RAM_MB)} MB</Text>
            </View>
            <View style={st.legendItem}>
              <View style={[st.dot, { backgroundColor: c.accent }]} />
              <Text style={s.muted}>{loadedModel ? `${loadedModel.label} ~${fmt(modelRam)} MB` : 'Ningún modelo cargado'}</Text>
            </View>
            <View style={st.legendItem}>
              <View style={[st.dot, { borderWidth: 1, borderColor: c.inkMuted }]} />
              <Text style={s.muted}>Libre ~{fmt(freeRam)} MB</Text>
            </View>
          </View>
          <View style={[st.divider, { backgroundColor: c.line }]} />
          <View style={s.listRow}>
            <Feather name="hard-drive" size={20} color={c.inkMuted} />
            <View style={st.grow}>
              <Text style={s.muted}>Espacio libre en el teléfono</Text>
              {reading ? (
                <View style={[st.skelLine, { backgroundColor: c.line }]} />
              ) : storageUnknown || freeMB == null ? (
                <Text style={s.body}>No se pudo leer el espacio</Text>
              ) : (
                <Text style={s.mono}>{fmt(freeMB)} MB</Text>
              )}
            </View>
            {storageUnknown ? (
              <Btn kind="tertiary" label="Reintentar" onPress={retryFree} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Actualizar espacio libre"
                onPress={retryFree}
                style={({ pressed }) => [s.iconBtn, pressed && s.btnPressed]}
              >
                <Feather name="refresh-cw" size={20} color={c.accentStrong} />
              </Pressable>
            )}
          </View>
          <Text style={s.muted}>Cada descarga necesita su tamaño más {fmt(SAFETY_MARGIN_MB)} MB de margen.</Text>
        </View>

        {/* Model list */}
        {reading && freeMB == null && !freeFailed ? (
          <View style={st.skelList} accessibilityLabel="Leyendo el almacenamiento">
            {[0, 1, 2].map((i) => <View key={i} style={[s.skeleton, { height: 148 }]} />)}
          </View>
        ) : models.length === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyCircle}><Feather name="cpu" size={32} color={c.accent} /></View>
            <Text style={s.heading}>Sin modelos disponibles</Text>
            <Text style={s.muted}>No se pudo leer el catálogo de TinyLlama.</Text>
          </View>
        ) : (
          <View style={st.list}>{models.map(renderCard)}</View>
        )}
      </ScrollView>

      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <View style={st.scrim}>
          <View style={[st.sheet, { backgroundColor: c.surface, borderColor: c.line }]} accessibilityViewIsModal>
            <Text style={s.heading} accessibilityRole="header">Memoria al límite</Text>
            <Text style={s.body}>
              Android y tus apps ya usan buena parte de los 3 GB de RAM. Empieza por Q3_K_S, cierra otras apps antes de cargar el modelo y mantén el contexto en 512.
            </Text>
            <Text style={s.muted}>
              Si el sistema cierra la app por falta de memoria, el modelo seguirá instalado: solo tendrás que volver a cargarlo.
            </Text>
            <Btn kind="primary" label="Entendido" onPress={() => setInfoOpen(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={!!confirmId} transparent animationType="fade" onRequestClose={() => !deleting && setConfirmId(null)}>
        <View style={st.scrim}>
          <View style={[st.sheet, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Text style={s.heading} accessibilityRole="header">Borrar modelo</Text>
            <Text style={s.body}>
              {confirmModel ? `${confirmModel.label} se eliminará del teléfono` : 'El modelo se eliminará del teléfono'}
              {confirmModel ? ` y recuperarás unos ${fmt(confirmModel.sizeMB)} MB. ` : '. '}
              Podrás descargarlo de nuevo cuando quieras.
            </Text>
            <View style={st.btnRow}>
              <Btn kind="secondary" label="Cancelar" flex onPress={() => setConfirmId(null)} disabled={deleting} />
              <Btn kind="danger" label={deleting ? 'Borrando…' : 'Borrar'} flex onPress={doDelete} disabled={deleting} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: tokens.space[4], gap: tokens.space[4], paddingBottom: tokens.space[8] },
  list: { gap: tokens.space[3] },
  skelList: { gap: tokens.space[3] },
  grow: { flex: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space[3] },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: tokens.space[3] },
  titleWrap: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: tokens.space[2] },
  inline: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space[2] },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[1] },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: tokens.space[4], rowGap: tokens.space[1] },
  block: { gap: tokens.space[2], marginTop: tokens.space[1] },
  btnRow: { flexDirection: 'row', gap: tokens.space[2] },
  strip: { flexDirection: 'row', height: 16, borderRadius: tokens.radius.pill, overflow: 'hidden', borderWidth: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: tokens.space[4], rowGap: tokens.space[1] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] },
  dot: { width: 12, height: 12, borderRadius: 6 },
  divider: { height: 1 },
  skelLine: { height: 16, width: 96, borderRadius: 4, marginTop: tokens.space[1] },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', padding: tokens.space[4] },
  sheet: { borderRadius: tokens.radius.card, borderWidth: 1, padding: tokens.space[5], gap: tokens.space[3] },
});
