#!/usr/bin/env node
/**
 * Unit tests for Issue #275 fix:
 * auto_continue system-maintenance noise suppression
 *
 * Tests the isSystemMaintenanceNoise() function from src/utils.ts
 * (compiled to dist/utils.js).
 */

import { isSystemMaintenanceNoise } from '../dist/utils.js';

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.log(`  ❌ ${description}`);
    failed++;
  }
}

console.log('\n🔧 Issue #275 — isSystemMaintenanceNoise() unit tests\n');

// Should be treated as noise (system maintenance acks)
console.log('── Noise cases (should return true) ──');
assert('empty string → noise', isSystemMaintenanceNoise(''));
assert('"OK" → noise', isSystemMaintenanceNoise('OK'));
assert('"ok" → noise', isSystemMaintenanceNoise('ok'));
assert('"ok." → noise', isSystemMaintenanceNoise('ok.'));
assert('"OK。" → noise', isSystemMaintenanceNoise('OK。'));
assert('"好的" → noise', isSystemMaintenanceNoise('好的'));
assert('"好的。" → noise', isSystemMaintenanceNoise('好的。'));
assert('"已更新 CLAUDE.md" → noise', isSystemMaintenanceNoise('已更新 CLAUDE.md'));
assert('"已完成记忆刷新" → noise', isSystemMaintenanceNoise('已完成记忆刷新'));
assert('"已刷新" → noise', isSystemMaintenanceNoise('已刷新'));
assert('"记忆已保存" → noise', isSystemMaintenanceNoise('记忆已保存'));
assert('"Memory flush completed" → noise', isSystemMaintenanceNoise('Memory flush completed'));

// Should NOT be treated as noise (substantive user-facing content)
console.log('\n── Non-noise cases (should return false) ──');
assert(
  'Substantive continuation text → not noise',
  !isSystemMaintenanceNoise('上次我们讨论到方案选择，我建议使用方案 A，主要原因是性能更好。'),
);
assert(
  'Task resumption > 30 chars → not noise',
  !isSystemMaintenanceNoise('Phase 1-3 已全部完成，目前进入 Phase 4 的集成测试阶段。'),
);
assert(
  '"继续执行中..." → not noise (>30 chars)',
  !isSystemMaintenanceNoise('继续执行中，当前正在处理文件合并，请稍候。'),
);
assert(
  'Normal short reply that is not a noise pattern → not noise',
  !isSystemMaintenanceNoise('好的，继续方案设计'),
);

console.log(`\n==================================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`==================================================\n`);

if (failed > 0) process.exit(1);
