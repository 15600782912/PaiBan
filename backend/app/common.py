import hashlib
import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request
from sqlalchemy import select

from .models import Idempotency

BEIJING = timezone(timedelta(hours=8))


def fail(status, code, message):
    raise HTTPException(status, detail={'code': code, 'message': message})


def iso(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z')


def serialize_interval(row):
    return {'id': row.id, 'start_at': iso(row.start_at), 'end_at': iso(row.end_at),
            'note': row.note, 'minutes': (row.end_at - row.start_at) // 60}


def interval_values(body):
    return {'start_at': int(body.start_at.timestamp()), 'end_at': int(body.end_at.timestamp()), 'note': body.note}


def reject_extra_query(request: Request, allowed):
    if set(request.query_params) - set(allowed):
        fail(422, 'query', '不支持的查询参数')


def replay(db, uid, scope, key, body, *, serialized_body=None):
    if not key or len(key) > 100 or not key.strip():
        fail(422, 'idempotency_key', '创建操作需要有效的 Idempotency-Key')
    digest = hashlib.sha256((serialized_body if serialized_body is not None else body.model_dump_json()).encode()).hexdigest()
    old = db.scalar(select(Idempotency).where(Idempotency.user_id == uid, Idempotency.scope == scope,
                                             Idempotency.key == key))
    if old:
        if old.digest != digest:
            fail(409, 'idempotency_mismatch', '重复请求的内容不一致，请重新操作')
        return digest, json.loads(old.response)
    return digest, None


def remember(db, uid, scope, key, digest, response):
    db.add(Idempotency(user_id=uid, scope=scope, key=key, digest=digest,
                       response=json.dumps(response, ensure_ascii=False)))


def month_bounds(month):
    try:
        start = datetime.strptime(month, '%Y-%m').replace(tzinfo=BEIJING)
        if start.strftime('%Y-%m') != month or not 2000 <= start.year <= 2100:
            raise ValueError()
        end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    except ValueError:
        fail(422, 'month', '月份格式应为 YYYY-MM，年份 2000–2100')
    return int(start.timestamp()), int(end.timestamp())
