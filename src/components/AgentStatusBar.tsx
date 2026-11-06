import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AgentStatus, Emotion } from '../types';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Lista',
  thinking: 'Pensando',
  talking: 'Escribiendo',
  bored: 'Aburrida',
  searching: 'Buscando en internet',
  reading: 'Leyendo',
  learning: 'Aprendiendo',
};

const STATUS_ICON: Record<AgentStatus, FeatherName> = {
  idle: 'check-circle',
  thinking: 'cpu',
  talking: 'message-circle',
  bored: 'moon',
  searching: 'search',
  reading: 'book-open',
  learning: 'zap',
};

const EMOTION_LABEL: Record<Emotion, string> = {
  neutral: 'Neutral',
  happy: 'Alegría',
  sad: 'Tristeza',
  angry: 'Enojo',
  afraid: 'Miedo',
  surprised: 'Sorpresa',
  disgusted: 'Asco',
};

const EMOTION_ICON: Record<Emotion, FeatherName> = {
  neutral: 'minus-circle',
  happy: 'smile',
  sad: 'frown',
  angry: 'alert-triangle',
  afraid: 'alert-circle',
  surprised: 'star',
  disgusted: 'thumbs-down',
};

const PALETTE = {
  dark: {
    pillBg: '#3B2470',
    pillBorder: '#8E5BD6',
    pillInk: '#F1E6FF',
    chipBg: '#2A1A4D',
    chipBorder: '#5B3A9A',
    chipInk: '#CDB4F5',
    dot: '#FF6AB5',
  },
  light: {
    pillBg: '#F3E4FF',
    pillBorder: '#B58AE8',
    pillInk: '#3B1F6B',
    chipBg: '#FFFFFF',
    chipBorder: '#D8C2F5',
    chipInk: '#5A3A92',
    dot: '#D6317F',
  },
};

export function AgentStatusBar(props: { status: AgentStatus; emotion: Emotion }): JSX.Element {
  const { status, emotion } = props;
  const scheme = useColorScheme();
  const c = scheme === 'light' ? PALETTE.light : PALETTE.dark;
  const [reduceMotion, setReduceMotion] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduceMotion(v);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const active = status !== 'idle';

  useEffect(() => {
    pulse.setValue(1);
    if (!active || reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, pulse]);

  const statusText = STATUS_LABEL[status];
  const emotionText = EMOTION_LABEL[emotion];

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Estado: ${statusText}. Emoción: ${emotionText}`}
    >
      <View style={[styles.pill, { backgroundColor: c.pillBg, borderColor: c.pillBorder }]}>
        <Animated.View style={[styles.dot, { backgroundColor: c.dot, opacity: pulse }]} />
        <Feather name={STATUS_ICON[status]} size={16} color={c.pillInk} />
        <Text style={[styles.pillText, { color: c.pillInk }]}>{statusText}</Text>
      </View>
      <View style={[styles.chip, { backgroundColor: c.chipBg, borderColor: c.chipBorder }]}>
        <Feather name={EMOTION_ICON[emotion]} size={16} color={c.chipInk} />
        <Text style={[styles.chipText, { color: c.chipInk }]}>{emotionText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    flexShrink: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
});
