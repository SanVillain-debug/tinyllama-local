import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import type { Emotion } from '../types';

// Art palette taken from the reference illustration (own module, same hand for every part of the avatar).
const ART = {
  bgTop: '#2A1B4A',
  bgBottom: '#5A2352',
  star: '#E9DDFB',
  hair: '#3E2F7C',
  hairDark: '#2C2160',
  hairLight: '#6A55B8',
  streakPink: '#F0509A',
  streakViolet: '#7B3FB0',
  streakLilac: '#A98BE3',
  skin: '#FCE6D8',
  skinShade: '#F3CDBE',
  blush: '#F58AB0',
  outline: '#1E1240',
  iris: '#8E76D6',
  irisDark: '#5B44A8',
  pupil: '#2B1850',
  white: '#FFFFFF',
  sweater: '#5E3A86',
  sweaterDark: '#472A69',
  mouth: '#7A2D5E',
  ring: '#7B5CC4',
};

interface Face {
  browTilt: number; // + inner end lower (angry), - inner end higher (sad)
  browY: number; // negative = raised
  eyeOpen: number;
  curve: number; // + smile, - frown
  mouthOpen: number;
  blush: number;
}

const FACES: Record<Emotion, Face> = {
  neutral: { browTilt: 0, browY: 0, eyeOpen: 1, curve: 0, mouthOpen: 0, blush: 0.3 },
  happy: { browTilt: 0, browY: -3, eyeOpen: 0.85, curve: 1, mouthOpen: 0.2, blush: 0.85 },
  sad: { browTilt: -1, browY: 0, eyeOpen: 0.9, curve: -1, mouthOpen: 0, blush: 0.1 },
  angry: { browTilt: 1, browY: 2, eyeOpen: 0.75, curve: -0.6, mouthOpen: 0.1, blush: 0.2 },
  afraid: { browTilt: -0.7, browY: -4, eyeOpen: 1.2, curve: -0.5, mouthOpen: 0.5, blush: 0 },
  surprised: { browTilt: 0, browY: -6, eyeOpen: 1.2, curve: 0, mouthOpen: 0.9, blush: 0.3 },
  disgusted: { browTilt: 0.5, browY: 0, eyeOpen: 0.7, curve: -0.8, mouthOpen: 0.2, blush: 0 },
};

const KEYS: (keyof Face)[] = ['browTilt', 'browY', 'eyeOpen', 'curve', 'mouthOpen', 'blush'];

const STARS: { x: number; y: number; r: number }[] = [
  { x: 14, y: 22, r: 1.2 },
  { x: 36, y: 10, r: 0.9 },
  { x: 168, y: 18, r: 1.4 },
  { x: 186, y: 52, r: 1 },
  { x: 12, y: 70, r: 0.9 },
  { x: 188, y: 110, r: 1.2 },
  { x: 10, y: 130, r: 1 },
  { x: 180, y: 160, r: 0.9 },
];

function lerpFace(a: Face, b: Face, t: number): Face {
  const out = { ...a };
  KEYS.forEach((k) => {
    out[k] = a[k] + (b[k] - a[k]) * t;
  });
  return out;
}

