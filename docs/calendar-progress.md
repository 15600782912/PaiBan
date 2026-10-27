# SDD ledger — plan: docs/superpowers/plans/2026-10-24-personal-calendar.md

- Pre-flight: work-log serializers change only for personal records; schedule code retains interval schema/serializer.
- Ruling: new records use explicit entry_type=duration and no synthetic timestamps; existing callers may omit entry_type for interval compatibility.
- Ruling: amounts are integer fen; income uses positive-integer half-up division per record per local day.
- Ruling: one default set is saved explicitly; quick creation refuses dirty/unsaved defaults. Manual form may depart from defaults without changing them.
- Ruling: monthly unpriced count counts distinct records, daily unpriced counts count records contributing that day.
- Ruling: rates are bounded to 100,000,000 fen/hour (1 million yuan/hour), matching frontend/backend validation and keeping client arithmetic within safe integers.
- Ruling: reject downgrade with date-duration entries; never fabricate historical start/end times or discard such records for downgrade.
- Pre-upgrade local backup created using SQLite online backup API before revision0002; original nullable-rate interval data preserved by migration tests.
- Backend: 42 tests passed, including pre-upgrade idempotency fingerprint compatibility and per-day half-fen rounding.
- Frontend: 24 tests passed; native compiler covers all WXML and all page/app WXSS plus JavaScript/JSON.
- Independent review completed: no blocking findings in privacy, migration, money arithmetic, compatibility, month generations or uncertain-create retry handling.
- Desktop visual check: activated existing WeChat developer tool; simulator shows current-user calendar and monthly summary connected to upgraded backend. Bottom-sheet pointer interaction was not verified by this desktop automation run; logic is covered by Node page harness tests.
