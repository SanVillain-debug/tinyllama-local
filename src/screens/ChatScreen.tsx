import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Modal,
  Animated,
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ChatMessage, ChatScreenProps } from '../types';
import { makeStyles, tokens, useColors } from '../theme';
import { buildPrompt } from '../prompt';
import { Avatar } from '../components/Avatar';
import { AgentStatusBar } from '../components/AgentStatusBar';

const SUGGESTIONS = [
  'Explícame qué es la memoria RAM',
  'Dame tres ideas para una cena rápida',
  'Resume qué es una IA en dos frases',
];

const layout = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.space[2],
    paddingBottom: tokens.space[3],
  },
  headerText: { flex: 1, gap: tokens.space[1], alignItems: 'flex-start' },
  list: { gap: tokens.space[3], paddingBottom: tokens.space[3], flexGrow: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: tokens.space[2], paddingTop: tokens.space[2] },
  composerInput: { flex: 1, maxHeight: 120, textAlignVertical: 'top', paddingVertical: tokens.space[3] },
  suggestions: { gap: tokens.space[2], alignSelf: 'stretch' },
  centerText: { textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'center', padding: tokens.space[4], backgroundColor: 'rgba(0,0,0,0.5)' },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: tokens.space[2], paddingTop: tokens.space[2] },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[1] },
  notice: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2], paddingTop: tokens.space[2] },
  noticeText: { flex: 1 },
});

function modelChipLabel(id: string): string {
  const m = id.match(/q\d_k(_[sml])?/i);
  return (m ? m[0] : id).toUpperCase();
}

function Cursor({ color }: { color: string }): JSX.Element {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0, duration: tokens.motion.slow + 150, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 1, duration: tokens.motion.slow + 150, useNativeDriver: true }),
          ]),
        );
        loop.start();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);
  return <Animated.Text style={{ opacity, color }}>{'\u258D'}</Animated.Text>;
}

