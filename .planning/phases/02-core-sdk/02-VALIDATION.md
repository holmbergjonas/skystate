---
phase: 2
slug: core-sdk
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.0.18 |
| **Config file** | `packages/core/vitest.config.ts` — Wave 0 installs |
| **Quick run command** | `cd packages/core && npx vitest run` |
| **Full suite command** | `cd packages/core && npx vitest run` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/core && npx vitest run`
- **After every plan wave:** Run `cd packages/core && npx vitest run && cd ../react && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | — | setup | `cd packages/core && npx vitest run` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | CORE-01 | unit | `cd packages/core && npx vitest run src/config-cache.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | CORE-02 | unit | `cd packages/core && npx vitest run src/pubsub.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | CORE-03 | unit | `cd packages/core && npx vitest run src/http-client.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-04 | 02 | 1 | CORE-04 | unit | `cd packages/core && npx vitest run src/config-store.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/vitest.config.ts` — test configuration (match CLI pattern)
- [ ] `packages/core/eslint.config.js` — lint configuration (match CLI pattern)
- [ ] `packages/core/package.json` — add test/lint scripts, add vitest + eslint devDependencies
- [ ] Framework install: `cd packages/core && npm install --save-dev vitest@^4.0.18 eslint@^10.0.2 @eslint/js@^10.0.1 typescript-eslint@^8.56.1 globals`
- [ ] Package restructure (`packages/typescript/core/` → `packages/core/`) must happen first

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visibility re-fetch triggers in real browser | CORE-03 | `visibilitychange` not fully testable in jsdom | Switch browser tabs, verify network tab shows re-fetch |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
