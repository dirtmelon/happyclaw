/**
 * Cursor models cache for the Web UI.
 *
 * Backed by `GET /api/config/cursor-models`, which itself is a 5-minute cache
 * around `cursor-agent --list-models`. We keep an additional in-memory copy
 * here so opening a dropdown doesn't show a spinner every time:
 *   - First call: trigger fetch, return `{ loading: true, models: [] }`.
 *   - Subsequent calls within `STALE_TTL_MS`: return cached, no refetch.
 *   - After TTL: return cached AND kick off a background refresh
 *     (stale-while-revalidate) so the dropdown stays snappy.
 *   - On error: keep previous successful cache, surface `error` so the UI can
 *     show a retry banner.
 *
 * Components subscribe via `useCursorModels()`; the hook lazily triggers the
 * first fetch the moment any component mounts that needs the list.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

import { api } from '../api/client';

export interface CursorModel {
  id: string;
  label: string;
  isDefault: boolean;
  isCurrent: boolean;
}

interface CursorModelsState {
  models: CursorModel[];
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
  load: (force?: boolean) => Promise<void>;
}

const STALE_TTL_MS = 5 * 60_000;

export const useCursorModelsStore = create<CursorModelsState>((set, get) => ({
  models: [],
  loading: false,
  error: null,
  fetchedAt: null,

  load: async (force = false) => {
    const state = get();
    const fresh =
      !force &&
      state.fetchedAt !== null &&
      Date.now() - state.fetchedAt < STALE_TTL_MS;
    if (fresh) return;
    if (state.loading) return; // already in-flight
    set({ loading: true, error: null });
    try {
      const data = await api.get<{ models: CursorModel[] }>(
        force
          ? '/api/config/cursor-models?force=1'
          : '/api/config/cursor-models',
      );
      set({
        models: data.models ?? [],
        loading: false,
        error: null,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      // Keep stale models on error so the dropdown remains usable.
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));

/**
 * Subscribe to the cursor-models cache. Triggers the first fetch lazily on
 * mount so callers don't have to remember to call `load()`. Pass `{ force: true }`
 * to force a hard refresh (admin "refresh models" button).
 */
export function useCursorModels(): {
  models: CursorModel[];
  loading: boolean;
  error: string | null;
  /** Trigger a fresh fetch (bypasses the 5-min cache). */
  refresh: () => Promise<void>;
} {
  const models = useCursorModelsStore((s) => s.models);
  const loading = useCursorModelsStore((s) => s.loading);
  const error = useCursorModelsStore((s) => s.error);
  const load = useCursorModelsStore((s) => s.load);

  // Lazy fetch on mount; the store's `load()` self-deduplicates so multiple
  // concurrent consumers result in a single network request. Re-runs whenever
  // a previous error allows the user to retry by remounting.
  useEffect(() => {
    void load();
  }, [load]);

  return {
    models,
    loading,
    error,
    refresh: () => load(true),
  };
}
