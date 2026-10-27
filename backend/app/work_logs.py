from datetime import datetime

from fastapi import APIRouter, Depends, Header, Request, Response
from sqlalchemy import and_, or_, select

from .common import BEIJING, fail, interval_values, month_bounds, reject_extra_query, remember, replay
from .dependencies import current_user, session
from .models import Salary, WorkLog, WorkLogDefaults
from .salaries import selected_price
from .schemas import WorkLogDefaultsInput, WorkLogDurationInput, WorkLogIntervalInput
from .work_log_math import serialize_log

router = APIRouter()
WorkLogInput = WorkLogIntervalInput | WorkLogDurationInput


def owned(db, log_id, uid):
    row = db.scalar(select(WorkLog).where(WorkLog.id == log_id, WorkLog.user_id == uid))
    if not row:
        fail(404, 'not_found', '工时记录不存在')
    return row


def record_values(body):
    if body.entry_type == 'duration':
        return {'entry_type':'duration','record_date':body.record_date,'duration_minutes':body.duration_minutes,
                'start_at':None,'end_at':None,'note':body.note}
    return {'entry_type':'interval','record_date':None,'duration_minutes':None,**interval_values(body)}


def check_overlap(db, uid, values, confirmed, exclude=0):
    if confirmed:
        return
    query=select(WorkLog.id).where(WorkLog.user_id == uid,WorkLog.id != exclude)
    if values['entry_type']=='duration':
        lo=int(datetime.fromisoformat(values['record_date']).replace(tzinfo=BEIJING).timestamp())
        hi=lo+86400
        condition=or_(WorkLog.record_date == values['record_date'],
                      and_(WorkLog.start_at < hi, WorkLog.end_at > lo))
        message='该日期已有工时，确认后将追加一笔并累计工时和收入'
    else:
        first=datetime.fromtimestamp(values['start_at'],BEIJING).strftime('%Y-%m-%d')
        last=datetime.fromtimestamp(values['end_at']-1,BEIJING).strftime('%Y-%m-%d')
        condition=or_(and_(WorkLog.start_at < values['end_at'],WorkLog.end_at > values['start_at']),
                      and_(WorkLog.entry_type=='duration',WorkLog.record_date>=first,WorkLog.record_date<=last))
        message='与已有工时重叠或同日已有按时长记录，确认后将累计工时和收入'
    if db.scalar(query.where(condition).limit(1)):
        fail(409,'overlap',message)


@router.get('/me/work-log-defaults')
def get_defaults(request: Request,user=Depends(current_user),db=Depends(session,scope='function')):
    reject_extra_query(request,[])
    row=db.get(WorkLogDefaults,user.id)
    return defaults_view(db,row)


def defaults_view(db,row):
    salary=db.get(Salary,row.salary_id) if row and row.salary_id else None
    valid=salary is not None and not salary.deleted and salary.user_id==row.user_id
    return {'hourly_rate_fen':salary.hourly_rate_fen if valid else row.hourly_rate_fen if row else None,
            'duration_minutes':row.duration_minutes if row else None,'note':row.note if row else '',
            'salary_id':salary.id if valid else None,'salary_name':salary.name if valid else None}


@router.put('/me/work-log-defaults')
def save_defaults(body: WorkLogDefaultsInput,user=Depends(current_user),db=Depends(session,scope='function')):
    values=body.model_dump()
    if body.salary_id is not None:
        price=selected_price(db,user.id,body)
        values.update({key:price[key] for key in ['salary_id','hourly_rate_fen']})
    row=db.get(WorkLogDefaults,user.id)
    if not row:
        row=WorkLogDefaults(user_id=user.id,**values)
        db.add(row)
    else:
        for key,value in values.items():
            setattr(row,key,value)
    db.flush()
    return defaults_view(db,row)


