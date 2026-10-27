import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config
from test_api import client, login, create_company, join, interval, schedule


def room(c,h,cid,name='直播间一',key='room-1'):
    return c.post(f'/api/v1/companies/{cid}/rooms',headers={**h,'Idempotency-Key':key},json={'name':name})


def setup(c):
    owner,a,b,out=[login(c,n) for n in ['老板','主播甲','主播乙','外部人员']]
    co=create_company(c,owner)
    aid=join(c,a,co)['user_id'];bid=join(c,b,co)['user_id']
    return owner,a,b,out,co,aid,bid


def test_rooms_crud_permissions_company_scope_and_idempotency(client):
    owner,a,b,out,co,aid,bid=setup(client);cid=co['id']
    r=room(client,owner,cid);assert r.status_code==201,r.text
    rid=r.json()['id'];assert r.json()['active'] is True
    assert room(client,owner,cid).json()['id']==rid
    assert room(client,owner,cid,name='别的名称').status_code==409
    assert room(client,owner,cid,key='duplicate').json()['detail']['code']=='room_name_exists'
    assert room(client,a,cid,key='forbidden').status_code==403
    assert client.get(f'/api/v1/companies/{cid}/rooms',headers=out).status_code==403
    assert client.patch(f'/api/v1/companies/{cid}/members/{aid}',headers=owner,json={'role':'operator'}).status_code==200
    assert room(client,a,cid,name='运营直播间',key='op').status_code==201
    assert client.patch(f'/api/v1/companies/{cid}/rooms/{rid}',headers=a,json={'name':'新名字','active':False}).json()['active'] is False
    assert client.get(f'/api/v1/companies/{cid}/rooms',headers=b).json()['items'][0]['name']=='新名字'
    other=create_company(client,out)
    assert client.patch(f"/api/v1/companies/{other['id']}/rooms/{rid}",headers=out,json={'name':'越权'}).status_code==404
    for body in [{},{'name':''},{'name':None},{'active':None},{'active':'false'},{'unknown':1}]:
        assert client.patch(f'/api/v1/companies/{cid}/rooms/{rid}',headers=owner,json=body).status_code==422


def test_room_conflicts_combined_confirmation_privacy_and_cancel(client):
    owner,a,b,out,co,aid,bid=setup(client);cid=co['id']
    rid=room(client,owner,cid).json()['id']
    first=schedule(client,owner,cid,aid,room_id=rid).json()
    r=schedule(client,owner,cid,bid,key='room-overlap',room_id=rid)
    assert r.status_code==409,r.text
    assert r.json()['detail']['code']=='overlap'
    assert '直播间' in r.json()['detail']['message'] and '主播甲' in r.json()['detail']['message']
    second=schedule(client,owner,cid,bid,key='room-overlap',room_id=rid,confirm_overlap=True).json()
    r=schedule(client,owner,cid,aid,key='both',room_id=rid)
    assert '主播' in r.json()['detail']['message'] and '直播间' in r.json()['detail']['message']
    mine=client.get(f'/api/v1/companies/{cid}/schedules',headers=a).json()['items']
    assert len(mine)==1 and mine[0]['id']==first['id']
    assert mine[0]['has_room_conflict'] and mine[0]['has_conflict']
    assert '主播乙' not in str(mine) and str(second['id']) not in str(mine[0].get('conflicts',''))
    assert client.get('/api/v1/my-schedules',headers=a).json()['items'][0]['has_room_conflict']
    assert client.post(f"/api/v1/companies/{cid}/schedules/{second['id']}/cancel",headers=owner,json={'version':1}).status_code==200
    assert not client.get('/api/v1/my-schedules',headers=a).json()['items'][0]['has_room_conflict']
    assert schedule(client,owner,cid,bid,key='adjacent',room_id=rid,start='2030-02-01T01:00:00+08:00',end='2030-02-01T02:00:00+08:00').status_code==201


