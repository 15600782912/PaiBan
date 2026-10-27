from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import or_, select

from .common import BEIJING, fail, interval_values, reject_extra_query, remember, replay, serialize_interval
from .dependencies import current_user, membership, session
from .models import Company, Membership, Room, Schedule, User
from .rooms import available_room
from .schemas import BatchScheduleInput, ScheduleInput, ScheduleUpdate, VersionInput

router = APIRouter()


def schedule_view(db, row):
    room = db.get(Room, row.room_id) if row.room_id is not None else None
    flags = conflict_flags(db, row)
    return {**serialize_interval(row), 'company_id': row.company_id, 'user_id': row.user_id,
            'display_name': db.get(User, row.user_id).display_name, 'version': row.version, 'status': row.status,
            'room_id': row.room_id, 'room_name': room.name if room else None,
            'room_active': room.active if room else None, **flags}


def conflict_flags(db, row, *, personal=False):
    if row.status != 'active':
        return {'has_room_conflict': False, 'has_anchor_conflict': False, 'has_conflict': False}
    base = select(Schedule).where(Schedule.id != row.id, Schedule.status == 'active',
        Schedule.start_at < row.end_at, Schedule.end_at > row.start_at)
    room_conflict = False
    if row.room_id is not None:
        room_conflict = db.scalar(base.where(Schedule.company_id == row.company_id,
            Schedule.room_id == row.room_id).limit(1)) is not None
    anchor = base.where(Schedule.user_id == row.user_id)
    if personal:
        active_companies = select(Membership.company_id).where(
            Membership.user_id == row.user_id, Membership.active.is_(True))
        anchor = anchor.where(Schedule.company_id.in_(active_companies))
    else:
        anchor = anchor.where(Schedule.company_id == row.company_id)
    anchor_conflict = db.scalar(anchor.limit(1)) is not None
    return {'has_room_conflict': room_conflict, 'has_anchor_conflict': anchor_conflict,
            'has_conflict': room_conflict or anchor_conflict}


def date_filter(query, start_at, end_at):
    if start_at and (start_at.tzinfo is None or start_at.utcoffset() is None):
        fail(422, 'timezone', '开始时间必须带时区')
    if end_at and (end_at.tzinfo is None or end_at.utcoffset() is None):
        fail(422, 'timezone', '结束时间必须带时区')
    if start_at and end_at and end_at <= start_at:
        fail(422, 'interval', '结束时间必须晚于开始时间')
    if start_at:
        query = query.where(Schedule.end_at > int(start_at.timestamp()))
    if end_at:
        query = query.where(Schedule.start_at < int(end_at.timestamp()))
    return query.order_by(Schedule.start_at, Schedule.id)


@router.get('/companies/{cid}/schedules')
def company_schedules(cid: int, request: Request, start_at: datetime | None = None, end_at: datetime | None = None,
                      user=Depends(current_user), db=Depends(session, scope='function')):
    reject_extra_query(request, ['start_at', 'end_at'])
    member = membership(db, cid, user.id)
    query = select(Schedule).where(Schedule.company_id == cid)
    if member.role == 'member':
        query = query.where(Schedule.user_id == user.id)
    rows = db.scalars(date_filter(query, start_at, end_at)).all()
    return {'items': [schedule_view(db, row) for row in rows]}


@router.get('/my-schedules')
def my_schedules(request: Request, start_at: datetime | None = None, end_at: datetime | None = None,
                 user=Depends(current_user), db=Depends(session, scope='function')):
    reject_extra_query(request, ['start_at', 'end_at'])
    active_companies = select(Membership.company_id).where(Membership.user_id == user.id, Membership.active.is_(True))
    query = select(Schedule).where(Schedule.user_id == user.id, Schedule.company_id.in_(active_companies))
    rows = db.scalars(date_filter(query, start_at, end_at)).all()
    items = []
    for row in rows:
        item = schedule_view(db, row)
        item['company_name'] = db.get(Company, row.company_id).name
        # Look outside the display window, but disclose only the current user's
        # records. Other anchors' room occupancy is represented by booleans only.
        item.update(conflict_flags(db, row, personal=True))
        items.append(item)
    return {'items': items}


