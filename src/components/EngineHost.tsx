import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { EngineApi, EngineHostProps, FromEngine, Settings, ToEngine } from '../types';
import { ENGINE_HTML } from '../engineHtml';

const KNOWN_EVENTS: ReadonlyArray<FromEngine['type']> = [
  'ready',
  'loadProgress',
  'loaded',
  'token',
  'done',
  'error',
];

function parseEvent(raw: string): FromEngine | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const type = (data as { type?: unknown }).type;
    if (typeof type !== 'string') return null;
    if (!KNOWN_EVENTS.includes(type as FromEngine['type'])) return null;
    return data as FromEngine;
  } catch {
    return null;
  }
}

function toScript(msg: ToEngine): string {
  const payload = JSON.stringify(JSON.stringify(msg));
  return (
    'try{document.dispatchEvent(new MessageEvent("message",{data:' +
    payload +
    ',bubbles:true}));}catch(e){}true;'
  );
}

export const EngineHost = forwardRef<EngineApi, EngineHostProps>(function EngineHost(
  { onEvent },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<string[]>([]);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const flush = useCallback(() => {
    readyRef.current = true;
    const queued = pendingRef.current;
    pendingRef.current = [];
    queued.forEach((js) => webRef.current?.injectJavaScript(js));
  }, []);

  const send = useCallback((msg: ToEngine) => {
    if (Platform.OS === 'web') {
      if (msg.type === 'load' || msg.type === 'generate') {
        onEventRef.current({
          type: 'error',
          message: 'El motor local solo funciona en el teléfono. Abre la app en tu Android.',
        });
      }
      return;
    }
    const js = toScript(msg);
    if (readyRef.current && webRef.current) {
      webRef.current.injectJavaScript(js);
    } else {
      pendingRef.current.push(js);
    }
  }, []);

  useImperativeHandle(
    ref,
    (): EngineApi => ({
      load(modelUrl: string, s: Settings) {
        send({ type: 'load', modelUrl, nCtx: s.nCtx, nThreads: s.nThreads });
      },
      generate(prompt: string, s: Settings) {
        send({
          type: 'generate',
          prompt,
          maxTokens: s.maxTokens,
          temperature: s.temperature,
        });
      },
      stop() {
        send({ type: 'stop' });
      },
      unload() {
        send({ type: 'unload' });
      },
    }),
    [send],
  );

  const handleMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const evt = parseEvent(e.nativeEvent.data);
      if (!evt) return;
      if (evt.type === 'ready') flush();
      onEventRef.current(evt);
    },
    [flush],
  );

  const handleFailure = useCallback((message: string) => {
    readyRef.current = false;
    pendingRef.current = [];
    onEventRef.current({ type: 'error', message });
  }, []);

  if (Platform.OS === 'web') return <View style={styles.hidden} pointerEvents="none" />;

  return (
    <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        ref={webRef}
        source={{ html: ENGINE_HTML, baseUrl: 'file:///' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mixedContentMode="always"
        cacheEnabled
        setSupportMultipleWindows={false}
        onMessage={handleMessage}
        onLoadEnd={flush}
        onError={() =>
          handleFailure('No se pudo iniciar el motor local. Revisa tu conexión e inténtalo de nuevo.')
        }
        onRenderProcessGone={() =>
          handleFailure('El motor se cerró por falta de memoria. Vuelve a cargar el modelo.')
        }
        onContentProcessDidTerminate={() =>
          handleFailure('El motor se cerró por falta de memoria. Vuelve a cargar el modelo.')
        }
        style={styles.web}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
    left: 0,
    bottom: 0,
  },
  web: { width: 1, height: 1, backgroundColor: 'transparent' },
});

export default EngineHost;
