import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import httpx
import jwt
import pytest
from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from sqlalchemy import inspect
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from fastapi.testclient import TestClient

from app.auth import exchange_wechat
from app.backup import backup_database
from app.db import make_engine
from app.settings import Settings
from test_api import client, login, create_company, join, schedule, interval, add_log


def test_concurrent_creates_replay_and_version_update_only_one_wins(client):
    owner, member = login(client,'老板'), login(client,'主播')
    co = create_company(client,owner)
    uid = join(client,member,co)['user_id']
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: schedule(client,owner,co['id'],uid), range(2)))
    assert [r.status_code for r in results] == [201,201]
    assert results[0].json()['id'] == results[1].json()['id']
    sid = results[0].json()['id']
    def edit(note):
        return client.put(f"/api/v1/companies/{co['id']}/schedules/{sid}", headers=owner,
                          json=interval(user_id=uid,version=1,note=note))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(edit,['修改甲','修改乙']))
    assert sorted(r.status_code for r in results) == [200,409]


def test_failed_commit_returns_error_before_sending_success(client, monkeypatch):
    h = login(client, '主播')
    def broken_commit(self):
        raise OperationalError('COMMIT', {}, sqlite3.OperationalError('disk I/O error'))
    monkeypatch.setattr(Session, 'commit', broken_commit)
    with TestClient(client.app, raise_server_exceptions=False) as c:
        result = add_log(c, h)
        assert result.status_code == 503
        assert result.json()['detail']['code'] == 'database_unavailable'


def test_year_boundary_daily_totals_and_user_supplied_identifiers_are_rejected(client):
    h = login(client,'主播')
    assert add_log(client,h,start='2030-12-31T23:45:00+08:00',end='2031-01-01T00:15:00+08:00').status_code == 201
    december = client.get('/api/v1/work-logs?month=2030-12',headers=h).json()
    january = client.get('/api/v1/work-logs?month=2031-01',headers=h).json()
    assert december['daily_minutes'] == {'2030-12-31':15}
    assert january['daily_minutes'] == {'2031-01-01':15}
    assert client.post('/api/v1/work-logs',headers={**h,'Idempotency-Key':'injected'},
                       json=interval(user_id=123)).status_code == 422
    for value in ['2030-13','2030-1','garbage']:
        assert client.get('/api/v1/work-logs?month='+value,headers=h).status_code == 422


def test_cancelled_schedule_no_longer_conflicts_and_members_cannot_access_foreign_company(client):
    owner, outsider, member = [login(client,n) for n in ['老板','外人','主播']]
    co = create_company(client,owner)
    uid = join(client,member,co)['user_id']
    s = schedule(client,owner,co['id'],uid).json()
    assert client.get(f"/api/v1/companies/{co['id']}/schedules",headers=outsider).status_code == 403
    assert client.post(f"/api/v1/companies/{co['id']}/schedules/{s['id']}/cancel",headers=owner,json={'version':1}).status_code == 200
    assert schedule(client,owner,co['id'],uid,key='after-cancel').status_code == 201
    items = client.get('/api/v1/my-schedules',headers=member).json()['items']
    assert not any(i['has_conflict'] for i in items)


def test_wechat_errors_and_missing_configuration_do_not_create_fake_login(monkeypatch):
    settings = Settings(jwt_secret='a'*40)
    with pytest.raises(HTTPException) as exc:
        exchange_wechat(settings,'code')
    assert exc.value.status_code == 503
    settings.wechat_app_id, settings.wechat_app_secret = 'appid','secret'
    def bad_code(*args,**kwargs):
        return httpx.Response(200,json={'errcode':40029,'errmsg':'invalid code'},request=httpx.Request('GET','https://api.weixin.qq.com'))
    monkeypatch.setattr(httpx,'get',bad_code)
    with pytest.raises(HTTPException) as exc:
        exchange_wechat(settings,'bad')
    assert exc.value.status_code == 401
    def unavailable(*args,**kwargs):
        raise httpx.ConnectError('offline')
    monkeypatch.setattr(httpx,'get',unavailable)
    with pytest.raises(HTTPException) as exc:
        exchange_wechat(settings,'code')
    assert exc.value.status_code == 502


