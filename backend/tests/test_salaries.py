import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from test_api import client, login, create_company, join, interval
from test_calendar import create, day_entry


def salary(c,h,rate=8000,name='常规场',key='salary'):
    return c.post('/api/v1/salaries',headers={**h,'Idempotency-Key':key},json={'name':name,'hourly_rate_fen':rate})


def test_salary_crud_private_even_to_company_owner_and_idempotent(client):
    a,b=login(client,'主播'),login(client,'老板')
    co=create_company(client,b);join(client,a,co)
    r=salary(client,a);assert r.status_code==201,r.text
    sid=r.json()['id']
    assert salary(client,a).json()['id']==sid
    assert salary(client,a,rate=9000).status_code==409
    assert client.get('/api/v1/salaries',headers=b).json()['items']==[]
    assert client.get('/api/v1/salaries?user_id=1',headers=b).status_code==422
    assert client.put(f'/api/v1/salaries/{sid}',headers=b,json={'name':'偷改','hourly_rate_fen':1}).status_code==404
    assert client.delete(f'/api/v1/salaries/{sid}',headers=b).status_code==404
    assert client.put(f'/api/v1/salaries/{sid}',headers=a,json={'name':'新名称','hourly_rate_fen':9000}).json()['name']=='新名称'
    assert client.delete(f'/api/v1/salaries/{sid}',headers=a).status_code==204
    assert client.get('/api/v1/salaries',headers=a).json()['items']==[]


def test_selected_salary_is_validated_and_snapshot_survives_edit_delete(client):
    a,b=login(client,'主播'),login(client,'其他')
    s=salary(client,a).json();sid=s['id']
    body=day_entry(salary_id=sid)
    r=create(client,a,body);assert r.status_code==201,r.text
    record=r.json(); assert record['salary_name']=='常规场' and record['income_fen']==32000
    assert create(client,b,body).status_code==404
    assert client.put(f'/api/v1/salaries/{sid}',headers=a,json={'name':'新场','hourly_rate_fen':9000}).status_code==200
    assert create(client,a,day_entry(day='2030-02-01',salary_id=sid),key='stale').json()['detail']['code']=='salary_changed'
    assert create(client,a,day_entry(day='2030-02-01',salary_id=sid,rate=9000),key='new').json()['income_fen']==36000
    # No salary fields means "keep original" even after a live preset is renamed/repriced.
    edit=day_entry(minutes=120);edit.pop('hourly_rate_fen')
    updated=client.put(f"/api/v1/work-logs/{record['id']}",headers=a,json=edit)
    assert updated.status_code==200 and updated.json()['salary_name']=='常规场' and updated.json()['hourly_rate_fen']==8000
    assert client.delete(f'/api/v1/salaries/{sid}',headers=a).status_code==204
    old=client.get(f"/api/v1/work-logs/{record['id']}",headers=a).json()
    assert old['salary_name']=='常规场' and old['income_fen']==16000
    assert create(client,a,body).json()['id']==record['id'] # replay succeeds even after deletion
    assert create(client,a,day_entry(day='2030-02-02',salary_id=sid,rate=9000),key='deleted').json()['detail']['code']=='salary_unavailable'
    assert client.put(f"/api/v1/work-logs/{record['id']}",headers=a,json=edit).status_code==200


def test_defaults_follow_live_salary_but_deletion_requires_reselection(client):
    h=login(client,'主播');sid=salary(client,h,rate=0).json()['id']
    path='/api/v1/me/work-log-defaults'
    body={'salary_id':sid,'hourly_rate_fen':0,'duration_minutes':90,'note':'保留备注'}
    r=client.put(path,headers=h,json=body);assert r.status_code==200,r.text
    assert r.json()['salary_id']==sid
    client.put(f'/api/v1/salaries/{sid}',headers=h,json={'name':'改价','hourly_rate_fen':12000})
    d=client.get(path,headers=h).json()
    assert d['hourly_rate_fen']==12000 and d['salary_name']=='改价'
    assert client.put(path,headers=h,json=body).json()['detail']['code']=='salary_changed'
    client.delete(f'/api/v1/salaries/{sid}',headers=h)
    d=client.get(path,headers=h).json()
    assert d['salary_id'] is None and d['duration_minutes']==90 and d['note']=='保留备注'


@pytest.mark.parametrize('body',[{'name':'','hourly_rate_fen':8000},{'name':'a','hourly_rate_fen':-1},
    {'name':'a','hourly_rate_fen':0.1},{'name':'a','hourly_rate_fen':100000001}])
def test_invalid_salary_inputs(client,body):
    h=login(client,'主播')
    assert client.post('/api/v1/salaries',headers={**h,'Idempotency-Key':'bad'},json=body).status_code==422


def test_migration_generates_distinct_per_user_rates_without_changing_history(tmp_path,monkeypatch):
    path=tmp_path/'salary-migration.db';monkeypatch.setenv('ZHUBO_DATABASE_URL',f'sqlite:///{path}')
    cfg=Config(str(Path(__file__).parents[1]/'alembic.ini'));command.upgrade(cfg,'0002')
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO users(id,openid,display_name) VALUES(1,'a','甲'),(2,'b','乙')")
        for i,uid,rate in [(1,1,8000),(2,1,8000),(3,1,0),(4,1,None),(5,2,8000)]:
            db.execute("INSERT INTO work_logs(id,user_id,entry_type,record_date,duration_minutes,hourly_rate_fen,note) VALUES(?,?,'duration','2030-01-01',60,?,'原记录')",(i,uid,rate))
        db.execute("INSERT INTO work_log_defaults(user_id,hourly_rate_fen,duration_minutes,note) VALUES(1,12000,240,'原默认')")
    command.upgrade(cfg,'head')
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT user_id,hourly_rate_fen FROM salaries ORDER BY user_id,hourly_rate_fen').fetchall()==[(1,0),(1,8000),(1,12000),(2,8000)]
        rows=db.execute('SELECT hourly_rate_fen,salary_id,salary_name,duration_minutes,note FROM work_logs ORDER BY id').fetchall()
        assert rows[0][1]==rows[1][1] and rows[0][1]!=rows[4][1]
        assert rows[3][1] is None and rows[3][2] is None
        assert [r[0] for r in rows]==[8000,8000,0,None,8000]
        assert all(r[3:]==(60,'原记录') for r in rows)
        assert db.execute('SELECT salary_id FROM work_log_defaults').fetchone()[0] is not None