def test_inactive_foreign_rooms_update_preserve_and_legacy_unassigned(client):
    owner,a,b,out,co,aid,bid=setup(client);cid=co['id']
    rid=room(client,owner,cid).json()['id']
    row=schedule(client,owner,cid,aid,room_id=rid).json()
    updated=client.put(f"/api/v1/companies/{cid}/schedules/{row['id']}",headers=owner,json=interval(user_id=aid,version=1,note='保留直播间'))
    assert updated.status_code==200 and updated.json()['room_id']==rid
    foreign=create_company(client,out);fid=room(client,out,foreign['id']).json()['id']
    assert schedule(client,owner,cid,bid,key='foreign-room',room_id=fid).status_code==404
    assert client.patch(f'/api/v1/companies/{cid}/rooms/{rid}',headers=owner,json={'active':False}).status_code==200
    assert schedule(client,owner,cid,bid,key='inactive',room_id=rid).status_code==409
    assert client.put(f"/api/v1/companies/{cid}/schedules/{row['id']}",headers=owner,json=interval(user_id=aid,version=2,note='不可重排')).status_code==409
    replacement=room(client,owner,cid,name='直播间二',key='room2').json()['id']
    updated=client.put(f"/api/v1/companies/{cid}/schedules/{row['id']}",headers=owner,json=interval(user_id=aid,version=2,room_id=replacement))
    assert updated.status_code==200 and updated.json()['room_id']==replacement
    legacy=schedule(client,owner,cid,bid,key='legacy',start='2030-02-02T12:00:00+08:00',end='2030-02-02T13:00:00+08:00')
    assert legacy.status_code==201 and legacy.json()['room_id'] is None
    assert schedule(client,owner,cid,bid,key='legacy',start='2030-02-02T12:00:00+08:00',end='2030-02-02T13:00:00+08:00').json()['id']==legacy.json()['id']


def test_room_conflict_outside_visible_window_and_personal_cross_company(client):
    owner,a,b,out,co,aid,bid=setup(client);cid=co['id'];rid=room(client,owner,cid).json()['id']
    first=schedule(client,owner,cid,aid,room_id=rid).json()
    schedule(client,owner,cid,bid,key='late-overlap',room_id=rid,confirm_overlap=True,start='2030-02-01T00:30:00+08:00',end='2030-02-01T02:00:00+08:00')
    items=client.get(f'/api/v1/companies/{cid}/schedules',headers=a,params={'start_at':'2030-01-31T23:00:00+08:00','end_at':'2030-02-01T00:00:00+08:00'}).json()['items']
    assert len(items)==1 and items[0]['has_room_conflict']
    foreign=create_company(client,out);join(client,a,foreign)
    schedule(client,out,foreign['id'],aid,key='foreign-own')
    own=client.get('/api/v1/my-schedules',headers=a).json()['items']
    assert all(x['has_anchor_conflict'] for x in own)
    local=client.get(f'/api/v1/companies/{cid}/schedules',headers=owner).json()['items']
    assert '外部人员' not in str(local) and all(not x['has_anchor_conflict'] for x in local)


def test_rooms_migration_preserves_legacy_schedule_and_constraints(tmp_path,monkeypatch):
    dbfile=tmp_path/'legacy.db';monkeypatch.setenv('ZHUBO_DATABASE_URL',f'sqlite:///{dbfile}')
    cfg=Config(str(Path(__file__).parents[1]/'alembic.ini'));command.upgrade(cfg,'0003')
    with sqlite3.connect(dbfile) as db:
        db.execute("INSERT INTO users(id,openid,display_name) VALUES(1,'legacy','旧主播')")
        db.execute("INSERT INTO companies(id,name,owner_id,invite_code) VALUES(1,'旧公司',1,'OLD')")
        db.execute("INSERT INTO schedules(id,company_id,user_id,start_at,end_at,note,version,status) VALUES(1,1,1,100,200,'直播间1旧备注',3,'active')")
    command.upgrade(cfg,'head')
    with sqlite3.connect(dbfile) as db:
        assert db.execute('SELECT company_id,user_id,start_at,end_at,note,version,status,room_id FROM schedules').fetchone()==(1,1,100,200,'直播间1旧备注',3,'active',None)
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
        checks=db.execute("SELECT sql FROM sqlite_master WHERE name='schedules'").fetchone()[0]
        assert 'end_at > start_at' in checks and 'cancelled' in checks
    command.downgrade(cfg,'0003')
    with sqlite3.connect(dbfile) as db:
        assert db.execute('SELECT note,version FROM schedules').fetchone()==('直播间1旧备注',3)
