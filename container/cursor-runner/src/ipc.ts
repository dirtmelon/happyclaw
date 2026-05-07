/**
 * IPC helpers for cursor-runner.
 *
 * Mirrors the agent-runner IPC layout (`<workspaceIpc>/input/*.json` for
 * pending follow-up messages, plus `_close` / `_drain` / `_interrupt`
 * sentinels) so the host process talks to either runner identically.
 *
 * Note: cursor-agent CLI does NOT support streaming follow-up prompts into
 * a running query. The flow is:
 *   1. Wait for the next IPC message in the gap between cursor-agent runs.
 *   2. Combine all drained messages into a single prompt for the next
 *      cursor-agent invocation, which uses `--resume <chatId>` for context.
 *   3. If `_interrupt` arrives while cursor-agent is running, the main loop
 *      kills the child with SIGINT and resumes from the next IPC message.
 */
import fs from 'fs';
import path from 'path';

export interface PendingMessage {
  text: string;
  images?: Array<{ data: string; mimeType?: string }>;
  taskId?: string;
  sourceJid?: string;
}

export interface IpcDrainResult {
  messages: PendingMessage[];
}

export class IpcChannel {
  readonly inputDir: string;
  readonly closeSentinel: string;
  readonly drainSentinel: string;
  readonly interruptSentinel: string;

  constructor(workspaceIpc: string) {
    this.inputDir = path.join(workspaceIpc, 'input');
    this.closeSentinel = path.join(this.inputDir, '_close');
    this.drainSentinel = path.join(this.inputDir, '_drain');
    this.interruptSentinel = path.join(this.inputDir, '_interrupt');
  }

  ensureDir(): void {
    fs.mkdirSync(this.inputDir, { recursive: true });
  }

  /** Return true (and consume the file) when `_close` is present. */
  consumeClose(): boolean {
    return this.consumeSentinel(this.closeSentinel);
  }

  consumeDrain(): boolean {
    return this.consumeSentinel(this.drainSentinel);
  }

  consumeInterrupt(): boolean {
    return this.consumeSentinel(this.interruptSentinel);
  }

  hasInterrupt(): boolean {
    return fs.existsSync(this.interruptSentinel);
  }

  private consumeSentinel(sentinel: string): boolean {
    if (!fs.existsSync(sentinel)) return false;
    try {
      fs.unlinkSync(sentinel);
    } catch {
      /* ignore */
    }
    return true;
  }

  /** Drain all pending input/*.json messages. */
  drain(log: (msg: string) => void): IpcDrainResult {
    const result: IpcDrainResult = { messages: [] };
    let files: string[];
    try {
      files = fs
        .readdirSync(this.inputDir)
        .filter((f) => f.endsWith('.json'))
        .sort();
    } catch {
      return result;
    }
    for (const file of files) {
      const filepath = path.join(this.inputDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        fs.unlinkSync(filepath);
        if (data && typeof data === 'object' && data.type === 'message' && data.text) {
          result.messages.push({
            text: String(data.text),
            images: Array.isArray(data.images) ? data.images : undefined,
            taskId: typeof data.taskId === 'string' ? data.taskId : undefined,
            sourceJid:
              typeof data.sourceJid === 'string' ? data.sourceJid : undefined,
          });
        }
      } catch (err) {
        log(
          `Failed to parse IPC input ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          fs.unlinkSync(filepath);
        } catch {
          /* ignore */
        }
      }
    }
    return result;
  }

  /**
   * Block until at least one IPC message is available, or `_close` / `_drain`
   * arrives. Resolves to:
   *   - the drained messages (non-empty array) when input/*.json appears
   *   - `null` when `_close` or `_drain` is consumed (caller should exit)
   *
   * Uses fs.watch for low-latency wakeups, falling back to a 5s poll if
   * watch is unavailable (e.g. on Docker bind-mounts where inotify can be
   * flaky).
   */
  async waitForNext(log: (msg: string) => void): Promise<PendingMessage[] | null> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (val: PendingMessage[] | null) => {
        if (done) return;
        done = true;
        watcher?.close();
        clearInterval(fallback);
        resolve(val);
      };

      const tryDrain = () => {
        if (done) return;
        if (this.consumeClose()) {
          log('_close sentinel received');
          finish(null);
          return;
        }
        if (this.consumeDrain()) {
          log('_drain sentinel received');
          finish(null);
          return;
        }
        // Discard stray _interrupt while idle — interrupt only matters during
        // an active cursor-agent run.
        if (this.consumeInterrupt()) {
          log('_interrupt while idle, ignored');
        }
        const { messages } = this.drain(log);
        if (messages.length > 0) finish(messages);
      };

      this.ensureDir();

      let watcher: fs.FSWatcher | null = null;
      try {
        watcher = fs.watch(this.inputDir, () => tryDrain());
        watcher.on('error', (err) =>
          log(`IPC watcher error: ${err.message}, falling back to poll`),
        );
      } catch (err) {
        log(
          `fs.watch failed: ${err instanceof Error ? err.message : String(err)}, fallback poll only`,
        );
      }
      const fallback: NodeJS.Timeout = setInterval(tryDrain, 5_000);
      // Initial check in case files already exist.
      tryDrain();
    });
  }
}

/** Combine drained messages into a single prompt. Mirrors agent-runner's
 * concatenation: text joined with `\n`, images flattened. The most recent
 * non-empty `taskId` and `sourceJid` are surfaced for per-turn attribution. */
export function combineMessages(
  messages: PendingMessage[],
): {
  text: string;
  images: Array<{ data: string; mimeType?: string }>;
  taskId?: string;
  sourceJid?: string;
} {
  const text = messages.map((m) => m.text).join('\n');
  const images = messages.flatMap((m) => m.images ?? []);
  let taskId: string | undefined;
  let sourceJid: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!taskId && messages[i].taskId) taskId = messages[i].taskId;
    if (!sourceJid && messages[i].sourceJid) sourceJid = messages[i].sourceJid;
    if (taskId && sourceJid) break;
  }
  return { text, images, taskId, sourceJid };
}
