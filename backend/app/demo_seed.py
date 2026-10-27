"""Reset the configured development SQLite file to a verified local demo dataset."""
import argparse
import json
import sqlite3
from contextlib import closing
from datetime import date, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url

from .backup import backup_database
from .common import BEIJING
from .db import Base
from .main import create_app
from .settings import Settings

COMPANIES = ['星河传媒', '晨光直播', '云帆互娱', '青禾文化', '拾光传媒']
ACCOUNTS = [('demo-admin', '测试用户阿辰')] + [
    (f'demo-operator-{i+1}', name+'运营') for i,name in enumerate(COMPANIES)
] + [('demo-anchor-lin','测试主播小林'), ('demo-anchor-xia','测试主播小夏'), ('demo-new','测试新用户')]
TABLES = [table.name for table in Base.metadata.sorted_tables]


def checked(response, status=200):
    if response.status_code != status:
        raise RuntimeError(f'Demo API failed: {response.request.method} {response.request.url.path} {response.status_code}: {response.text}')
    return response.json() if response.content else None


def build_demo(settings, floor, today):
    # The administrator establishes a fresh ID range; remaining identities are
    # issued by the same development-login endpoint used by the mini program.
    path = Path(make_url(settings.database_url).database)
    with closing(sqlite3.connect(path)) as db:
        db.execute('PRAGMA foreign_keys=ON')
        for table in reversed(TABLES):
            db.execute(f'DELETE FROM "{table}"')
        db.execute('INSERT INTO users(id,openid,display_name) VALUES(?,?,?)',
                   (floor, 'dev:demo-admin', '测试用户阿辰'))
        db.commit()
    with TestClient(create_app(settings)) as client:
        accounts = {}
        for account,name in ACCOUNTS:
            result=checked(client.post('/api/v1/auth/dev',json={'account':account,'display_name':name}))
            accounts[account]={'id':result['user']['id'],'name':name,
                               'headers':{'Authorization':'Bearer '+result['access_token']}}
        admin=accounts['demo-admin']['headers']
        companies=[]
        for i,name in enumerate(COMPANIES):
            co=checked(client.post('/api/v1/companies',headers={**admin,'Idempotency-Key':f'demo-company-{i}'},json={'name':name}),201)
            co['operator']=accounts[f'demo-operator-{i+1}']['headers']
            for account in [f'demo-operator-{i+1}','demo-anchor-lin','demo-anchor-xia']:
                member=checked(client.post('/api/v1/companies/join',headers=accounts[account]['headers'],json={'invite_code':co['invite_code']}))
                if account.startswith('demo-operator'):
                    checked(client.patch(f"/api/v1/companies/{co['id']}/members/{member['user_id']}",headers=admin,json={'role':'operator'}))
            co['rooms']=[]
            for n in range(3):
                room=checked(client.post(f"/api/v1/companies/{co['id']}/rooms",headers={**co['operator'],'Idempotency-Key':f'demo-room-{i}-{n}'},json={'name':['一号直播间','二号直播间','历史直播间'][n]}),201)
                co['rooms'].append(room)
            companies.append(co)
        sequence=0
        def schedule(i,anchor,day,hour,end,room=0,note='常规演示排班',end_day=None):
            nonlocal sequence
            sequence+=1
            co=companies[i]
            def stamp(d,h):
                return (datetime.combine(d,datetime.min.time(),tzinfo=BEIJING)+timedelta(hours=h)).isoformat()
            body={'user_id':accounts[anchor]['id'],'start_at':stamp(day,hour),'end_at':stamp(end_day or day,end),'note':note}
            if room is not None:
                body['room_id']=co['rooms'][room]['id']
            headers={**co['operator'],'Idempotency-Key':f'demo-schedule-{sequence}'}
            endpoint=f"/api/v1/companies/{co['id']}/schedules"
            response=client.post(endpoint,headers=headers,json=body)
            if response.status_code==409 and response.json().get('detail',{}).get('code')=='overlap':
                response=client.post(endpoint,headers=headers,json={**body,'confirm_overlap':True})
            return checked(response,201)
        for offset in range(7):
            day=today+timedelta(days=offset)
            for i in range(5):
                schedule(i,'demo-anchor-lin',day,8+2*i,10+2*i,note=f'常规排班 · {COMPANIES[i]}运营安排小林')
            for i in range(2):
                schedule(i,'demo-anchor-xia',day,18+2*i,20+2*i,room=1,note='常规排班 · 小夏晚场')
        for i in range(5):
            schedule(i,'demo-anchor-lin',today,9+2*i,10+2*i,room=1,note='演示：同主播跨直播间重叠')
            schedule(i,'demo-anchor-xia',today,8.5+2*i,9.5+2*i,note='演示：同一直播间不同主播重叠')
        schedule(4,'demo-anchor-lin',today,9,10,note='演示：跨公司主播时间冲突，仅本人汇总可见')
        schedule(0,'demo-anchor-lin',today,23,1,end_day=today+timedelta(days=1),note='演示：跨午夜，承接前日/延续次日')
        schedule(1,'demo-anchor-lin',today,18,19,room=None,note='演示：待分配直播间，可编辑分配')
        cancelled=schedule(2,'demo-anchor-lin',today,14,15,room=1,note='演示：已取消，不参与冲突')
        checked(client.post(f"/api/v1/companies/{companies[2]['id']}/schedules/{cancelled['id']}/cancel",headers=companies[2]['operator'],json={'version':1}))
        schedule(3,'demo-anchor-lin',today-timedelta(days=1),15,16,room=2,note='演示：停用直播间的历史记录')
        for co in companies:
            checked(client.patch(f"/api/v1/companies/{co['id']}/rooms/{co['rooms'][2]['id']}",headers=co['operator'],json={'active':False}))
        validate_demo(client,accounts,companies,today)
    return {'date':today.isoformat(),'accounts':[{'account':key,'name':value['name'],'id':value['id']} for key,value in accounts.items()]}


