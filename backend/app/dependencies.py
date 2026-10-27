import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .common import fail
from .models import Company, Membership, User

bearer = HTTPBearer(auto_error=False)


def session(request: Request):
    # All consumers use function scope: commit must finish before an HTTP success is sent.
    with Session(request.app.state.engine, expire_on_commit=False) as db:
        try:
            # SQLite has a single writer. Acquire its lock before authorization/version reads,
            # so revocations, version checks and idempotency records commit atomically.
            if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                db.connection().exec_driver_sql('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise


def current_user(request: Request, credential: HTTPAuthorizationCredentials = Depends(bearer), db=Depends(session, scope='function')):
    if not credential:
        fail(401, 'unauthorized', '请先登录')
    try:
        payload = jwt.decode(credential.credentials, request.app.state.settings.jwt_secret,
                             algorithms=['HS256'], issuer='zhubo', options={'require': ['exp', 'sub', 'iss']})
        uid = int(payload['sub'])
    except (jwt.PyJWTError, ValueError, TypeError):
        fail(401, 'unauthorized', '登录已过期，请重新登录')
    if payload.get('login_mode') == 'development' and not request.app.state.settings.development_login_allowed:
        fail(401, 'unauthorized', '开发测试登录已关闭，请使用微信登录')
    user = db.get(User, uid)
    if not user:
        fail(401, 'unauthorized', '用户不存在')
    return user


def membership(db, cid, uid, manage=False, owner=False):
    member = db.scalar(select(Membership).where(Membership.company_id == cid,
                                                Membership.user_id == uid, Membership.active.is_(True)))
    if not member or (manage and member.role not in ('owner', 'operator')) or (owner and member.role != 'owner'):
        fail(403, 'forbidden', '无权执行此公司操作')
    return member