def check_company_overlap(db, cid, uid, values, confirmed, exclude=0):
    if confirmed:
        return
    conditions = [Schedule.user_id == uid]
    if values.get('room_id') is not None:
        conditions.append(Schedule.room_id == values['room_id'])
    others = db.scalars(select(Schedule).where(Schedule.company_id == cid, or_(*conditions),
        Schedule.id != exclude, Schedule.status == 'active', Schedule.start_at < values['end_at'],
        Schedule.end_at > values['start_at']).order_by(Schedule.start_at, Schedule.id)).all()
    if others:
        conflicts = []
        for other in others[:20]:
            reasons = []
            if other.user_id == uid:
                reasons.append('该主播时间重叠')
            if values.get('room_id') is not None and other.room_id == values['room_id']:
                reasons.append('同一直播间占用重叠')
            name = db.get(User, other.user_id).display_name
            start = datetime.fromtimestamp(other.start_at, BEIJING).strftime('%m-%d %H:%M')
            end = datetime.fromtimestamp(other.end_at, BEIJING).strftime('%m-%d %H:%M')
            conflicts.append(f'{"、".join(reasons)}：{name} {start} — {end}')
        suffix = f'；另有{len(others)-20}条冲突' if len(others) > 20 else ''
        fail(409, 'overlap', '；'.join(conflicts) + suffix + '。是否仍然继续安排？')


@router.post('/companies/{cid}/schedules', status_code=201)
def create_schedule(cid: int, body: ScheduleInput, idempotency_key: str | None = Header(default=None),
                    user=Depends(current_user), db=Depends(session, scope='function')):
    membership(db, cid, user.id, manage=True)
    scope = f'companies/{cid}/schedules'
    serialized = body.model_dump_json(exclude={'room_id'} if 'room_id' not in body.model_fields_set else set())
    digest, old = replay(db, user.id, scope, idempotency_key, body, serialized_body=serialized)
    if old is not None:
        return old
    membership(db, cid, body.user_id)
    values = interval_values(body)
    if body.room_id is not None:
        available_room(db, cid, body.room_id)
    values['room_id'] = body.room_id
    check_company_overlap(db, cid, body.user_id, values, body.confirm_overlap)
    row = Schedule(company_id=cid, user_id=body.user_id, **values)
    db.add(row)
    db.flush()
    result = schedule_view(db, row)
    remember(db, user.id, scope, idempotency_key, digest, result)
    return result


def check_batch_overlap(db, cid, values):
    """Collect company-local and intra-batch collisions before writing any row."""
    lo = min(item['start_at'] for item in values)
    hi = max(item['end_at'] for item in values)
    uids = {item['user_id'] for item in values}
    rids = {item['room_id'] for item in values}
    existing = db.scalars(select(Schedule).where(
        Schedule.company_id == cid, Schedule.status == 'active',
        Schedule.start_at < hi, Schedule.end_at > lo,
        or_(Schedule.user_id.in_(uids), Schedule.room_id.in_(rids)))
        .order_by(Schedule.start_at, Schedule.id)).all()
    names = {}
    conflicts = []

    def name(uid):
        if uid not in names:
            names[uid] = db.get(User, uid).display_name
        return names[uid]

    def collision(a, b):
        return (a['start_at'] < b['end_at'] and a['end_at'] > b['start_at']
                and (a['user_id'] == b['user_id'] or a['room_id'] == b['room_id']))

    def add(index, a, b, *, schedule_id=None, batch_index=None):
        reasons = []
        if a['user_id'] == b['user_id']:
            reasons.append('同一主播时间重叠')
        if a['room_id'] == b['room_id']:
            reasons.append('同一直播间时间重叠')
        conflicts.append({
            'item_index': index, 'start_at': iso_beijing(a['start_at']),
            'end_at': iso_beijing(a['end_at']), 'reasons': reasons,
            'other_display_name': name(b['user_id']),
            'other_start_at': iso_beijing(b['start_at']), 'other_end_at': iso_beijing(b['end_at']),
            'schedule_id': schedule_id, 'batch_index': batch_index})

    for index, item in enumerate(values):
        for row in existing:
            other = {'start_at': row.start_at, 'end_at': row.end_at,
                     'user_id': row.user_id, 'room_id': row.room_id}
            if collision(item, other):
                add(index, item, other, schedule_id=row.id)
        for other_index in range(index):
            other = values[other_index]
            if collision(item, other):
                add(index, item, other, batch_index=other_index)
    if not conflicts:
        return
    messages = []
    for conflict in conflicts[:20]:
        source = ('本批次第' + str(conflict['batch_index'] + 1) + '场'
                  if conflict['batch_index'] is not None else '已有排班')
        messages.append(f"第{conflict['item_index'] + 1}场 {conflict['start_at']} — {conflict['end_at']}："
                        f"{'、'.join(conflict['reasons'])}，与{source} "
                        f"{conflict['other_display_name']} {conflict['other_start_at']} — {conflict['other_end_at']}")
    if len(conflicts) > 20:
        messages.append(f'另有{len(conflicts)-20}处冲突')
    raise HTTPException(409, detail={
        'code': 'overlap', 'message': '；'.join(messages) + '。是否确认整批继续安排？',
        'conflict_count': len(conflicts), 'conflicts': conflicts[:120]})