def validate_demo(client, accounts, companies, today):
    for i,co in enumerate(companies):
        headers=co['operator']
        rows=checked(client.get(f"/api/v1/companies/{co['id']}/schedules",headers=headers))['items']
        if not rows or any(row['company_id']!=co['id'] for row in rows):
            raise RuntimeError('Operator company isolation failed')
        other=companies[(i+1)%5]
        if client.get(f"/api/v1/companies/{other['id']}/schedules",headers=headers).status_code!=403:
            raise RuntimeError('Operator could access another company')
        keys={row['user_id'] for row in rows}
        if accounts['demo-anchor-lin']['id'] not in keys:
            raise RuntimeError('Missing shared anchor schedule')
    for anchor in ['demo-anchor-lin','demo-anchor-xia']:
        user=accounts[anchor]
        rows=checked(client.get('/api/v1/my-schedules',headers=user['headers']))['items']
        if not rows or any(row['user_id']!=user['id'] for row in rows):
            raise RuntimeError('Anchor isolation failed')
        if not any(row['has_room_conflict'] for row in rows):
            raise RuntimeError('Room conflict demo missing')
    lin=accounts['demo-anchor-lin']
    rows=checked(client.get('/api/v1/my-schedules',headers=lin['headers']))['items']
    if len({row['company_id'] for row in rows})!=5 or not any(row['has_anchor_conflict'] for row in rows):
        raise RuntimeError('Cross-company anchor scenario missing')
    if checked(client.get('/api/v1/companies',headers=accounts['demo-new']['headers']))['items']:
        raise RuntimeError('New-user scenario must be empty')


def replace_rows(live):
    for table in reversed(TABLES):
        live.execute(f'DELETE FROM main."{table}"')
    for table in TABLES:
        columns=[row[1] for row in live.execute(f'PRAGMA main.table_info("{table}")')]
        names=','.join('"'+column+'"' for column in columns)
        live.execute(f'INSERT INTO main."{table}" ({names}) SELECT {names} FROM demo_stage."{table}"')


def reset_demo(settings, *, backup_dir=None, today=None):
    if not settings.development_login_allowed:
        raise ValueError('仅允许在显式开启测试登录的开发环境重置演示数据')
    parsed=make_url(settings.database_url)
    if parsed.get_backend_name()!='sqlite' or not parsed.database or parsed.database==':memory:':
        raise ValueError('演示重置需要已存在的本地SQLite数据库文件')
    source=Path(parsed.database).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    today=today or datetime.now(BEIJING).date()
    if not 2000<=today.year<=2099:
        raise ValueError('演示日期年份须在2000–2099之间')
    backup_dir=Path(backup_dir) if backup_dir else source.parent.parent/'backups'
    with TemporaryDirectory(prefix='paiban-demo-') as temporary:
        stage=Path(temporary)/'demo.db'
        with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as original,closing(sqlite3.connect(stage)) as staged:
            if original.execute('SELECT version_num FROM alembic_version').fetchone()!=('0004',):
                raise ValueError('请先执行数据库迁移到0004')
            floor=original.execute('SELECT coalesce(max(id),0)+1 FROM users').fetchone()[0]
            original.backup(staged)
        staged_settings=settings.model_copy(update={'database_url':'sqlite:///'+stage.as_posix()})
        result=build_demo(staged_settings,floor,today)
        with closing(sqlite3.connect(stage)) as staged:
            expected={table:staged.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0] for table in TABLES}
            if any(expected.get(table)!=count for table,count in {'users':9,'companies':5,'rooms':15,'schedules':64,'salaries':0,'work_logs':0,'work_log_defaults':0}.items()):
                raise RuntimeError('Demo dataset counts are incorrect')
            if staged.execute('PRAGMA integrity_check').fetchone()!=('ok',) or staged.execute('PRAGMA foreign_key_check').fetchall():
                raise RuntimeError('Staged demo integrity failed')
        # Keep the database inode and live WAL connection intact. A single writer
        # transaction makes every reader see either the old or complete new data.
        with closing(sqlite3.connect(source,timeout=30)) as live:
            live.execute('PRAGMA foreign_keys=ON')
            live.execute('ATTACH DATABASE ? AS demo_stage',(str(stage),))
            live.execute('BEGIN IMMEDIATE')
            try:
                if live.execute('SELECT coalesce(max(id),0) FROM users').fetchone()[0]>=floor:
                    raise RuntimeError('账号数据在准备期间已变化，请重新执行重置')
                backup=backup_database(source,backup_dir,retain_days=36500)
                replace_rows(live)
                if live.execute('PRAGMA foreign_key_check').fetchall():
                    raise RuntimeError('Installed demo foreign-key validation failed')
                counts={table:live.execute(f'SELECT count(*) FROM main."{table}"').fetchone()[0] for table in TABLES}
                if counts!=expected:
                    raise RuntimeError('Installed demo count validation failed')
                live.commit()
            except BaseException:
                live.rollback()
                raise
        return {**result,'database':str(source),'backup':str(backup),'counts':counts}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reset',action='store_true',help='Clear local business data after verified backup')
    parser.add_argument('--date',type=date.fromisoformat,help='Beijing reference date, defaults to today')
    args=parser.parse_args()
    if not args.reset:
        parser.error('请明确提供 --reset 才会清空并生成演示数据')
    print(json.dumps(reset_demo(Settings(),today=args.date),ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
