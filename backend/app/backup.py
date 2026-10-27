"""Consistent online SQLite backups, integrity verification and 30-day retention."""
import argparse
import logging
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

PATTERN = re.compile(r'^zhubo-(\d{8}T\d{12}Z)\.db$')


def backup_database(source, output, retain_days=30):
    source, output = Path(source).resolve(), Path(output).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if retain_days < 1:
        raise ValueError('retain_days must be positive')
    output.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    target = output / ('zhubo-' + now.strftime('%Y%m%dT%H%M%S%fZ') + '.db')
    temporary = target.with_suffix('.tmp')
    try:
        # sqlite3's own context manager commits but does not close file handles.
        # Close explicitly before atomic rename, particularly on Windows.
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as live:
            with closing(sqlite3.connect(temporary)) as snapshot:
                live.backup(snapshot, pages=256, sleep=0.05)
                if snapshot.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                    raise RuntimeError('Backup integrity check failed')
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    cutoff = now - timedelta(days=retain_days)
    for candidate in output.iterdir():
        match = PATTERN.fullmatch(candidate.name)
        if not match or candidate.is_symlink() or candidate.resolve().parent != output:
            continue
        try:
            timestamp = datetime.strptime(match[1], '%Y%m%dT%H%M%S%fZ').replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if timestamp < cutoff and candidate != target:
            candidate.unlink()
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='SQLite file path')
    parser.add_argument('--output', default='backups')
    parser.add_argument('--retain-days', type=int, default=30)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    path = backup_database(args.source, args.output, args.retain_days)
    logging.info('Verified backup created: %s', path)
