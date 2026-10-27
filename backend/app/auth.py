from datetime import datetime, timedelta, timezone

import httpx
import jwt
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from .common import fail
from .dependencies import current_user, session
from .models import User
from .schemas import DevLoginInput, LoginInput, ProfileInput

router = APIRouter()


def exchange_wechat(settings, code):
    if not settings.wechat_app_id or not settings.wechat_app_secret:
        fail(503, 'wechat_config', '服务器尚未配置微信登录')
    try:
        response = httpx.get('https://api.weixin.qq.com/sns/jscode2session', params={
            'appid': settings.wechat_app_id, 'secret': settings.wechat_app_secret,
            'js_code': code, 'grant_type': 'authorization_code'}, timeout=8)
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError):
        fail(502, 'wechat_unavailable', '微信登录暂不可用，请重试')
    if not isinstance(data, dict) or not data.get('openid') or data.get('errcode'):
        fail(401, 'wechat_code', '微信登录凭证无效，请重试')
    return data


@router.post('/auth/wechat')
def login(body: LoginInput, request: Request, db=Depends(session, scope='function')):
    data = request.app.state.exchange_code(body.code)
    if not isinstance(data, dict) or not isinstance(data.get('openid'), str) or not data['openid']:
        fail(401, 'wechat_code', '微信登录凭证无效')
    return issue_session(db, request.app.state.settings, data['openid'], body.display_name)


def issue_session(db, settings, openid, display_name, login_mode='wechat'):
    user = db.scalar(select(User).where(User.openid == openid))
    if not user:
        user = User(openid=openid, display_name=display_name)
        db.add(user)
        db.flush()
    now = datetime.now(timezone.utc)
    token = jwt.encode({'sub': str(user.id), 'iss': 'zhubo', 'iat': now, 'login_mode': login_mode,
                        'exp': now + timedelta(days=settings.token_days)}, settings.jwt_secret, algorithm='HS256')
    return {'access_token': token, 'token_type': 'bearer', 'user': {'id': user.id, 'display_name': user.display_name}}


@router.post('/auth/dev')
def development_login(body: DevLoginInput, request: Request, db=Depends(session, scope='function')):
    settings = request.app.state.settings
    if not settings.development_login_allowed:
        fail(404, 'not_found', '接口不存在')
    # Separate namespace prevents a chosen test-account name from impersonating a WeChat identity.
    return issue_session(db, settings, 'dev:' + body.account, body.display_name, login_mode='development')


@router.get('/me')
def me(user=Depends(current_user)):
    return {'id': user.id, 'display_name': user.display_name}


@router.patch('/me')
def update_profile(body: ProfileInput, user=Depends(current_user), db=Depends(session, scope='function')):
    user.display_name = body.display_name
    db.flush()
    return {'id': user.id, 'display_name': user.display_name}
