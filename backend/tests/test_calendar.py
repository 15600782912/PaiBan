import sqlite3
import hashlib
import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from test_api import client, login, interval, add_log, create_company, join


def day_entry(day='2030-01-31', minutes=240, rate=8000, **extra):
    return {'entry_type':'duration','record_date':day,'duration_minutes':minutes,'hourly_rate_fen':rate,'note':'直播',**extra}


def create(c,h,body,key='entry'):
    return c.post('/api/v1/work-logs',headers={**h,'Idempotency-Key':key},json=body)


def test_duration_entry_has_no_fake_times_and_returns_daily_income(client):
    h=login(client,'主播')
    r=create(client,h,day_entry())
    assert r.status_code==201,r.text
    row=r.json()
    assert row['entry_type']=='duration' and row['start_at'] is None and row['end_at'] is None
    assert row['minutes']==240 and row['income_fen']==32000
    result=client.get('/api/v1/work-logs?month=2030-01',headers=h).json()
    assert result['daily_minutes']=={'2030-01-31':240}
    assert result['daily_income_fen']=={'2030-01-31':32000}
    assert result['total_income_fen']==32000 and result['unpriced_count']==0
    assert result['items'][0]['daily_minutes']=={'2030-01-31':240}
    assert create(client,h,day_entry()).json()['id']==row['id']


def test_same_day_confirmation_accounts_for_legacy_intervals_and_keeps_idempotency(client):
    h=login(client,'主播')
    assert add_log(client,h).status_code==201
    assert create(client,h,day_entry(day='2030-02-01')).status_code==409
    r=create(client,h,day_entry(day='2030-02-01',confirm_overlap=True))
    assert r.status_code==201
    assert create(client,h,day_entry(day='2030-02-01',confirm_overlap=True)).json()['id']==r.json()['id']
    result=client.get('/api/v1/work-logs?month=2030-02',headers=h).json()
    assert result['total_minutes']==300 and result['unpriced_count']==1
    assert result['daily_unpriced_count']=={'2030-02-01':1}
    assert result['total_income_fen']==32000


def test_interval_salary_rounds_per_beijing_day_and_splits_months(client):
    h=login(client,'主播')
    r=create(client,h,interval(start='2030-01-31T23:59:00+08:00',end='2030-02-01T00:01:00+08:00',hourly_rate_fen=30))
    assert r.status_code==201
    assert r.json()['income_fen']==2  # each one-minute day is half a fen, each rounds up
    for month,day in [('2030-01','2030-01-31'),('2030-02','2030-02-01')]:
        result=client.get('/api/v1/work-logs?month='+month,headers=h).json()
        assert result['daily_income_fen']=={day:1}
        assert result['total_income_fen']==1


def test_defaults_are_private_persistent_and_never_reprice_records(client):
    a,b=login(client,'主播'),login(client,'老板')
    co=create_company(client,b); join(client,a,co)
    path='/api/v1/me/work-log-defaults'
    empty=client.get(path,headers=a).json()
    assert empty=={'hourly_rate_fen':None,'duration_minutes':None,'note':'','salary_id':None,'salary_name':None}
    defaults={'hourly_rate_fen':8000,'duration_minutes':240,'note':'默认直播'}
    assert client.put(path,headers=a,json=defaults).json()=={**defaults,'salary_id':None,'salary_name':None}
    saved=create(client,a,day_entry()).json()
    assert client.put(path,headers=a,json={**defaults,'hourly_rate_fen':10000}).status_code==200
    assert client.get(f"/api/v1/work-logs/{saved['id']}",headers=a).json()['income_fen']==32000
    assert client.get(path,headers=b).json()==empty
    assert client.get(path+'?user_id=1',headers=b).status_code==422
    assert client.put(path,headers=b,json={**defaults,'user_id':1}).status_code==422
    assert client.get(path,headers=login(client,'主播')).json()['hourly_rate_fen']==10000


