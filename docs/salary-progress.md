# SDD ledger — plan: docs/superpowers/plans/2026-10-24-salaries.md

- Task 1: complete. API/migration tests first failed for missing salary routes/table, then passed after implementation.
- Shared interface: old interval/duration bodies remain compatible; new UI adds salary_id and expected hourly_rate_fen. Unchanged historical edits omit both to preserve snapshot.
- Ruling: require explicit expected price when selecting a preset; mismatch returns salary_changed. Missing/deleted/foreign preset returns salary_unavailable without ownership disclosure.
- Task 2: complete. Revision0003 generates per-user distinct non-null rates incl zero, preserves all old money/time, links defaults/logs and retains salary snapshots under soft deletion.
- Task 3: complete. Salary CRUD and expected-price resolution covered by ownership, replay, stale/deleted selection, changed defaults and raw-price compatibility tests.
- Task 4: complete. Native Salary tab/list/editor and all three dropdowns implemented. Historical editors explicitly keep snapshots; empty lists never auto-select.
- Task 5: local automated/native checks complete. Local DB backed up before revision0003 upgrade. Developer-tool screenshot confirms Personal/Salary/Company navigation; mouse-driven salary editor interaction was not verified by desktop automation.
- Independent review found actor-switch state risk. RED regressions reproduced old pending salary/quick drafts submitting under a new account; fixed using actor guards, private-state reset and guarded asynchronous callbacks/confirmation continuations.
- Additional RED regressions caught late old-account read/401 responses overwriting identity or clearing a new session. Responses now check captured login token before updating session state.
- Final checks: 50 backend tests and 36 frontend tests pass; native WXML/WXSS and JS/JSON compile checks pass. Upstream TestClient deprecation and legacy CHECK-reflection warnings remain; named replacement checks and metadata migration checks pass.
