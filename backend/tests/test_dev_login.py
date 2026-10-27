import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings


def make_client(tmp_path, environment='development', enabled=True):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'dev.db'}", jwt_secret='local-secret-'*4,
                        environment=environment, dev_login_enabled=enabled)
    app = create_app(settings, initialize_schema=False)
    from app.db import Base
    Base.metadata.create_all(app.state.engine)
    return TestClient(app)


def test_dev_login_needs_no_wechat_secret_and_preserves_account_identity(tmp_path):
    with make_client(tmp_path) as c:
        first = c.post('/api/v1/auth/dev', json={'account':'demo-1','display_name':'测试用户1'})
        assert first.status_code == 200
        repeat = c.post('/api/v1/auth/dev', json={'account':'demo-1','display_name':'测试用户1'})
        second = c.post('/api/v1/auth/dev', json={'account':'demo-2','display_name':'测试用户2'})
        assert first.json()['user']['id'] == repeat.json()['user']['id']
        assert first.json()['user']['id'] != second.json()['user']['id']
        token = first.json()['access_token']
        assert c.get('/api/v1/me', headers={'Authorization':'Bearer '+token}).status_code == 200
        c.app.state.settings.dev_login_enabled = False
        assert c.get('/api/v1/me', headers={'Authorization':'Bearer '+token}).status_code == 401
        c.app.state.settings.dev_login_enabled = True
        c.app.state.settings.environment = 'production'
        assert c.get('/api/v1/me', headers={'Authorization':'Bearer '+token}).status_code == 401


@pytest.mark.parametrize('environment,enabled',[('production',True),('development',False),('test',True)])
def test_dev_login_is_unavailable_unless_explicitly_enabled_in_development(tmp_path,environment,enabled):
    with make_client(tmp_path,environment,enabled) as c:
        assert c.post('/api/v1/auth/dev', json={'account':'demo-1','display_name':'测试用户1'}).status_code == 404


def test_test_accounts_do_not_have_automatic_company_roles(tmp_path):
    with make_client(tmp_path) as c:
        first=c.post('/api/v1/auth/dev',json={'account':'demo-1','display_name':'测试用户1'}).json()
        second=c.post('/api/v1/auth/dev',json={'account':'demo-2','display_name':'测试用户2'}).json()
        h1={'Authorization':'Bearer '+first['access_token'],'Idempotency-Key':'company'}
        h2={'Authorization':'Bearer '+second['access_token']}
        company=c.post('/api/v1/companies',headers=h1,json={'name':'测试公司'}).json()
        joined=c.post('/api/v1/companies/join',headers=h2,json={'invite_code':company['invite_code']})
        assert joined.json()['role']=='member'
        assert c.get(f"/api/v1/companies/{company['id']}/members",headers=h2).status_code==403
        assert c.post('/api/v1/auth/dev',json={'account':'dev:other','display_name':'fake'}).status_code==422