export default function ChatScreen({
  state,
  onSend,
  onStop,
  onNewChat,
  goToModels,
  onRetry,
  agentStatus,
  emotion,
}: ChatScreenProps): JSX.Element {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [draft, setDraft] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { engine, messages, settings } = state;
  const generating = engine.status === 'generating';
  const ready = engine.status === 'ready';
  const usable = ready || generating;
  const locked = agentStatus === 'searching' || agentStatus === 'reading' || agentStatus === 'learning';
  const canSend = ready && !locked && draft.trim().length > 0;

  /* Did the context overflow? Count user turns that reach the prompt vs. those on screen. */
  const trimmed = useMemo(() => {
    const userMsgs = messages.filter((m) => m.role === 'user' && m.text.trim().length > 0).length;
    if (userMsgs < 2) return false;
    const prompt = buildPrompt(messages, settings.nCtx, settings.maxTokens);
    const inPrompt = prompt.split('<|user|>').length - 1;
    return inPrompt < userMsgs;
  }, [messages, settings.nCtx, settings.maxTokens]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || !ready || locked) return;
    onSend(t);
    setDraft('');
  };

  /* ---------- Not usable: designed empty / loading / error state ---------- */
  if (!usable) {
    const loading = engine.status === 'loading';
    const failed = engine.status === 'error';
    return (
      <View style={s.screen}>
        <View style={layout.header}>
          <Text style={s.title} accessibilityRole="header">Chat</Text>
        </View>
        <View style={[s.empty, layout.flex]}>
          <View style={s.emptyCircle}>
            {loading ? (
              <ActivityIndicator color={c.accent} />
            ) : (
              <Feather name={failed ? 'alert-triangle' : 'cpu'} size={32} color={failed ? c.danger : c.accent} />
            )}
          </View>
          <Text style={[s.heading, layout.centerText]}>
            {loading ? 'Cargando el modelo…' : failed ? 'El motor no pudo arrancar' : 'Aún no hay modelo cargado'}
          </Text>
          <Text style={[s.muted, layout.centerText]}>
            {loading
              ? 'Puede tardar un minuto con 3 GB de RAM. No cierres la app.'
              : failed
                ? engine.error ?? 'Ocurrió un error al preparar el modelo. Pulsa Cargar en Modelos para reintentarlo.'
                : 'Descarga una versión de TinyLlama y cárgala para chatear sin conexión.'}
          </Text>
          {!loading && (
            <Pressable
              onPress={failed ? onRetry : goToModels}
              accessibilityRole="button"
              accessibilityLabel={failed ? 'Reintentar' : 'Ir a Modelos'}
              style={({ pressed }) => [s.btnPrimary, pressed && s.btnPrimaryPressed]}
            >
              <Feather name={failed ? 'refresh-cw' : 'layers'} size={20} color={c.accentInk} />
              <Text style={s.btnPrimaryText} numberOfLines={1}>{failed ? 'Reintentar' : 'Ir a Modelos'}</Text>
            </Pressable>
          )}
          {messages.length > 0 && !loading && (
            <Text style={[s.muted, layout.centerText]}>
              Tu conversación sigue guardada y volverá al cargar el modelo.
            </Text>
          )}
        </View>
      </View>
    );
  }

  /* ---------- Chat ---------- */
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : '';

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const mine = item.role === 'user';
    const streaming = generating && !mine && item.id === lastId;
    return (
      <View style={mine ? s.bubbleUser : s.bubbleBot}>
        <Text selectable style={mine ? s.bubbleUserText : s.bubbleBotText}>
          {item.text}
          {streaming ? <Cursor color={c.accent} /> : null}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={layout.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.screen}>
        <View style={layout.header}>
          <Avatar emotion={emotion} speaking={generating || agentStatus === 'talking'} size={72} />
          <View style={layout.headerText}>
            <AgentStatusBar status={agentStatus} emotion={emotion} />
            <View style={s.chip} accessible accessibilityLabel={`Modelo cargado ${engine.modelId ?? ''}`}>
              <View style={layout.chipRow}>
                <Feather name="cpu" size={14} color={c.accent} />
                <Text style={[s.chipText, { fontFamily: tokens.mono }]}>
                  {engine.modelId ? modelChipLabel(engine.modelId) : 'Modelo'}
                </Text>
              </View>
            </View>
          </View>
          <Pressable
            onPress={() => setConfirmOpen(true)}
            disabled={messages.length === 0 || generating}
            accessibilityRole="button"
            accessibilityLabel="Nueva conversación"
            style={({ pressed }) => [
              s.iconBtn,
              pressed && s.btnPressed,
              (messages.length === 0 || generating) && s.btnDisabled,
            ]}
          >
            <Feather name="edit" size={22} color={c.ink} />
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          extraData={`${engine.status}-${lastId}-${messages.length}`}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={layout.list}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={[s.empty, layout.flex]}>
              <View style={s.emptyCircle}>
                <Feather name="message-circle" size={32} color={c.accent} />
              </View>
              <Text style={[s.heading, layout.centerText]}>Modelo listo</Text>
              <Text style={[s.muted, layout.centerText]}>
                Todo se procesa en tu teléfono. Escribe algo o prueba una idea:
              </Text>
              <View style={layout.suggestions}>
                {SUGGESTIONS.map((q) => (
                  <Pressable
                    key={q}
                    onPress={() => send(q)}
                    accessibilityRole="button"
                    accessibilityLabel={`Preguntar: ${q}`}
                    style={({ pressed }) => [s.btnSecondary, pressed && s.btnPressed]}
                  >
                    <Text style={s.btnSecondaryText}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
        />

        {trimmed && (
          <View style={layout.notice}>
            <Feather name="scissors" size={14} color={c.warning} />
            <Text style={[s.muted, layout.noticeText]}>
              Contexto lleno: los mensajes más antiguos ya no entran en la respuesta.
            </Text>
          </View>
        )}

        {locked && (
          <View style={layout.notice} accessibilityLiveRegion="polite">
            <Feather name="search" size={14} color={c.accent} />
            <Text style={[s.muted, layout.noticeText]}>
              Está investigando en internet. No puedes escribir hasta que termine.
            </Text>
          </View>
        )}

        <View style={layout.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={locked ? 'Buscando en internet…' : generating ? 'Generando respuesta…' : 'Escribe un mensaje'}
            editable={!locked}
            placeholderTextColor={c.inkMuted}
            multiline
            maxLength={2000}
            accessibilityLabel="Mensaje"
            style={[s.input, layout.composerInput]}
          />
          {generating ? (
            <Pressable
              onPress={onStop}
              accessibilityRole="button"
              accessibilityLabel="Detener"
              style={({ pressed }) => [s.iconBtn, { backgroundColor: c.danger }, pressed && s.btnPressed]}
            >
              <Feather name="square" size={20} color="#FFFFFF" />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => send(draft)}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Enviar"
              accessibilityState={{ disabled: !canSend }}
              style={({ pressed }) => [
                s.iconBtn,
                { backgroundColor: c.accentStrong },
                pressed && s.btnPressed,
                !canSend && s.btnDisabled,
              ]}
            >
              <Feather name="send" size={20} color={c.accentInk} />
            </Pressable>
          )}
        </View>

        <Modal
          visible={confirmOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setConfirmOpen(false)}
        >
          <View style={layout.overlay}>
            <View style={s.card} accessibilityViewIsModal>
              <Text style={s.heading}>¿Empezar de nuevo?</Text>
              <Text style={s.muted}>Se borrará esta conversación del teléfono. No se puede deshacer.</Text>
              <View style={layout.dialogActions}>
                <Pressable
                  onPress={() => setConfirmOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  style={({ pressed }) => [s.btnSecondary, pressed && s.btnPressed]}
                >
                  <Text style={s.btnSecondaryText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setConfirmOpen(false);
                    onNewChat();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Vaciar conversación"
                  style={({ pressed }) => [s.btnDanger, pressed && s.btnPressed]}
                >
                  <Text style={s.btnDangerText} numberOfLines={1}>Vaciar chat</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}