def iso_beijing(seconds):
    return datetime.fromtimestamp(seconds, BEIJING).strftime('%Y-%m-%d %H:%M')


@router.post('/companies/{cid}/schedules/batch', status_code=201)
def create_schedule_batch(cid: int, body: BatchScheduleInput,
                          idempotency_key: str | None = Header(default=None),
                          user=Depends(current_user), db=Depends(session, scope='function')):
    # The shared write session takes BEGIN IMMEDIATE before any authorization or
    # conflict read, then commits all rows plus the replay record together.
    membership(db, cid, user.id, manage=True)
    scope = f'companies/{cid}/schedules/batch'
    digest, old = replay(db, user.id, scope, idempotency_key, body)
    if old is not None:
        return old
    values = []
    for item in body.items:
        membership(db, cid, item.user_id)
        available_room(db, cid, item.room_id)
        values.append({**interval_values(item), 'user_id': item.user_id, 'room_id': item.room_id})
    if not body.confirm_overlap:
        check_batch_overlap(db, cid, values)
    rows = [Schedule(company_id=cid, **item) for item in values]
    db.add_all(rows)
    db.flush()
    result = {'items': [schedule_view(db, row) for row in rows], 'count': len(rows)}
    remember(db, user.id, scope, idempotency_key, digest, result)
    return result


def editable(db, cid, sid, uid, version):
    membership(db, cid, uid, manage=True)
    row = db.scalar(select(Schedule).where(Schedule.id == sid, Schedule.company_id == cid))
    if not row:
        fail(404, 'not_found', '排班不存在')
    if row.version != version:
        fail(409, 'stale_version', '排班已被他人修改，请刷新后重新编辑')
    if row.status == 'cancelled':
        fail(409, 'cancelled', '已取消的排班不可修改')
    return row


@router.put('/companies/{cid}/schedules/{sid}')
def update_schedule(cid: int, sid: int, body: ScheduleUpdate, user=Depends(current_user), db=Depends(session, scope='function')):
    row = editable(db, cid, sid, user.id, body.version)
    membership(db, cid, body.user_id)
    values = interval_values(body)
    values['room_id'] = body.room_id if 'room_id' in body.model_fields_set else row.room_id
    if values['room_id'] is not None:
        available_room(db, cid, values['room_id'])
    check_company_overlap(db, cid, body.user_id, values, body.confirm_overlap, row.id)
    for key, value in values.items():
        setattr(row, key, value)
    row.user_id, row.version = body.user_id, row.version + 1
    db.flush()
    return schedule_view(db, row)


@router.post('/companies/{cid}/schedules/{sid}/cancel')
def cancel_schedule(cid: int, sid: int, body: VersionInput, user=Depends(current_user), db=Depends(session, scope='function')):
    row = editable(db, cid, sid, user.id, body.version)
    row.status, row.version = 'cancelled', row.version + 1
    db.flush()
    return schedule_view(db, row)
