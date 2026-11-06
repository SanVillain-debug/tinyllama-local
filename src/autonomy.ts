import { useEffect, useRef } from 'react';
import type { EngineState } from './types';

const QUIET_MS = 60 * 1000; // 1 minute of calm after each message
const MIN_WAIT_MS = 1000; // 1 second
const MAX_WAIT_MS = 30 * 60 * 1000; // 30 minutes
const ABSENCE_MS = 10 * 60 * 1000; // long absence
const RETRY_MS = 5 * 60 * 1000; // if nothing changed after the die fired

interface Opts {
  enabled: boolean;
  engineStatus: EngineState['status'];
  lastActivityAt: number;
  onBored: () => void;
  onCurious: () => void;
  onLongAbsence: () => void;
}

export function useAutonomy(opts: Opts): void {
  const { enabled, engineStatus, lastActivityAt } = opts;

  const cbRef = useRef({
    onBored: opts.onBored,
    onCurious: opts.onCurious,
    onLongAbsence: opts.onLongAbsence,
  });
  cbRef.current = {
    onBored: opts.onBored,
    onCurious: opts.onCurious,
    onLongAbsence: opts.onLongAbsence,
  };

  const statusRef = useRef(engineStatus);
  statusRef.current = engineStatus;

  // The die: only while the model is ready (never while generating / loading).
  useEffect(() => {
    if (!enabled || engineStatus !== 'ready') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (ms: number, fn: () => void) => {
      timer = setTimeout(() => {
        if (cancelled) return;
        fn();
      }, ms);
    };

    const startCycle = (quiet: number) => {
      // 1 minute after the last message (or after generation ended), roll the die.
      schedule(quiet, () => {
        const wait = MIN_WAIT_MS + Math.random() * (MAX_WAIT_MS - MIN_WAIT_MS);
        schedule(wait, () => {
          if (statusRef.current !== 'ready') return;
          const curious = Math.random() < 0.5;
          if (curious) cbRef.current.onCurious();
          else cbRef.current.onBored();
          // Normally the resulting message restarts this effect through
          // lastActivityAt; if not, try again after a long pause.
          startCycle(RETRY_MS);
        });
      });
    };

    startCycle(QUIET_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, engineStatus, lastActivityAt]);

  // Long absence: one emotional reaction after 10 minutes without messages.
  useEffect(() => {
    if (engineStatus !== 'ready' || lastActivityAt <= 0) return;
    const remaining = Math.max(0, lastActivityAt + ABSENCE_MS - Date.now());
    const timer = setTimeout(() => {
      if (statusRef.current === 'ready') cbRef.current.onLongAbsence();
    }, remaining);
    return () => clearTimeout(timer);
  }, [engineStatus, lastActivityAt]);
}
