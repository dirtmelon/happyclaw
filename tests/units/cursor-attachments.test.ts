/**
 * Unit tests for cursor-runner's image attachment routing.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  appendAttachmentReferences,
  ATTACHMENT_DIR_NAME,
  writeImageAttachments,
  __test__,
} from '../../container/cursor-runner/src/attachments.js';

// Minimal valid image headers (just enough for image-detector to identify).
// Real files in production will be hundreds of bytes; we only need the magic
// prefix for MIME detection in these tests.
const PNG_HEADER_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]).toString('base64');
const JPEG_HEADER_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
]).toString('base64');
const WEBP_HEADER_BASE64 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]).toString('base64');

let workspaceDir: string;
let logs: string[];
const logFn = (msg: string) => {
  logs.push(msg);
};

beforeEach(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-attach-'));
  logs = [];
});

afterEach(() => {
  try {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('mimeToExt', () => {
  test('maps known MIME types to canonical extensions', () => {
    expect(__test__.mimeToExt('image/png')).toBe('png');
    expect(__test__.mimeToExt('image/jpeg')).toBe('jpg');
    expect(__test__.mimeToExt('image/gif')).toBe('gif');
    expect(__test__.mimeToExt('image/webp')).toBe('webp');
    expect(__test__.mimeToExt('image/tiff')).toBe('tiff');
    expect(__test__.mimeToExt('image/avif')).toBe('avif');
    expect(__test__.mimeToExt('image/bmp')).toBe('bmp');
  });

  test('null and unknown MIMEs fall back to .bin', () => {
    expect(__test__.mimeToExt(null)).toBe('bin');
    expect(__test__.mimeToExt('application/json')).toBe('bin');
    expect(__test__.mimeToExt('')).toBe('bin');
  });
});

describe('writeImageAttachments — file IO', () => {
  test('empty list → no work, returns []', () => {
    const out = writeImageAttachments(workspaceDir, 'turn-1', [], logFn);
    expect(out).toEqual([]);
    expect(
      fs.existsSync(path.join(workspaceDir, ATTACHMENT_DIR_NAME)),
    ).toBe(false);
  });

  test('PNG image → png file written', () => {
    const out = writeImageAttachments(
      workspaceDir,
      'turn-1',
      [{ data: PNG_HEADER_BASE64 }],
      logFn,
    );
    expect(out.length).toBe(1);
    expect(out[0].mimeType).toBe('image/png');
    expect(out[0].relativePath).toBe(
      path.join(ATTACHMENT_DIR_NAME, 'turn-1', 'img-1.png'),
    );
    expect(fs.existsSync(out[0].absolutePath)).toBe(true);
  });

  test('multiple images → indexed filenames + correct extensions', () => {
    const out = writeImageAttachments(
      workspaceDir,
      'turn-X',
      [
        { data: PNG_HEADER_BASE64 },
        { data: JPEG_HEADER_BASE64 },
        { data: WEBP_HEADER_BASE64 },
      ],
      logFn,
    );
    expect(out.length).toBe(3);
    expect(out[0].relativePath).toContain('img-1.png');
    expect(out[1].relativePath).toContain('img-2.jpg');
    expect(out[2].relativePath).toContain('img-3.webp');
  });

  test('declared MIME used when detection fails', () => {
    const garbage = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).toString('base64');
    const out = writeImageAttachments(
      workspaceDir,
      'turn',
      [{ data: garbage, mimeType: 'image/png' }],
      logFn,
    );
    expect(out.length).toBe(1);
    expect(out[0].mimeType).toBe('image/png');
    // Detection failed, so extension comes from declared via fallback.
    expect(out[0].relativePath).toContain('.png');
  });

  test('detected MIME wins over declared (mismatch)', () => {
    // PNG header but declared as JPEG → write with detected extension.
    const out = writeImageAttachments(
      workspaceDir,
      'turn',
      [{ data: PNG_HEADER_BASE64, mimeType: 'image/jpeg' }],
      logFn,
    );
    expect(out[0].mimeType).toBe('image/png');
    expect(out[0].relativePath).toContain('.png');
  });

  test('empty data → skipped with log, no file', () => {
    const out = writeImageAttachments(
      workspaceDir,
      'turn',
      [{ data: '' }, { data: PNG_HEADER_BASE64 }],
      logFn,
    );
    expect(out.length).toBe(1);
    expect(out[0].relativePath).toContain('img-2.png'); // index preserved
    expect(logs.some((l) => l.includes('Skip image[0]'))).toBe(true);
  });

  test('turnId with unsafe characters is sanitized', () => {
    const out = writeImageAttachments(
      workspaceDir,
      '../../etc/passwd',
      [{ data: PNG_HEADER_BASE64 }],
      logFn,
    );
    expect(out.length).toBe(1);
    expect(out[0].absolutePath.startsWith(path.join(workspaceDir, ATTACHMENT_DIR_NAME))).toBe(true);
    expect(out[0].relativePath).not.toContain('..');
    expect(out[0].relativePath).not.toContain('etc/passwd');
  });

  test('per-turn subdir keeps multiple turns isolated', () => {
    writeImageAttachments(workspaceDir, 'turn-1', [{ data: PNG_HEADER_BASE64 }], logFn);
    writeImageAttachments(workspaceDir, 'turn-2', [{ data: JPEG_HEADER_BASE64 }], logFn);
    const turn1 = path.join(workspaceDir, ATTACHMENT_DIR_NAME, 'turn-1');
    const turn2 = path.join(workspaceDir, ATTACHMENT_DIR_NAME, 'turn-2');
    expect(fs.existsSync(turn1)).toBe(true);
    expect(fs.existsSync(turn2)).toBe(true);
    expect(fs.readdirSync(turn1)).toEqual(['img-1.png']);
    expect(fs.readdirSync(turn2)).toEqual(['img-1.jpg']);
  });
});

describe('appendAttachmentReferences', () => {
  test('empty attachments → unchanged prompt', () => {
    expect(appendAttachmentReferences('hello', [])).toBe('hello');
  });

  test('appends footer with relative paths + MIME + bytes', () => {
    const out = appendAttachmentReferences('Hi please look at these', [
      {
        relativePath: '.cr-attachments/turn-1/img-1.png',
        absolutePath: '/abs/.cr-attachments/turn-1/img-1.png',
        mimeType: 'image/png',
        bytes: 42,
      },
      {
        relativePath: '.cr-attachments/turn-1/img-2.jpg',
        absolutePath: '/abs/.cr-attachments/turn-1/img-2.jpg',
        mimeType: 'image/jpeg',
        bytes: 99,
      },
    ]);
    expect(out).toContain('Hi please look at these');
    expect(out).toContain('Image attachments — please read');
    expect(out).toContain('1. `./.cr-attachments/turn-1/img-1.png` (image/png, 42 bytes)');
    expect(out).toContain('2. `./.cr-attachments/turn-1/img-2.jpg` (image/jpeg, 99 bytes)');
    // Original prompt comes first, footer comes after.
    expect(out.indexOf('Hi please')).toBeLessThan(out.indexOf('Image attachments'));
  });
});
