from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings


@pytest.fixture
def client(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'test.db'}", jwt_secret="test-secret-" * 5,
                        wechat_app_id="test", wechat_app_secret="test", environment="test")
    def exchange(code):
        return {"openid": f"openid-{code}"}
    app = create_app(settings, exchange_code=exchange, initialize_schema=True)
    with TestClient(app) as c:
        yield c


def login(c, name):
    r = c.post('/api/v1/auth/wechat', json={"code": name, "display_name": name})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def create_company(c, h, name="直播公司", key="company-1"):
    r = c.post('/api/v1/companies', headers={**h, "Idempotency-Key": key}, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def join(c, h, company):
    r = c.post('/api/v1/companies/join', headers=h, json={"invite_code": company['invite_code']})
    assert r.status_code == 200, r.text
    return r.json()


def interval(start="2030-01-31T23:30:00+08:00", end="2030-02-01T01:00:00+08:00", **extra):
    return {"start_at": start, "end_at": end, "note": "直播", **extra}


def add_log(c, h, key="log-1", **extra):
    return c.post('/api/v1/work-logs', headers={**h, "Idempotency-Key": key}, json=interval(**extra))


def test_login_requires_real_session_and_authenticated_requests(client):
    assert client.get('/api/v1/work-logs').status_code == 401
    h = login(client, '甲')
    assert client.get('/api/v1/me', headers=h).json()['display_name'] == '甲'
    assert client.get('/api/v1/me', headers={"Authorization": "Bearer broken"}).status_code == 401


def test_personal_logs_are_private_and_split_at_beijing_month_boundary(client):
    a, b = login(client, '甲'), login(client, '乙')
    company = create_company(client, b)
    join(client, a, company)
    r = add_log(client, a)
    assert r.status_code == 201, r.text
    log = r.json()
    assert log['minutes'] == 90
    assert client.get('/api/v1/work-logs?month=2030-01', headers=b).json()['items'] == []
    assert client.get('/api/v1/work-logs?month=2030-01', headers=a).json()['total_minutes'] == 30
    assert client.get('/api/v1/work-logs?month=2030-02', headers=a).json()['total_minutes'] == 60
    assert client.put(f"/api/v1/work-logs/{log['id']}", headers=b, json=interval()).status_code == 404
    assert client.delete(f"/api/v1/work-logs/{log['id']}", headers=b).status_code == 404
    assert client.get('/api/v1/work-logs?user_id=1', headers=b).status_code == 422
    r = client.put(f"/api/v1/work-logs/{log['id']}", headers=a,
                   json=interval(end="2030-02-01T02:00:00+08:00"))
    assert r.status_code == 200
    assert r.json()['minutes'] == 150
    assert client.delete(f"/api/v1/work-logs/{log['id']}", headers=a).status_code == 204


def test_overlap_confirmation_and_idempotency(client):
    h = login(client, '甲')
    r = add_log(client, h)
    assert r.status_code == 201
    assert add_log(client, h).json()['id'] == r.json()['id']
    assert add_log(client, h, note="different").status_code == 409
    r = add_log(client, h, key='second')
    assert r.status_code == 409 and r.json()['detail']['code'] == 'overlap'
    assert add_log(client, h, key='second', confirm_overlap=True).status_code == 201
    assert client.get('/api/v1/work-logs?month=2030-02', headers=h).json()['total_minutes'] == 120
    assert add_log(client, h, key='adjacent', start="2030-02-01T01:00:00+08:00",
                   end="2030-02-01T02:00:00+08:00").status_code == 201


@pytest.mark.parametrize('payload', [
    interval(start="2030-01-01T00:00:00", end="2030-01-01T01:00:00"),
    interval(end="2030-01-31T23:30:00+08:00"),
    interval(start="2030-01-31T23:30:01+08:00"),
    interval(start="2030-01-31T23:30:00.000001+08:00"),
])
def test_invalid_intervals_rejected(client, payload):
    h = login(client, '甲')
    assert client.post('/api/v1/work-logs', headers={**h, 'Idempotency-Key': 'bad'}, json=payload).status_code == 422


def test_company_roles_invites_and_owner_protection(client):
    owner, op, member, outsider = [login(client, n) for n in ['老板','运营','主播','外人']]
    company = create_company(client, owner)
    cid = company['id']
    op_join = join(client, op, company)
    member_join = join(client, member, company)
    assert join(client, member, company)['membership_id'] == member_join['membership_id']
    assert client.get(f'/api/v1/companies/{cid}/members', headers=member).status_code == 403
    assert client.get(f'/api/v1/companies/{cid}/members', headers=outsider).status_code == 403
    path = f"/api/v1/companies/{cid}/members/{op_join['user_id']}"
    assert client.patch(path, headers=owner, json={'role':'operator'}).status_code == 200
    assert client.get(f'/api/v1/companies/{cid}/members', headers=op).status_code == 200
    assert client.patch(f"/api/v1/companies/{cid}/members/{member_join['user_id']}", headers=op,
                        json={'role':'operator'}).status_code == 403
    assert client.post(f'/api/v1/companies/{cid}/leave', headers=owner).status_code == 403
    old_code = company['invite_code']
    new_code = client.post(f'/api/v1/companies/{cid}/invite/reset', headers=owner).json()['invite_code']
    assert new_code != old_code
    assert client.post('/api/v1/companies/join', headers=outsider, json={'invite_code':old_code}).status_code == 404
    assert client.patch(path, headers=owner, json={'role':'member'}).status_code == 200
    assert client.get(f'/api/v1/companies/{cid}/members', headers=op).status_code == 403


def schedule(c, owner, cid, uid, key='s1', **extra):
    return c.post(f'/api/v1/companies/{cid}/schedules', headers={**owner,'Idempotency-Key':key},
                  json=interval(user_id=uid, **extra))


def test_schedule_permissions_versions_and_cross_company_privacy(client):
    a, b, anchor, other = [login(client, n) for n in ['A老板','B老板','主播','其他主播']]
    ca, cb = create_company(client, a), create_company(client, b)
    uid = join(client, anchor, ca)['user_id']
    join(client, anchor, cb)
    join(client, other, ca)
    r = schedule(client, a, ca['id'], uid)
    assert r.status_code == 201, r.text
    s = r.json()
    assert schedule(client, a, ca['id'], uid).json()['id'] == s['id']
    assert schedule(client, anchor, ca['id'], uid, key='forbidden').status_code == 403
    assert client.get(f"/api/v1/companies/{ca['id']}/schedules", headers=other).json()['items'] == []
    assert client.get(f"/api/v1/companies/{ca['id']}/schedules?user_id={uid}", headers=other).status_code == 422
    cross = schedule(client, b, cb['id'], uid)
    assert cross.status_code == 201
    # Management responses expose only local conflict booleans; the anchor's
    # schedule in the other company must not affect them or expose details.
    assert cross.json()['has_conflict'] is False
    assert cross.json()['has_anchor_conflict'] is False
    assert cross.json()['has_room_conflict'] is False
    mine = client.get('/api/v1/my-schedules', headers=anchor).json()['items']
    assert len(mine) == 2 and all(x['has_conflict'] for x in mine)
    assert not any(x['has_conflict'] for x in client.get(
        f"/api/v1/companies/{ca['id']}/schedules", headers=a).json()['items'])
    assert schedule(client, a, ca['id'], uid, key='overlap').status_code == 409
    path = f"/api/v1/companies/{ca['id']}/schedules/{s['id']}"
    payload = interval(user_id=uid, version=1, note='调整')
    assert client.put(path, headers=anchor, json=payload).status_code == 403
    updated = client.put(path, headers=a, json=payload)
    assert updated.status_code == 200 and updated.json()['version'] == 2
    assert client.put(path, headers=a, json=payload).status_code == 409
    assert client.post(path+'/cancel', headers=a, json={'version':1}).status_code == 409
    assert client.post(path+'/cancel', headers=a, json={'version':2}).status_code == 200


def test_removal_cancels_future_and_revokes_access_immediately(client):
    owner, anchor = login(client,'老板'), login(client,'主播')
    co = create_company(client, owner)
    uid = join(client,anchor,co)['user_id']
    future = schedule(client,owner,co['id'],uid).json()
    past = schedule(client,owner,co['id'],uid,key='past',
                    start='2020-01-01T12:00:00+08:00',end='2020-01-01T13:00:00+08:00').json()
    assert client.delete(f"/api/v1/companies/{co['id']}/members/{uid}", headers=owner).status_code == 204
    assert client.get(f"/api/v1/companies/{co['id']}/schedules",headers=anchor).status_code == 403
    assert client.get('/api/v1/my-schedules', headers=anchor).json()['items'] == []
    rows = client.get(f"/api/v1/companies/{co['id']}/schedules",headers=owner).json()['items']
    assert next(x for x in rows if x['id']==future['id'])['status']=='cancelled'
    assert next(x for x in rows if x['id']==past['id'])['status']=='active'
    assert join(client,anchor,co)['role']=='member'
    assert client.post(f"/api/v1/companies/{co['id']}/leave",headers=anchor).status_code == 204
