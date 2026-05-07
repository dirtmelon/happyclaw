/**
 * Discover the list of Cursor models available to the current `cursor-agent`
 * account by shelling out to `cursor-agent --list-models --trust < /dev/null`
 * and parsing its plain-text "id - label" output.
 *
 * Why a subprocess and not an HTTP API:
 *   - Cursor does not expose a public list-models endpoint outside the CLI;
 *     the CLI talks to a private back-end with the user's OAuth/API key.
 *   - Account-scoped (different subscription tiers see different models).
 *
 * Key concerns this module owns:
 *   - **Caching**: list-models takes 1–6s wall-clock, often during preflight
 *     (Trust prompts, version checks). We cache successful results for 5 min
 *     in-process and return cached values stale-while-revalidating after
 *     errors so a transient cursor-agent flake doesn't blank the UI.
 *   - **Stdin closure**: cursor-agent prints "Available models" then waits on
 *     stdin if the parent doesn't close it. We always pass `< /dev/null`.
 *   - **Stdout truncation**: `--list-models` writes ~100 lines; piping into
 *     `head -N` causes EPIPE inside cursor-agent which then hangs forever.
 *     We capture full stdout, then process in-memory.
 *   - **Workspace trust**: cursor-agent refuses without `--trust` when CWD
 *     hasn't been previously trusted. We always pass `--trust`.
 *
 * Public API:
 *   - `listCursorModels()` — async, returns `CursorModel[]`. Throws on
 *     unrecoverable errors only (cursor-agent missing, parse failure,
 *     subprocess timeout) and never on a stale cache hit.
 *   - `clearCursorModelsCache()` — for tests / admin reset.
 *   - `parseCursorModelsOutput(stdout)` — exported pure function for unit
 *     tests; not used directly by route consumers.
 */
import { execFile } from 'child_process';

import { logger } from './logger.js';

/** A single cursor-agent model entry, normalized for the Web UI. */
export interface CursorModel {
  /** Model ID accepted by `cursor-agent --model <id>`. */
  id: string;
  /** Human-readable display name (e.g. "Sonnet 4.6 1M Thinking"). */
  label: string;
  /** True for the model marked `(default)` in cursor-agent's output. */
  isDefault: boolean;
  /** True for the model marked `(current)` — cursor-agent's notion of the
   * "currently selected" model for this account. Informational only;
   * happyclaw resolves its own effective model via `resolveCursorModel()`. */
  isCurrent: boolean;
}

interface CacheEntry {
  models: CursorModel[];
  fetchedAt: number;
}

/** Cache TTL for successful fetches. 5 minutes balances UX (snappy dropdown
 * open) against subscription change latency (operator just toggled a model
 * in their Cursor subscription panel). */
const CACHE_TTL_MS = 5 * 60_000;

/** Maximum subprocess wall-clock time. cursor-agent normally returns in 1–3s
 * but cold-start (worker server boot) can take 5–6s; 12s leaves headroom
 * without making the UI feel hung. */
const SUBPROCESS_TIMEOUT_MS = 12_000;

let cache: CacheEntry | null = null;
let inflight: Promise<CursorModel[]> | null = null;

/**
 * Parse the textual `--list-models` output. Format empirically observed:
 *
 *   Available models
 *
 *   auto - Auto
 *   composer-2-fast - Composer 2 Fast (default)
 *   ...
 *   claude-4.6-sonnet-medium - Sonnet 4.6 1M (current)
 *   ...
 *
 *   Tip: use --model <id> (or /model <id> in interactive mode) to switch.
 *
 * We accept any number of leading blank lines / banner lines before the first
 * `id - label` line, and ignore the trailing tip footer.
 */
export function parseCursorModelsOutput(stdout: string): CursorModel[] {
  const lines = stdout.split(/\r?\n/);
  const models: CursorModel[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('Tip:')) break;
    if (line.toLowerCase().startsWith('available models')) continue;
    // Match "id - label". The id is the first space-delimited token; cursor
    // model IDs only contain lowercase [a-z0-9._-], so a strict (case-sensitive)
    // regex catches them and skips banner/error lines. Case-insensitive here
    // would let banner lines like "Available - models" slip through and
    // collide with the prefix check above.
    const match = line.match(/^([a-z0-9._-]+)\s+-\s+(.+)$/);
    if (!match) continue;
    const id = match[1];
    let label = match[2].trim();
    let isDefault = false;
    let isCurrent = false;
    // Strip trailing markers. cursor-agent uses "(default)" and "(current)"
    // independently; both can appear on the same line in principle.
    label = label.replace(/\s*\((default|current)\)\s*$/i, (_m, marker) => {
      const m = marker.toLowerCase();
      if (m === 'default') isDefault = true;
      if (m === 'current') isCurrent = true;
      return '';
    });
    // A second pass in case both markers were stacked (rare).
    label = label.replace(/\s*\((default|current)\)\s*$/i, (_m, marker) => {
      const m = marker.toLowerCase();
      if (m === 'default') isDefault = true;
      if (m === 'current') isCurrent = true;
      return '';
    });
    label = label.trim();
    models.push({ id, label, isDefault, isCurrent });
  }
  return models;
}

