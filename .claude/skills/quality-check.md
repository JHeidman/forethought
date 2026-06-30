---
name: quality-check
description: Run full quality check — functional tests + security review in parallel. Use after deploys or on demand.
---

Run both quality agents in parallel:

1. Dispatch a subagent to run the functional tests:
   - Run: `node scripts/functional-test.mjs` from `C:\Users\jhber\dev\forethought`
   - Report results and save to `.claude/findings/`

2. Dispatch a subagent to run the security review:
   - Follow the instructions in `.claude/skills/security-review.md`
   - Save findings to `.claude/findings/`

Dispatch both agents simultaneously (parallel). When both complete:
- Summarize: X functional tests passed/failed, Y security issues found (Z critical)
- If any CRITICAL security finding: flag it prominently
- If any functional test failed: flag it prominently
- Tell the user where the full reports are saved
