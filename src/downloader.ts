import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { DownloadHandle, DownloadState, InstalledModel, ModelOption } from './types';

const MB = 1024 * 1024;
const CHUNK = 2 * MB;
const MARGIN_MB = 300;
const SIZE_TOLERANCE = 0.05;
const MAX_ATTEMPTS = 3;
const CHUNK_TIMEOUT_MS = 30000;

function modelsDir(): Directory {
  return new Directory(Paths.document, 'models');
}

function ensureDir(): Directory {
  const dir = modelsDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Ruta local (URI) donde se guarda el GGUF del modelo. */
export function modelPath(m: ModelOption): string {
  return new File(modelsDir(), m.fileName).uri;
}

/** Espacio libre del teléfono en MB. Devuelve null si no se puede leer (nunca se bloquea por un valor desconocido). */
export async function getFreeMB(): Promise<number | null> {
  if (Platform.OS === 'web') return null;
  try {
    const bytes = Paths.availableDiskSpace;
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return null;
    return Math.floor(bytes / MB);
  } catch {
    return null;
  }
}

/** Borra el archivo del modelo si existe. */
export async function deleteModelFile(path: string): Promise<void> {
  try {
    const f = new File(path);
    if (f.exists) f.delete();
  } catch {
    /* ya no existe o no se puede borrar: nada más que hacer */
  }
}

function safeDelete(path: string): void {
  try {
    const f = new File(path);
    if (f.exists) f.delete();
  } catch {
    /* ignorado */
  }
}

function parseTotal(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const m = /\/(\d+)\s*$/.exec(contentRange);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Descarga el GGUF por tramos de 2 MB (cabecera Range): progreso real,
 * cancelación inmediata y poca memoria. Borra el archivo parcial si falla o se cancela.
 */
export function startDownload(
  m: ModelOption,
  onProgress: (p: DownloadState) => void,
): DownloadHandle {
  let cancelled = false;
  let current: AbortController | null = null;
  const expectedBytes = m.sizeMB * MB;
  let finalPath = '';

  const emit = (
    status: DownloadState['status'],
    received: number,
    total: number,
    error?: string,
  ) => {
    onProgress({
      modelId: m.id,
      status,
      progress: total > 0 ? Math.min(1, received / total) : 0,
      receivedMB: Math.round((received / MB) * 10) / 10,
      error,
    });
  };

  const fail = (received: number, total: number, message: string): null => {
    if (finalPath) safeDelete(finalPath);
    emit('error', received, total, message);
    return null;
  };

  const run = async (): Promise<InstalledModel | null> => {
    let written = 0;
    let total = expectedBytes;
    try {
      if (Platform.OS === 'web') {
        return fail(
          0,
          total,
          'La descarga del modelo solo funciona en el teléfono. Abre la app en tu Android.',
        );
      }
      // 1. Espacio libre: tamaño + margen de 300 MB (si no se puede leer, no se bloquea)
      const freeMB = await getFreeMB();
      const needMB = m.sizeMB + MARGIN_MB;
      if (freeMB !== null && freeMB < needMB) {
        return fail(
          0,
          total,
          `No hay espacio suficiente: faltan ${Math.ceil(needMB - freeMB)} MB (se necesitan ${needMB} MB con margen).`,
        );
      }

      // 2. Archivo de destino limpio
      const dir = ensureDir();
      const file = new File(dir, m.fileName);
      finalPath = file.uri;
      if (file.exists) file.delete();
      file.create({ overwrite: true });

      emit('downloading', 0, total);

      const handle = file.open();
      let target = m.url;
      let knownTotal: number | null = null;

      try {
        while (!cancelled && (knownTotal === null || written < knownTotal)) {
          const start = written;
          const end =
            knownTotal === null
              ? start + CHUNK - 1
              : Math.min(start + CHUNK - 1, knownTotal - 1);

          let buf: ArrayBuffer | null = null;
          let lastError = 'Sin conexión. Comprueba tu red e inténtalo de nuevo.';

          for (let attempt = 0; attempt < MAX_ATTEMPTS && !cancelled; attempt++) {
            const ctrl = new AbortController();
            current = ctrl;
            const timer = setTimeout(() => ctrl.abort(), CHUNK_TIMEOUT_MS);
            try {
              const res = await fetch(target, {
                headers: { Range: `bytes=${start}-${end}` },
                signal: ctrl.signal,
              });
              if (res.status === 206) {
                const t = parseTotal(res.headers.get('content-range'));
                if (t !== null) knownTotal = t;
                if (attempt === 0 && target === m.url && res.url && res.url.startsWith('https://')) {
                  target = res.url; // evita repetir la redirección en cada tramo
                }
                buf = await res.arrayBuffer();
                clearTimeout(timer);
                break;
              }
              clearTimeout(timer);
              if (res.status === 200) {
                lastError = 'El servidor no admite descargas por partes. Inténtalo más tarde.';
                break;
              }
              lastError = `El servidor respondió con el código ${res.status}.`;
              target = m.url; // por si la URL firmada caducó
            } catch {
              clearTimeout(timer);
              if (cancelled) break;
              lastError = 'Se cortó la conexión. Comprueba tu red e inténtalo de nuevo.';
              target = m.url;
            }
            if (lastError.startsWith('El servidor no admite')) break;
            await sleep(800 * (attempt + 1));
          }

          if (cancelled) break;
          if (!buf) {
            handle.close();
            return fail(written, knownTotal ?? total, lastError);
          }

          const bytes = new Uint8Array(buf);
          if (bytes.length === 0) {
            handle.close();
            return fail(written, knownTotal ?? total, 'El servidor devolvió un tramo vacío.');
          }
          handle.offset = written;
          handle.writeBytes(bytes);
          written += bytes.length;
          if (knownTotal !== null) total = knownTotal;
          emit('downloading', written, total);
        }
      } finally {
        try {
          handle.close();
        } catch {
          /* ya cerrado */
        }
      }

      if (cancelled) {
        safeDelete(finalPath);
        emit('idle', 0, total);
        return null;
      }

      // 3. Verificación de tamaño
      let onDisk = written;
      try {
        onDisk = file.size;
      } catch {
        /* usamos lo escrito */
      }
      const diffRatio = Math.abs(written - expectedBytes) / expectedBytes;
      if (knownTotal === null || written !== knownTotal || onDisk !== written || diffRatio > SIZE_TOLERANCE) {
        return fail(
          written,
          total,
          'El archivo descargado está dañado (el tamaño no coincide). Se borró; vuelve a intentarlo.',
        );
      }

      emit('done', written, total);
      return {
        id: m.id,
        localPath: file.uri,
        sizeMB: Math.round((written / MB) * 10) / 10,
        installedAt: Date.now(),
      };
    } catch (e) {
      if (cancelled) {
        if (finalPath) safeDelete(finalPath);
        emit('idle', 0, total);
        return null;
      }
      const msg = e instanceof Error && e.message ? e.message : 'Error desconocido';
      return fail(written, total, `No se pudo descargar: ${msg}`);
    }
  };

  const done = run();

  return {
    done,
    async cancel() {
      if (cancelled) {
        await done;
        return;
      }
      cancelled = true;
      try {
        current?.abort();
      } catch {
        /* ignorado */
      }
      await done;
      if (finalPath) safeDelete(finalPath);
    },
  };
}