interface FetchOptions {
  /** Override the cursor-agent binary path (test injection / `CURSOR_AGENT_BIN`). */
  bin?: string;
  /** Override CWD passed to cursor-agent. Defaults to a writable scratch dir
   * (the workspace must be trusted; `--trust` consents on the fly). */
  cwd?: string;
}

function spawnListModels(opts: FetchOptions = {}): Promise<string> {
  const bin = opts.bin || process.env.CURSOR_AGENT_BIN || 'cursor-agent';
  const cwd = opts.cwd || process.cwd();
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      ['--list-models', '--trust'],
      {
        cwd,
        timeout: SUBPROCESS_TIMEOUT_MS,
        maxBuffer: 1 * 1024 * 1024,
        // Inherit env so CURSOR_API_KEY / login state propagate.
        env: process.env,
      },
      (err, stdout, stderr) => {
        if (err) {
          // ENOENT = cursor-agent not on PATH. Surface a typed error so the
          // route can degrade with a 503 + actionable hint.
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            const e = new Error(
              `cursor-agent not found on PATH (looked for ${bin}). Install via 'curl https://cursor.com/install -fsS | bash' or set CURSOR_AGENT_BIN.`,
            );
            (e as NodeJS.ErrnoException).code = 'ENOENT';
            reject(e);
            return;
          }
          // Timeout / non-zero exit. Include stderr in the message so the
          // operator can see auth errors etc.
          const errMsg = (stderr || '').toString().trim() || err.message;
          reject(new Error(`cursor-agent --list-models failed: ${errMsg}`));
          return;
        }
        resolve(stdout);
      },
    );
    // Closing stdin prevents cursor-agent from prompting interactively.
    child.stdin?.end();
  });
}

/**
 * Fetch available Cursor models, cached. Returns cached value when fresh.
 *
 * Errors are bubbled up to the route layer for the first call after a cache
 * miss/expiry. Subsequent calls within the cache window short-circuit on the
 * stored result regardless of whether the *previous* fetch succeeded — this
 * lets the UI keep showing a slightly stale list when cursor-agent flakes.
 */
export async function listCursorModels(
  opts: { force?: boolean; fetchOptions?: FetchOptions } = {},
): Promise<CursorModel[]> {
  const now = Date.now();
  if (
    !opts.force &&
    cache &&
    now - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache.models;
  }
  const fetchOptions = opts.fetchOptions ?? {};

  // `inflight` deduplicates non-force callers only. Forced callers MUST run
  // a fresh subprocess (otherwise the "刷新列表" UX silently no-ops when a
  // non-force or stale-on-error fetch is already in flight). We keep them
  // OUT of the `inflight` slot so the non-force singleton invariant holds:
  // at most one non-force fetch in flight at a time, plus zero or more
  // forced fetches. Forced concurrency is bounded by the route-layer admin
  // gate on `?force=1`.
  if (opts.force) {
    return runFetch(fetchOptions);
  }
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    try {
      return await runFetch(fetchOptions);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Single-shot subprocess + parse + cache write. Pulled out so both the
 * inflight-deduplicated path and the bypass force-refresh path share exactly
 * the same caching / stale-while-error semantics.
 */
async function runFetch(fetchOptions: FetchOptions): Promise<CursorModel[]> {
  try {
    const stdout = await spawnListModels(fetchOptions);
    const models = parseCursorModelsOutput(stdout);
    if (models.length === 0) {
      // Empty parse = unrecognized output format. Don't cache; better to
      // retry next call and surface a clear error to the operator.
      throw new Error(
        'cursor-agent --list-models returned no parseable model lines',
      );
    }
    cache = { models, fetchedAt: Date.now() };
    logger.info(
      { count: models.length, bin: fetchOptions.bin || process.env.CURSOR_AGENT_BIN || 'cursor-agent' },
      'Refreshed Cursor models cache',
    );
    return models;
  } catch (err) {
    // Stale-while-error: when we have *any* cached models from a previous
    // successful run, return them so a transient flake doesn't break the
    // UI. Re-throw only when there's nothing to fall back to.
    if (cache && cache.models.length > 0) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'cursor-agent --list-models failed, serving stale cache',
      );
      return cache.models;
    }
    throw err;
  }
}

/** Reset the in-process cache. Used by tests, and exposed via the route as
 * an admin escape hatch (?force=1) when cursor-agent has been swapped. */
export function clearCursorModelsCache(): void {
  cache = null;
}

/** Snapshot of cache state, for diagnostic endpoints. */
export function getCursorModelsCacheState(): {
  cached: boolean;
  count: number;
  ageMs: number | null;
  fetchedAt: string | null;
} {
  if (!cache) return { cached: false, count: 0, ageMs: null, fetchedAt: null };
  return {
    cached: true,
    count: cache.models.length,
    ageMs: Date.now() - cache.fetchedAt,
    fetchedAt: new Date(cache.fetchedAt).toISOString(),
  };
}
