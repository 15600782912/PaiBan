import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.db import Base, make_engine
from app.models import User
from sqlalchemy.orm import Session
from app.main import create_app
from app.settings import Settings
from app.demo_seed import reset_demo


def settings_for(tmp_path, **changes):
    return Settings(database_url=f"sqlite:///{tmp_path/'demo.db'}",jwt_secret='demo-seed-test-secret-'*3,
                    environment='development',dev_login_enabled=True,**changes)


def database(settings):
    engine=make_engine(settings.database_url);Base.metadata.create_all(engine)
    with engine.begin() as db:
        db.exec_driver_sql('CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)')
        db.exec_driver_sql("INSERT INTO alembic_version VALUES ('0004')")
    engine.dispose()


def login(client, account):
    response=client.post('/api/v1/auth/dev',json={'account':account,'display_name':'测试账号'})
    assert response.status_code==200,response.text
    return response.json()


def test_demo_reset_preserves_schema_backup_and_invalidates_old_users(tmp_path):
    settings=settings_for(tmp_path);database(settings)
    with TestClient(create_app(settings)) as client:
        old=login(client,'old-user')
        summary=reset_demo(settings,backup_dir=tmp_path/'backups',today=date(2026,10,26))
        assert summary['counts']['users']==9
        assert summary['counts']['companies']==5
        assert summary['counts']['rooms']==15
        assert summary['counts']['schedules']==64
        assert client.get('/api/v1/me',headers={'Authorization':'Bearer '+old['access_token']}).status_code==401
        admin=login(client,'demo-admin')
        lin=login(client,'demo-anchor-lin')
        new=login(client,'demo-new')
        assert admin['user']['id']>old['user']['id']
        own=client.get('/api/v1/my-schedules',headers={'Authorization':'Bearer '+lin['access_token']}).json()['items']
        assert len({item['company_id'] for item in own})==5
        assert any(item['has_room_conflict'] for item in own)
        assert all(item['user_id']==lin['user']['id'] for item in own)
        assert client.get('/api/v1/companies',headers={'Authorization':'Bearer '+new['access_token']}).json()['items']==[]
    with sqlite3.connect(summary['backup']) as backup:
        assert backup.execute('SELECT count(*) FROM users').fetchone()[0]==1
        assert backup.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    with sqlite3.connect(tmp_path/'demo.db') as db:
        assert db.execute('SELECT version_num FROM alembic_version').fetchone()[0]=='0004'
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
        assert db.execute('SELECT count(*) FROM schedules WHERE status="cancelled"').fetchone()[0]==1
        assert db.execute('SELECT count(*) FROM schedules WHERE room_id IS NULL').fetchone()[0]==1
        assert db.execute('SELECT count(*) FROM rooms WHERE active=0').fetchone()[0]==5
        assert db.execute('SELECT count(*) FROM work_logs').fetchone()[0]==0
    second=reset_demo(settings,backup_dir=tmp_path/'backups',today=date(2026,10,26))
    assert second['counts']['schedules']==64
    with TestClient(create_app(settings)) as client:
        assert client.get('/api/v1/me',headers={'Authorization':'Bearer '+admin['access_token']}).status_code==401


@pytest.mark.parametrize('environment,enabled',[('production',True),('development',False),('test',True)])
def test_demo_reset_rejects_non_development_without_touching_database(tmp_path,environment,enabled):
    settings=Settings(database_url=f"sqlite:///{tmp_path/'missing.db'}",jwt_secret='test-secret-'*5,
                      environment=environment,dev_login_enabled=enabled)
    with pytest.raises(ValueError,match='开发'):
        reset_demo(settings,backup_dir=tmp_path/'backups')
    assert not (tmp_path/'missing.db').exists()


def test_staging_failure_leaves_original_data_untouched(tmp_path,monkeypatch):
    settings=settings_for(tmp_path);database(settings)
    with TestClient(create_app(settings)) as client:
        old=login(client,'original')
    def broken(*args,**kwargs):
        raise RuntimeError('staging validation failed')
    monkeypatch.setattr('app.demo_seed.validate_demo',broken)
    with pytest.raises(RuntimeError,match='staging validation'):
        reset_demo(settings,backup_dir=tmp_path/'backups')
    with sqlite3.connect(tmp_path/'demo.db') as db:
        assert db.execute('SELECT count(*) FROM users').fetchone()[0]==1
        assert db.execute('SELECT id FROM users').fetchone()[0]==old['user']['id']


def test_install_failure_rolls_back_deletion_and_keeps_verified_backup(tmp_path,monkeypatch):
    settings=settings_for(tmp_path);database(settings)
    with TestClient(create_app(settings)) as client:
        old=login(client,'original')
    def broken(live):
        live.execute('DELETE FROM users')
        raise RuntimeError('injected install failure')
    monkeypatch.setattr('app.demo_seed.replace_rows',broken)
    with pytest.raises(RuntimeError,match='injected install failure'):
        reset_demo(settings,backup_dir=tmp_path/'backups',today=date(2026,10,26))
    with sqlite3.connect(tmp_path/'demo.db') as db:
        assert db.execute('SELECT id FROM users').fetchone()[0]==old['user']['id']
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    backups=list((tmp_path/'backups').glob('zhubo-*.db'))
    assert len(backups)==1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute('SELECT id FROM users').fetchone()[0]==old['user']['id']
