"""Private work-log daily allocation and exact integer income arithmetic."""
from datetime import datetime, timedelta

from .common import BEIJING, iso


def income_fen(rate, minutes):
    return None if rate is None else (rate * minutes + 30) // 60


def daily_minutes(row, lo=None, hi=None):
    if row.entry_type == 'duration':
        stamp=int(datetime.fromisoformat(row.record_date).replace(tzinfo=BEIJING).timestamp())
        if (lo is not None and stamp < lo) or (hi is not None and stamp >= hi):
            return {}
        return {row.record_date:row.duration_minutes}
    start=max(row.start_at,lo) if lo is not None else row.start_at
    end=min(row.end_at,hi) if hi is not None else row.end_at
    result={}
    while start < end:
        local=datetime.fromtimestamp(start,BEIJING)
        midnight=local.replace(hour=0,minute=0,second=0)+timedelta(days=1)
        edge=min(end,int(midnight.timestamp()))
        result[local.strftime('%Y-%m-%d')]=(edge-start)//60
        start=edge
    return result


def serialize_log(row, lo=None, hi=None):
    full=daily_minutes(row)
    visible=daily_minutes(row,lo,hi)
    rate=row.hourly_rate_fen
    return {'id':row.id,'entry_type':row.entry_type,'record_date':row.record_date,
        'start_at':iso(row.start_at) if row.start_at is not None else None,
        'end_at':iso(row.end_at) if row.end_at is not None else None,
        'duration_minutes':row.duration_minutes,'minutes':sum(full.values()),
        'month_minutes':sum(visible.values()),'note':row.note,'hourly_rate_fen':rate,
        'salary_id':row.salary_id,'salary_name':row.salary_name,
        'income_fen':None if rate is None else sum(income_fen(rate,m) for m in full.values()),
        'month_income_fen':None if rate is None else sum(income_fen(rate,m) for m in visible.values()),
        'daily_minutes':visible,'daily_income_fen':{d:income_fen(rate,m) for d,m in visible.items()}}