@router.get('/work-logs')
def list_logs(request: Request, month: str | None = None, user=Depends(current_user), db=Depends(session, scope='function')):
    reject_extra_query(request, ['month'])
    month = month or datetime.now(BEIJING).strftime('%Y-%m')
    lo, hi = month_bounds(month)
    first=datetime.fromtimestamp(lo,BEIJING).strftime('%Y-%m-%d')
    after=datetime.fromtimestamp(hi,BEIJING).strftime('%Y-%m-%d')
    rows = db.scalars(select(WorkLog).where(WorkLog.user_id == user.id,or_(
        and_(WorkLog.start_at < hi,WorkLog.end_at > lo),
        and_(WorkLog.record_date >= first,WorkLog.record_date < after)))).all()
    daily, money, unpriced, items = {}, {}, {}, []
    for row in rows:
        item=serialize_log(row,lo,hi)
        items.append(item)
        for day,minutes in item['daily_minutes'].items():
            daily[day]=daily.get(day,0)+minutes
            money.setdefault(day,0)
            if row.hourly_rate_fen is None:
                unpriced[day]=unpriced.get(day,0)+1
            else:
                money[day]+=item['daily_income_fen'][day]
    items.sort(key=lambda item:(item['record_date'] or item['start_at'],item['id']),reverse=True)
    return {'month': month, 'items': items, 'daily_minutes': daily, 'total_minutes': sum(daily.values()),
            'daily_income_fen':money,'total_income_fen':sum(money.values()),'daily_unpriced_count':unpriced,
            'unpriced_count':sum(row.hourly_rate_fen is None for row in rows)}


@router.get('/work-logs/{log_id}')
def get_log(log_id: int, user=Depends(current_user), db=Depends(session, scope='function')):
    return serialize_log(owned(db, log_id, user.id))


@router.post('/work-logs', status_code=201)
def create_log(body: WorkLogInput, idempotency_key: str | None = Header(default=None),
               user=Depends(current_user), db=Depends(session, scope='function')):
    excluded=set() if 'salary_id' in body.model_fields_set else {'salary_id'}
    if body.entry_type=='interval' and not {'entry_type','hourly_rate_fen'}.intersection(body.model_fields_set):
        excluded.update({'entry_type','hourly_rate_fen'})
    legacy_body=body.model_dump_json(exclude=excluded)
    digest, old = replay(db, user.id, 'work-logs', idempotency_key, body, serialized_body=legacy_body)
    if old is not None:
        return old
    values = record_values(body)
    pricing=selected_price(db,user.id,body) if body.salary_id is not None else {'hourly_rate_fen':body.hourly_rate_fen}
    check_overlap(db, user.id, values, body.confirm_overlap)
    row = WorkLog(user_id=user.id, **pricing, **values)
    db.add(row)
    db.flush()
    result = serialize_log(row)
    remember(db, user.id, 'work-logs', idempotency_key, digest, result)
    return result


@router.put('/work-logs/{log_id}')
def update_log(log_id: int, body: WorkLogInput, user=Depends(current_user), db=Depends(session, scope='function')):
    row = owned(db, log_id, user.id)
    values = record_values(body)
    pricing=selected_price(db,user.id,body) if body.salary_id is not None else None
    check_overlap(db, user.id, values, body.confirm_overlap, row.id)
    for key, value in values.items():
        setattr(row, key, value)
    if pricing is not None:
        for key,value in pricing.items():
            setattr(row,key,value)
    elif 'hourly_rate_fen' in body.model_fields_set:
        if row.hourly_rate_fen!=body.hourly_rate_fen or 'salary_id' in body.model_fields_set:
            row.salary_id=None;row.salary_name=None
        row.hourly_rate_fen=body.hourly_rate_fen
    db.flush()
    return serialize_log(row)


@router.delete('/work-logs/{log_id}', status_code=204)
def delete_log(log_id: int, user=Depends(current_user), db=Depends(session, scope='function')):
    db.delete(owned(db, log_id, user.id))
    return Response(status_code=204)