export function Avatar(props: { emotion: Emotion; speaking: boolean; size?: number }): JSX.Element {
  const { emotion, speaking } = props;
  const size = props.size ?? 96;

  const [reduceMotion, setReduceMotion] = useState(false);
  const [face, setFace] = useState<Face>(FACES[emotion] ?? FACES.neutral);
  const [blink, setBlink] = useState(false);
  const [talk, setTalk] = useState(0);
  const faceRef = useRef<Face>(face);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduceMotion(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduceMotion(v));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  // Expression transition (250 ms ease-out)
  useEffect(() => {
    const target = FACES[emotion] ?? FACES.neutral;
    if (reduceMotion) {
      faceRef.current = target;
      setFace(target);
      return;
    }
    const from = faceRef.current;
    const start = Date.now();
    const duration = 250;
    let raf = 0;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = lerpFace(from, target, eased);
      faceRef.current = next;
      setFace(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [emotion, reduceMotion]);

  // Soft blink every few seconds
  useEffect(() => {
    if (reduceMotion) {
      setBlink(false);
      return;
    }
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t1 = setTimeout(() => {
        setBlink(true);
        t2 = setTimeout(() => {
          setBlink(false);
          schedule();
        }, 140);
      }, 2500 + Math.random() * 3000);
    };
    schedule();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [reduceMotion]);

  // Mouth opens and closes while speaking
  useEffect(() => {
    if (!speaking) {
      setTalk(0);
      return;
    }
    if (reduceMotion) {
      setTalk(0.4);
      return;
    }
    const id = setInterval(() => setTalk(0.15 + Math.random() * 0.85), 130);
    return () => clearInterval(id);
  }, [speaking, reduceMotion]);

  const open = blink ? 0.08 : Math.max(0.08, face.eyeOpen);
  const mouthOpen = Math.min(1, face.mouthOpen * 0.5 + talk * 0.9);

  // Eyebrows
  const browBase = 83 + face.browY;
  const innerY = browBase + face.browTilt * 5;
  const outerY = browBase - face.browTilt * 1.5;
  const leftBrow = `M64 ${outerY.toFixed(2)} Q76 ${(browBase - 3).toFixed(2)} 90 ${innerY.toFixed(2)}`;
  const rightBrow = `M136 ${outerY.toFixed(2)} Q124 ${(browBase - 3).toFixed(2)} 110 ${innerY.toFixed(2)}`;

  // Mouth
  const cy0 = 130 - face.curve * 2;
  const ctrlU = 130 + face.curve * 7;
  const ctrlL = ctrlU + mouthOpen * 18;
  const mouthLine = `M88 ${cy0.toFixed(2)} Q100 ${ctrlU.toFixed(2)} 112 ${cy0.toFixed(2)}`;
  const mouthFill = `${mouthLine} Q100 ${ctrlL.toFixed(2)} 88 ${cy0.toFixed(2)} Z`;
  const mouthIsOpen = mouthOpen > 0.1;

  const inner = Math.max(8, size - 4);

  const eye = (cx: number) => (
    <G transform={`translate(${cx} 98) scale(1 ${open.toFixed(3)})`}>
      <Ellipse cx={0} cy={0} rx={12} ry={10} fill={ART.white} />
      <Ellipse cx={0} cy={0} rx={8} ry={9.5} fill={ART.iris} />
      <Ellipse cx={0} cy={2} rx={8} ry={6} fill={ART.irisDark} opacity={0.45} />
      <Ellipse cx={0} cy={0} rx={3.6} ry={5.2} fill={ART.pupil} />
      <Circle cx={-2.8} cy={-3.4} r={2.8} fill={ART.white} />
      <Circle cx={3.2} cy={3} r={1.3} fill={ART.white} />
      <Path
        d="M-13 -1 Q0 -14 13 -1"
        stroke={ART.outline}
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
      />
    </G>
  );

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Avatar, emoción ${emotion}${speaking ? ', hablando' : ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: ART.ring,
        backgroundColor: ART.bgTop,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={inner} height={inner} viewBox="0 0 200 200">
        <Defs>
          <LinearGradient id="avBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={ART.bgTop} />
            <Stop offset="1" stopColor={ART.bgBottom} />
          </LinearGradient>
          <LinearGradient id="avHair" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={ART.hairLight} />
            <Stop offset="0.45" stopColor={ART.hair} />
            <Stop offset="1" stopColor={ART.hairDark} />
          </LinearGradient>
          <ClipPath id="avClip">
            <Rect x={0} y={0} width={200} height={200} />
          </ClipPath>
        </Defs>

        <G clipPath="url(#avClip)">
          {/* far layer: sky */}
          <Rect x={0} y={0} width={200} height={200} fill="url(#avBg)" />
          {STARS.map((s, i) => (
            <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill={ART.star} opacity={0.8} />
          ))}

          {/* back hair */}
          <Path
            d="M22 200 C10 120 18 48 100 8 C182 48 190 120 178 200 Z"
            fill="url(#avHair)"
            stroke={ART.outline}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
          {/* lower streaks */}
          <Path d="M40 200 C38 160 44 130 52 112 L62 114 C56 140 54 170 58 200 Z" fill={ART.streakPink} />
          <Path d="M30 200 C28 160 36 132 44 112 L52 112 C46 140 44 170 46 200 Z" fill={ART.streakViolet} />
          <Path d="M160 200 C162 160 156 130 148 112 L138 114 C144 140 146 170 142 200 Z" fill={ART.streakPink} />
          <Path d="M170 200 C172 160 164 132 156 112 L148 112 C154 140 156 170 154 200 Z" fill={ART.streakLilac} />

          {/* sweater */}
          <Path
            d="M38 200 C42 170 66 156 100 156 C134 156 158 170 162 200 Z"
            fill={ART.sweater}
            stroke={ART.outline}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
          <Path d="M70 160 C84 176 116 176 130 160 C124 150 76 150 70 160 Z" fill={ART.sweaterDark} />

          {/* neck */}
          <Path d="M88 138 L112 138 L112 160 C104 168 96 168 88 160 Z" fill={ART.skinShade} />

          {/* face */}
          <Path
            d="M50 70 L150 70 L148 100 C145 130 122 152 100 154 C78 152 55 130 52 100 Z"
            fill={ART.skin}
            stroke={ART.outline}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />

          {/* blush */}
          <Ellipse cx={68} cy={116} rx={10} ry={5.5} fill={ART.blush} opacity={face.blush * 0.55} />
          <Ellipse cx={132} cy={116} rx={10} ry={5.5} fill={ART.blush} opacity={face.blush * 0.55} />

          {/* eyes */}
          {eye(77)}
          {eye(123)}

          {/* eyebrows */}
          <Path d={leftBrow} stroke={ART.hairDark} strokeWidth={2.6} strokeLinecap="round" fill="none" />
          <Path d={rightBrow} stroke={ART.hairDark} strokeWidth={2.6} strokeLinecap="round" fill="none" />

          {/* nose */}
          <Path d="M99 111 Q100 114 101 111" stroke={ART.skinShade} strokeWidth={1.6} strokeLinecap="round" fill="none" />

          {/* mouth */}
          {mouthIsOpen ? (
            <Path
              d={mouthFill}
              fill={ART.mouth}
              stroke={ART.outline}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
          ) : (
            <Path d={mouthLine} stroke={ART.outline} strokeWidth={2} strokeLinecap="round" fill="none" />
          )}

          {/* side locks over the face */}
          <Path
            d="M50 40 C36 84 40 126 34 186 L54 186 C58 140 56 104 64 72 Z"
            fill="url(#avHair)"
            stroke={ART.outline}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
          <Path
            d="M150 40 C164 84 160 126 166 186 L146 186 C142 140 144 104 136 72 Z"
            fill="url(#avHair)"
            stroke={ART.outline}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />

          {/* straight bangs */}
          <Path
            d="M46 74 C42 30 68 8 100 8 C132 8 158 30 154 74 L100 74 Z"
            fill="url(#avHair)"
            stroke={ART.outline}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
          <Path d="M92 9 L101 9 L107 74 L96 74 Z" fill={ART.streakViolet} />
          <Path d="M101 9 L113 10 L121 74 L107 74 Z" fill={ART.streakPink} />
          <Path d="M113 10 L125 14 L134 74 L121 74 Z" fill={ART.streakLilac} />
          {/* bang strands and gloss */}
          <Path d="M72 74 L74 36" stroke={ART.outline} strokeWidth={1} strokeLinecap="round" opacity={0.6} />
          <Path d="M146 74 L142 40" stroke={ART.outline} strokeWidth={1} strokeLinecap="round" opacity={0.6} />
          <Path d="M58 74 L60 50" stroke={ART.outline} strokeWidth={1} strokeLinecap="round" opacity={0.6} />
          <Path
            d="M66 34 Q80 24 92 26"
            stroke={ART.white}
            strokeWidth={2.4}
            strokeLinecap="round"
            fill="none"
            opacity={0.3}
          />
          <Path d="M46 74 L154 74" stroke={ART.outline} strokeWidth={1.6} strokeLinecap="round" />
        </G>
      </Svg>
    </View>
  );
}

export default Avatar;
