# 个人工时月历与快捷打卡 Implementation Plan

> Use superpowers:executing-plans inline; implement each behavior under test-driven-development, then one independent review.

**Goal:** Implement the user's approved calendar, private income, one saved default and confirmable quick/manual date-duration entries.
**Architecture:** Extend existing work_logs with an explicit interval/duration type, optional integer-fen rate, and a per-user defaults table. Keep schedules unchanged. Personal page uses native calendar and bottom sheet; original editor handles legacy intervals with optional rate.
**Spec:** User-approved plan in this conversation, 2026-10-24.

## Global constraints
- Private per-user data, existing records retained; no fabricated start/end for duration entries.
- Minute precision, 1..1440 duration minutes, nonnegative two-decimal yuan rate, income rounded half-up per record per Beijing day.
- Old records are unpriced until edited; changing defaults must not reprice old records.
- Same-day additional creation requires confirmation; network retries preserve body/key.
- No Git repository exists; work in the supplied checkout without branch/commit automation.

## Tasks and verification
1. Write failing API and migration tests for duration records, cents, default isolation, same-day confirmation, legacy preservation and cross-month totals. Run pytest RED.
2. Implement migration 0002, schemas, personal defaults and work-log service; run pytest GREEN. Interval request compatibility remains; shared schedule serializers/validators unchanged.
3. Write failing Node tests for calendar, cents parsing, selected-day split, default-dirty gating and uncertain save retries; implement pure helpers and personal page state.
4. Implement native calendar/header/default fields and safe bottom sheet, legacy rate editor. Compile WXML/WXSS and run Node tests.
5. Back up local DB before migration, apply upgrade, run local smoke checks; independent review; fix findings under tests; full suites and native compiler checks.

## Review focus
- Days with mixed priced/unpriced records and half-fen rounding.
- Legacy cross-month record editing must preserve missing price until explicitly entered.
- Account switching, month-response races and saved defaults with unsaved edits.
- New creations after another client has added a same-day entry.
- Retrying accepted writes after a response was lost, including a confirmed overlap body.
