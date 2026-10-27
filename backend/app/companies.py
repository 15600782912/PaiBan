import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy import select, update

from .common import fail, remember, replay
from .dependencies import current_user, membership, session
from .models import Company, Membership, Schedule, User
from .schemas import CompanyInput, JoinInput, RoleInput

router = APIRouter(prefix='/companies')


def invite_code():
    return secrets.token_hex(6).upper()


def company_view(company, member):
    result = {'id': company.id, 'name': company.name, 'role': member.role,
              'user_id': member.user_id, 'membership_id': member.id}
    if member.role == 'owner':
        result['invite_code'] = company.invite_code
    return result


@router.get('')
def companies(user=Depends(current_user), db=Depends(session, scope='function')):
    rows = db.execute(select(Company, Membership).join(Membership).where(
        Membership.user_id == user.id, Membership.active.is_(True)).order_by(Company.id)).all()
    return {'items': [company_view(co, member) for co, member in rows]}


@router.post('', status_code=201)
def create_company(body: CompanyInput, idempotency_key: str | None = Header(default=None),
                   user=Depends(current_user), db=Depends(session, scope='function')):
    digest, old = replay(db, user.id, 'companies', idempotency_key, body)
    if old is not None:
        # Do not replay a previously rotated invitation secret.
        co = db.get(Company, old['id'])
        return company_view(co, membership(db, co.id, user.id, owner=True))
    co = Company(name=body.name, owner_id=user.id, invite_code=invite_code())
    db.add(co)
    db.flush()
    member = Membership(company_id=co.id, user_id=user.id, role='owner')
    db.add(member)
    db.flush()
    result = company_view(co, member)
    remember(db, user.id, 'companies', idempotency_key, digest, result)
    return result


@router.post('/join')
def join_company(body: JoinInput, user=Depends(current_user), db=Depends(session, scope='function')):
    co = db.scalar(select(Company).where(Company.invite_code == body.invite_code.upper()))
    if not co:
        fail(404, 'invite_invalid', '邀请码无效或已被重置')
    member = db.scalar(select(Membership).where(Membership.company_id == co.id, Membership.user_id == user.id))
    if not member:
        member = Membership(company_id=co.id, user_id=user.id, role='member')
        db.add(member)
    elif not member.active:
        member.active, member.role = True, 'member'
    db.flush()
    return company_view(co, member)


@router.patch('/{cid}')
def rename_company(cid: int, body: CompanyInput, user=Depends(current_user), db=Depends(session, scope='function')):
    member = membership(db, cid, user.id, owner=True)
    co = db.get(Company, cid)
    co.name = body.name
    db.flush()
    return company_view(co, member)


@router.post('/{cid}/invite/reset')
def reset_invite(cid: int, user=Depends(current_user), db=Depends(session, scope='function')):
    membership(db, cid, user.id, owner=True)
    co = db.get(Company, cid)
    co.invite_code = invite_code()
    db.flush()
    return {'invite_code': co.invite_code}


@router.get('/{cid}/members')
def members(cid: int, user=Depends(current_user), db=Depends(session, scope='function')):
    membership(db, cid, user.id, manage=True)
    rows = db.execute(select(Membership, User).join(User).where(Membership.company_id == cid,
                      Membership.active.is_(True)).order_by(Membership.id)).all()
    return {'items': [{'user_id': u.id, 'display_name': u.display_name, 'role': m.role} for m, u in rows]}


@router.patch('/{cid}/members/{uid}')
def change_role(cid: int, uid: int, body: RoleInput, user=Depends(current_user), db=Depends(session, scope='function')):
    membership(db, cid, user.id, owner=True)
    target = membership(db, cid, uid)
    if target.role == 'owner':
        fail(403, 'owner_protected', '不能修改创建者角色')
    target.role = body.role
    db.flush()
    return {'user_id': uid, 'role': target.role}


def deactivate(db, cid, uid):
    target = membership(db, cid, uid)
    if target.role == 'owner':
        fail(403, 'owner_protected', '公司创建者不可退出或被移除')
    target.active = False
    now = int(datetime.now(timezone.utc).timestamp())
    db.execute(update(Schedule).where(Schedule.company_id == cid, Schedule.user_id == uid,
               Schedule.start_at > now, Schedule.status == 'active').values(status='cancelled', version=Schedule.version + 1))
    db.flush()


@router.delete('/{cid}/members/{uid}', status_code=204)
def remove_member(cid: int, uid: int, user=Depends(current_user), db=Depends(session, scope='function')):
    membership(db, cid, user.id, owner=True)
    deactivate(db, cid, uid)
    return Response(status_code=204)


@router.post('/{cid}/leave', status_code=204)
def leave_company(cid: int, user=Depends(current_user), db=Depends(session, scope='function')):
    deactivate(db, cid, user.id)
    return Response(status_code=204)