def test_deployment_rejects_documented_placeholder_secret():
    with pytest.raises(ValueError):
        Settings(jwt_secret='replace-with-a-random-secret-at-least-32-characters')


def test_expired_or_wrong_issuer_tokens_rejected(client):
    h = login(client, '主播')
    uid = client.get('/api/v1/me',headers=h).json()['id']
    for claims in [dict(sub=str(uid),iss='zhubo',exp=1),dict(sub=str(uid),iss='other',exp=4102444800)]:
        token = jwt.encode(claims,client.app.state.settings.jwt_secret,algorithm='HS256')
        assert client.get('/api/v1/me',headers={'Authorization':'Bearer '+token}).status_code == 401


def test_operator_can_manage_only_own_company_and_confirm_local_overlaps(client):
    owner, op, outsider, anchor = [login(client,n) for n in ['老板','运营','外部老板','主播']]
    co, foreign = create_company(client,owner), create_company(client,outsider)
    op_id = join(client,op,co)['user_id']
    anchor_id = join(client,anchor,co)['user_id']
    join(client,anchor,foreign)
    assert client.patch(f"/api/v1/companies/{co['id']}/members/{op_id}",headers=owner,json={'role':'operator'}).status_code == 200
    original = schedule(client,op,co['id'],anchor_id)
    assert original.status_code == 201
    assert schedule(client,op,co['id'],anchor_id,key='overlap').status_code == 409
    assert schedule(client,op,co['id'],anchor_id,key='overlap',confirm_overlap=True).status_code == 201
    assert schedule(client,op,foreign['id'],anchor_id,key='foreign').status_code == 403
    assert client.post(f"/api/v1/companies/{co['id']}/invite/reset",headers=op).status_code == 403
    assert client.delete(f"/api/v1/companies/{co['id']}/members/{anchor_id}",headers=op).status_code == 403
    assert client.patch(f"/api/v1/companies/{co['id']}",headers=owner,json={'name':'新公司名'}).json()['name']=='新公司名'


def test_initial_migration_round_trip_and_model_schema_agree(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path/'migration.db'}"
    monkeypatch.setenv('ZHUBO_DATABASE_URL',url)
    cfg = Config(str(Path(__file__).parents[1]/'alembic.ini'))
    command.upgrade(cfg,'head')
    engine = make_engine(url)
    tables = set(inspect(engine).get_table_names())
    assert {'users','companies','memberships','work_logs','schedules','idempotency'} <= tables
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from app.db import Base
    with engine.connect() as conn:
        assert compare_metadata(MigrationContext.configure(conn), Base.metadata) == []
    engine.dispose()
    command.downgrade(cfg,'base')
    engine = make_engine(url)
    assert set(inspect(engine).get_table_names()) == {'alembic_version'}
    engine.dispose()


def test_live_wal_backup_restore_and_retention(tmp_path):
    source = tmp_path/'source.db'
    output = tmp_path/'backups'
    output.mkdir()
    stale = output/'zhubo-20200101T000000000000Z.db'
    stale.write_bytes(b'old')
    unrelated = output/'unrelated.db'
    unrelated.write_bytes(b'keep')
    with sqlite3.connect(source) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('CREATE TABLE records(value TEXT)')
        conn.execute("INSERT INTO records VALUES ('直播工时')")
        conn.commit()
        result = backup_database(source,output,retain_days=30)
        assert result.is_file() and not stale.exists() and unrelated.exists()
        with sqlite3.connect(result) as restored:
            assert restored.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            assert restored.execute('SELECT value FROM records').fetchone()[0]=='直播工时'
    with pytest.raises(FileNotFoundError):
        backup_database(tmp_path/'missing.db',output)
