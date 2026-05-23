import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SparklineModel } from './types';

/**
 * In-memory store for the active workbook's sparklines. Mirrors
 * `charts-context` in shape. v1 keeps sparklines local-only — they
 * vanish on workbook swap (re-add after Open) and don't round-trip
 * through xlsx yet. The autosave snapshot stream picks them up
 * indirectly via the React state tree's IDB capture.
 */

type Ctx = {
  sparklines: SparklineModel[];
  add: (model: Omit<SparklineModel, 'id'>) => string;
  update: (id: string, patch: Partial<SparklineModel>) => void;
  remove: (id: string) => void;
  clear: () => void;
};

const SparklinesCtx = createContext<Ctx | null>(null);

export function SparklinesProvider({ children }: { children: ReactNode }) {
  const [sparklines, setSparklines] = useState<SparklineModel[]>([]);

  const add = useCallback((model: Omit<SparklineModel, 'id'>): string => {
    const id = `spark-${Math.random().toString(36).slice(2, 10)}`;
    setSparklines((prev) => [...prev, { ...model, id }]);
    return id;
  }, []);

  const update = useCallback((id: string, patch: Partial<SparklineModel>) => {
    setSparklines((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const remove = useCallback((id: string) => {
    setSparklines((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const clear = useCallback(() => setSparklines([]), []);

  const value = useMemo<Ctx>(
    () => ({ sparklines, add, update, remove, clear }),
    [sparklines, add, update, remove, clear],
  );

  return <SparklinesCtx.Provider value={value}>{children}</SparklinesCtx.Provider>;
}

export function useSparklines(): Ctx {
  const ctx = useContext(SparklinesCtx);
  if (!ctx) throw new Error('useSparklines must be used inside <SparklinesProvider>');
  return ctx;
}
