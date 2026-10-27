from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import select

from .common import fail, reject_extra_query, remember, replay
from .dependencies import current_user, membership, session
from .models import Room
from .schemas import RoomInput, RoomUpdate

router = APIRouter()


def room_view(row):
    return {'id': row.id, 'company_id': row.company_id, 'name': row.name, 'active': row.active}


def available_room(db, cid, rid):
    row = db.scalar(select(Room).where(Room.id == rid, Room.company_id == cid))
    if row is None:
        fail(404, 'room_unavailable', '直播间不存在或不属于该公司')
    if not row.active:
        fail(409, 'room_inactive', '直播间已停用，请选择其他有效直播间')
    return row


def check_name(db, cid, name, exclude=0):
    if db.scalar(select(Room.id).where(Room.company_id == cid, Room.name == name, Room.id != exclude)):
        fail(409, 'room_name_exists', '该公司已有同名直播间，请使用其他名称')


@router.get('/companies/{cid}/rooms')
def list_rooms(cid: int, request: Request, user=Depends(current_user), db=Depends(session, scope='function')):
    membership(db, cid, user.id)
    reject_extra_query(request, [])
    rows = db.scalars(select(Room).where(Room.company_id == cid).order_by(Room.id)).all()
    return {'items': [room_view(row) for row in rows]}


@router.post('/companies/{cid}/rooms', status_code=201)
def create_room(cid: int, body: RoomInput, idempotency_key: str | None = Header(default=None),
                user=Depends(current_user), db=Depends(session, scope='function')):
    membership(db, cid, user.id, manage=True)
    scope = f'companies/{cid}/rooms'
    digest, old = replay(db, user.id, scope, idempotency_key, body)
    if old is not None:
        return old
    check_name(db, cid, body.name)
    row = Room(company_id=cid, name=body.name)
    db.add(row)
    db.flush()
    result = room_view(row)
    remember(db, user.id, scope, idempotency_key, digest, result)
    return result


@router.patch('/companies/{cid}/rooms/{rid}')
def update_room(cid: int, rid: int, body: RoomUpdate, user=Depends(current_user), db=Depends(session, scope='function')):
    membership(db, cid, user.id, manage=True)
    row = db.scalar(select(Room).where(Room.id == rid, Room.company_id == cid))
    if row is None:
        fail(404, 'room_unavailable', '直播间不存在或不属于该公司')
    if 'name' in body.model_fields_set:
        check_name(db, cid, body.name, rid)
        row.name = body.name
    if 'active' in body.model_fields_set:
        row.active = body.active
    db.flush()
    return room_view(row)