def test_zero_rate_unpriced_and_edit_delete_recompute_totals(client):
    h=login(client,'主播')
    old=add_log(client,h).json()
    assert old['hourly_rate_fen'] is None and old['income_fen'] is None
    changed=client.put(f"/api/v1/work-logs/{old['id']}",headers=h,json=interval(hourly_rate_fen=0))
    assert changed.status_code==200 and changed.json()['income_fen']==0
    r=create(client,h,day_entry(day='2030-02-02',minutes=90,rate=10001))
    assert r.status_code==201 and r.json()['income_fen']==15002
    sid=r.json()['id']
    assert client.put(f'/api/v1/work-logs/{sid}',headers=h,json=day_entry(day='2030-02-03',minutes=60,rate=10000)).status_code==200
    result=client.get('/api/v1/work-logs?month=2030-02',headers=h).json()
    assert '2030-02-02' not in result['daily_minutes'] and result['total_income_fen']==10000
    assert client.delete(f'/api/v1/work-logs/{sid}',headers=h).status_code==204
    assert client.get('/api/v1/work-logs?month=2030-02',headers=h).json()['total_income_fen']==0


@pytest.mark.parametrize('body',[
    day_entry(minutes=0),day_entry(minutes=1441),day_entry(minutes=1.5),day_entry(rate=-1),day_entry(rate=0.5),
    day_entry(day='2030-02-30'),day_entry(day='2030-1-01'),day_entry(start_at='2030-01-31T00:00:00+08:00'),
])
def test_invalid_duration_inputs_rejected(client,body):
    assert create(client,login(client,'主播'),body).status_code==422


def test_duration_records_are_private_and_legacy_update_does_not_reprice(client):
    a,b=login(client,'主播'),login(client,'其他')
    row=create(client,a,day_entry()).json()
    assert client.get(f"/api/v1/work-logs/{row['id']}",headers=b).status_code==404
    assert client.put(f"/api/v1/work-logs/{row['id']}",headers=b,json=day_entry()).status_code==404
    assert client.delete(f"/api/v1/work-logs/{row['id']}",headers=b).status_code==404
    legacy=create(client,a,interval(start='2030-02-02T12:00:00+08:00',end='2030-02-02T13:00:00+08:00',hourly_rate_fen=8000),key='legacy').json()
    update=client.put(f"/api/v1/work-logs/{legacy['id']}",headers=a,json=interval(start='2030-02-02T12:00:00+08:00',end='2030-02-02T13:00:00+08:00',note='changed'))
    assert update.status_code==200 and update.json()['hourly_rate_fen']==8000


def test_migration_preserves_old_record_without_repricing(tmp_path,monkeypatch):
    path=tmp_path/'old.db'; monkeypatch.setenv('ZHUBO_DATABASE_URL',f'sqlite:///{path}')
    cfg=Config(str(Path(__file__).parents[1]/'alembic.ini'))
    command.upgrade(cfg,'0001')
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO users(id,openid,display_name) VALUES (1,'old-user','主播')")
        db.execute("INSERT INTO work_logs(id,user_id,start_at,end_at,note) VALUES(1,1,1896103800,1896109200,'old')")
    command.upgrade(cfg,'head')
    with sqlite3.connect(path) as db:
        row=db.execute('SELECT start_at,end_at,note,entry_type,hourly_rate_fen FROM work_logs').fetchone()
        assert row==(1896103800,1896109200,'old','interval',None)


def test_pre_upgrade_idempotency_key_still_replays_legacy_create(client):
    from sqlalchemy.orm import Session
    from app.models import Idempotency
    from app.schemas import IntervalInput
    h=login(client,'主播')
    uid=client.get('/api/v1/me',headers=h).json()['id']
    body=interval()
    legacy_digest=hashlib.sha256(IntervalInput(**body).model_dump_json().encode()).hexdigest()
    with Session(client.app.state.engine) as db:
        db.add(Idempotency(user_id=uid,scope='work-logs',key='old-request',digest=legacy_digest,
            response=json.dumps({'id':123,'minutes':90})))
        db.commit()
    response=create(client,h,body,key='old-request')
    assert response.status_code==201 and response.json()['id']==123
