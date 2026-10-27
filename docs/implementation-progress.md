# SDD ledger — plan: docs/superpowers/plans/2026-10-24-zhubo.md

- Pre-flight: empty directory, no Git repository or existing implementation.
- Interfaces: API response fields and datetime validation consumed by native mini program; keep request/response names identical.
- Ruling: use supplied workspace directly because no repository exists; no Git commits/worktree automation applies.
- Ruling: owner is the sole administrator; can promote/demote operators. Invite joins always create/reactivate ordinary member roles.
- Ruling: removed/rejoined members retain historical schedule data, but cancelled future schedules remain cancelled.
- Ruling: use UUID Idempotency-Key on create operations; scope by actor/operation and reject same key with changed payload.
- Ruling: no automatic retries on writes; keep form state and creation key until confirmed success.

## Completed work
- Task 1: complete — integration scenarios first failed for absent application, then passed against real SQLite API behavior.
- Task 2: complete — auth, private logs, companies, member roles, schedules, conflicts, idempotency, authorization revocation.
- Task 3: complete — explicit Alembic upgrade/downgrade matches model metadata; live WAL backup restored and verified; retention tested.
- Task 4: complete — two native tabs and editor/company management; Node tests cover timezone and form/network state; native WXML/WXSS compiler checks passed.
- Task 5: complete for local automated checks — independent read-only review completed; both important findings and minor stale-month aggregate fixed with regression tests.

## Findings and rulings
- Backup RED: sqlite3 context manager does not close handles; Windows refused atomic rename. Explicit closing fixed the root cause; restore test GREEN.
- Commit RED: latest FastAPI request-scoped yielded sessions sent 201 before commit failure. All database dependencies now use function scope, minimum FastAPI 0.121; commit failure returns 503 before response success.
- Native compiler RED: HTML entity escaping inside WXML expressions is not accepted by the installed native compiler. Use actual WXML operators; four templates compile GREEN.
- Reviewer finding 1: removed-member schedule editor silently selected first member. Regression RED then GREEN: index stays -1; explicit reassignment required, no historical reassignment by default.
- Reviewer finding 2: company create 5xx allowed changed payload/new key despite uncertain result. Regression RED then GREEN: original fields and key preserved for both network errors and 5xx.
- Reviewer finding 3: failed month switch retained old aggregate. Regression RED then GREEN: totals unavailable until successful reload.
- Ruling: visible daily-summary screen is optional; approved interface requires date-ordered records/monthly totals and correct Beijing daily aggregation, all implemented.
- Ruling: actual WeChat login/phone tests require real credentials and devices; remain explicitly pending in docs/acceptance.md, no false claims or production fake-login endpoint.
- Ruling: TLS/systemd timers and external backup replication supplied as reviewed deployment templates, not claimed deployed.

## Final local verification (2026-10-24)
- `.venv/Scripts/python.exe -m pytest -c backend/pytest.ini backend/tests -q`: 21 passed; one upstream Starlette TestClient/httpx deprecation warning (not an application test failure).
- `node --test miniprogram/tests/*.test.js`: 13 passed.
- `tools/check-miniprogram.ps1`: JavaScript, JSON, native WXML and WXSS checks passed.
- Runtime smoke starts a separate production-config Uvicorn process after Alembic migration: health 200, unauthenticated API 401, production /docs 404.
- No Git repository was present; no commits, branch integration, remote pushes or deployment performed.

## Follow-up: no-secret local test login (2026-10-24)
- User explicitly authorized test login without WeChat credentials.
- Added `/auth/dev`, stable namespaced test identities and login-mode claims; endpoint and issued tokens disabled outside explicitly enabled development mode.
- Frontend uses a three-account selector and clear development-test label; real WeChat flow remains selectable via config.
- Local `.env` enables test login, preserves generated JWT signing secret and all other settings. No WeChat secret required for development.
- Test accounts have no automatic roles and continue using existing authorization checks. Re-login preserves each account's identity/data.
- Updated native compiler check for both legacy NW.js and current Electron developer-tool installations.
- Verification: 26 backend tests and 16 frontend tests passed; native WXML/WXSS, JS/JSON and pip dependency checks passed. One upstream Starlette/httpx deprecation warning remains.
- Verified currently running local server: test account demo-1 login HTTP 200, authenticated /me HTTP 200. No tokens or secrets printed.
