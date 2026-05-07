/**
 * Image attachment routing for cursor-runner.
 *
 * cursor-agent CLI accepts only a single text prompt — no `--image <path>`
 * or base64 flag. To carry IPC-attached images into a Cursor turn we:
 *   1. Decode the base64 payload, detect MIME via shared/image-detector,
 *      and pick the canonical file extension.
 *   2. Write each image to
 *      `<workspaceGroup>/.cr-attachments/<turnId>/img-N.<ext>`.
 *   3. Append a clearly-marked footer to the user prompt naming the
 *      relative file paths so cursor-agent can `Read` (or use its built-in
 *      vision) them as part of the turn.
 *
 * cursor-agent's underlying multimodal model (Sonnet 4.6 1M and similar)
 * can ingest images via the file system using its built-in tools. The
 * model decides whether to use its vision capability based on the file
 * paths it sees in the prompt — we just have to make those paths
 * findable.
 *
 * Cleanup: each turn writes to a fresh subdirectory keyed by `turnId`, so
 * old turns remain on disk for inspection. Operators can reap them via a
 * cron or rely on group reset wiping the entire workspace. We deliberately
 * do not auto-delete: persisted images double as a debug aid for the
 * "agent looked but did not see the image" failure mode.
 */
import fs from 'fs';
import path from 'path';

import { detectImageMimeTypeFromBase64Strict } from './image-detector.js';

/** Directory name (relative to workspace) that holds per-turn image files. */
export const ATTACHMENT_DIR_NAME = '.cr-attachments';

/** Map a detected MIME to the canonical file extension. */
function mimeToExt(mime: string | null): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    case 'image/tiff': return 'tiff';
    case 'image/avif': return 'avif';
    case 'image/bmp': return 'bmp';
    default: return 'bin';
  }
}

export interface ImageInput {
  data: string; // base64
  mimeType?: string;
}

export interface WrittenAttachment {
  /** Path relative to workspaceGroup (suitable for prompt injection). */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  /** Detected (or declared) MIME type. */
  mimeType: string;
  /** Number of bytes written. */
  bytes: number;
}

/**
 * Write all images for a turn to `<workspaceGroup>/.cr-attachments/<turnId>/`
 * and return the relative paths suitable for prompt injection. Failures on
 * individual images are logged via `log` but do not abort the turn — a turn
 * with one corrupt attachment should still proceed with the remaining ones.
 */
export function writeImageAttachments(
  workspaceGroup: string,
  turnId: string,
  images: ImageInput[],
  log: (msg: string) => void,
): WrittenAttachment[] {
  if (!images || images.length === 0) return [];
  // Sanitize turnId: strip dots (avoid leftover `..` after slash → underscore
  // replacement) and limit to a single sub-directory level.
  const safeTurnId = turnId
    .replace(/\.+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 64);
  const dir = path.join(workspaceGroup, ATTACHMENT_DIR_NAME, safeTurnId);
  fs.mkdirSync(dir, { recursive: true });

  const written: WrittenAttachment[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img || typeof img.data !== 'string' || img.data.length === 0) {
      log(`Skip image[${i}]: empty data`);
      continue;
    }
    const detected = detectImageMimeTypeFromBase64Strict(img.data);
    const declared =
      typeof img.mimeType === 'string' && img.mimeType.startsWith('image/')
        ? img.mimeType.toLowerCase()
        : null;
    // Prefer detected when present; fall back to declared, then 'image/jpeg'.
    const mimeType = detected || declared || 'image/jpeg';
    const ext = mimeToExt(detected || declared);
    const filename = `img-${i + 1}.${ext}`;
    const abs = path.join(dir, filename);
    let buffer: Buffer;
    try {
      buffer = Buffer.from(img.data, 'base64');
    } catch (err) {
      log(
        `Skip image[${i}]: base64 decode failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (buffer.length === 0) {
      log(`Skip image[${i}]: decoded buffer empty`);
      continue;
    }
    try {
      fs.writeFileSync(abs, buffer);
    } catch (err) {
      log(
        `Skip image[${i}]: write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    written.push({
      relativePath: path.join(ATTACHMENT_DIR_NAME, safeTurnId, filename),
      absolutePath: abs,
      mimeType,
      bytes: buffer.length,
    });
  }
  return written;
}

/**
 * Append a footer to the prompt naming all attachments. cursor-agent's
 * multimodal-capable models (claude-4.6-sonnet-medium, etc.) recognize
 * `./<path>` references and route them through their built-in vision tool.
 */
export function appendAttachmentReferences(
  prompt: string,
  attachments: WrittenAttachment[],
): string {
  if (attachments.length === 0) return prompt;
  const lines = [
    '',
    '---',
    `[Image attachments — please read and analyze the following ${attachments.length} image file(s) using your built-in tools]`,
    ...attachments.map(
      (a, i) =>
        `${i + 1}. \`./${a.relativePath}\` (${a.mimeType}, ${a.bytes} bytes)`,
    ),
  ];
  return prompt + '\n' + lines.join('\n');
}

// Test helpers.
export const __test__ = { mimeToExt };
