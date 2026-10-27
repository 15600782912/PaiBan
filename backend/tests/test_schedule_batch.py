from datetime import date, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Idempotency
from test_api import client, create_company, interval, join, login, schedule
from test_rooms import room


def setup(c):
    owner, a, b, outside = [login(c, name) for name in ['公司创建者', '主播甲', '主播乙', '外部用户']]
    co = create_company(c, owner)
    aid = join(c, a, co)['user_id']
    bid = join(c, b, co)['user_id']
    rid = room(c, owner, co['id']).json()['id']
    return owner, a, b, outside, co, aid, bid, rid


def item(uid, rid, day='2030-01-01', start='10:00', end='12:00', **changes):
    return interval(start=f'{day}T{start}:00+08:00', end=f'{day}T{end}:00+08:00', user_id=uid, room_id=rid, **changes)


def batch(c, h, cid, items, key='batch-1', **changes):
    return c.post(f'/api/v1/companies/{cid}/schedules/batch',
                  headers={**h, 'Idempotency-Key': key}, json={'items': items, **changes})


def rows(c, h, cid):
    return c.get(f'/api/v1/companies/{cid}/schedules', headers=h).json()['items']


def test_batch_creates_independent_rows_and_replays_one_atomic_result(client):
    owner, a, b, outside, co, aid, bid, rid = setup(client)
    payload = [item(aid, rid), item(aid, rid, day='2030-01-02')]
    r = batch(client, owner, co['id'], payload)
    assert r.status_code == 201, r.text
    assert r.json()['count'] == 2
    assert len({row['id'] for row in r.json()['items']}) == 2
    assert batch(client, owner, co['id'], payload).json() == r.json()
    assert len(rows(client, owner, co['id'])) == 2
    assert batch(client, owner, co['id'], payload[:1]).json()['detail']['code'] == 'idempotency_mismatch'
    assert len(rows(client, owner, co['id'])) == 2


def test_batch_accepts_sixty_dates_and_requires_an_idempotency_key(client):
    owner, a, b, outside, co, aid, bid, rid = setup(client)
    payload = [item(aid, rid, day=(date(2030, 1, 1)+timedelta(days=i)).isoformat()) for i in range(60)]
    path = f"/api/v1/companies/{co['id']}/schedules/batch"
    assert client.post(path, headers=owner, json={'items':payload}).status_code == 422
    assert rows(client, owner, co['id']) == []
    result = batch(client, owner, co['id'], payload)
    assert result.status_code == 201 and result.json()['count'] == 60
    assert len(rows(client, owner, co['id'])) == 60


def test_batch_existing_and_internal_conflicts_are_combined_then_confirmed(client):
    owner, a, b, outside, co, aid, bid, rid = setup(client)
    schedule(client, owner, co['id'], aid, room_id=rid, start='2030-01-01T10:00:00+08:00', end='2030-01-01T12:00:00+08:00')
    payload = [item(aid, rid, start='11:00', end='13:00'), item(bid, rid, start='12:30', end='14:00')]
    r = batch(client, owner, co['id'], payload)
    assert r.status_code == 409, r.text
    detail = r.json()['detail']
    assert detail['code'] == 'overlap'
    assert '2030-01-01' in detail['message'] and '直播间' in detail['message'] and '主播' in detail['message']
    assert '本批次' in detail['message']
    assert len(rows(client, owner, co['id'])) == 1
    r = batch(client, owner, co['id'], payload, confirm_overlap=True)
    assert r.status_code == 201 and r.json()['count'] == 2
    assert all(row['has_room_conflict'] for row in r.json()['items'])


def test_batch_touching_and_cancelled_intervals_do_not_conflict(client):
    owner, a, b, outside, co, aid, bid, rid = setup(client)
    cancelled = schedule(client, owner, co['id'], aid, room_id=rid, start='2030-01-01T10:00:00+08:00', end='2030-01-01T12:00:00+08:00').json()
    client.post(f"/api/v1/companies/{co['id']}/schedules/{cancelled['id']}/cancel", headers=owner, json={'version':1})
    r = batch(client, owner, co['id'], [item(aid, rid), item(bid, rid, start='12:00', end='14:00')])
    assert r.status_code == 201, r.text
    assert all(not row['has_conflict'] for row in r.json()['items'])


def test_batch_does_not_allow_member_foreign_rooms_inactive_rooms_or_partial_validation(client):
    owner, a, b, outside, co, aid, bid, rid = setup(client)
    assert batch(client, a, co['id'], [item(aid, rid)]).status_code == 403
    other = create_company(client, outside)
    foreign = room(client, outside, other['id']).json()['id']
    assert batch(client, owner, co['id'], [item(aid, rid), item(bid, foreign)]).status_code == 404
    assert rows(client, owner, co['id']) == []
    client.patch(f"/api/v1/companies/{co['id']}/rooms/{rid}", headers=owner, json={'active':False})
    assert batch(client, owner, co['id'], [item(aid, rid)], confirm_overlap=True).json()['detail']['code'] == 'room_inactive'
    assert rows(client, owner, co['id']) == []


def test_batch_rechecks_member_authorization_and_does_not_disclose_cross_company_conflicts(client):
    owner, a, b, outside, co, aid, bid, rid = setup(client)
    other = create_company(client, outside)
    join(client, a, other)
    schedule(client, outside, other['id'], aid, start='2030-01-01T10:00:00+08:00', end='2030-01-01T12:00:00+08:00')
    result = batch(client, owner, co['id'], [item(aid, rid)])
    assert result.status_code == 201
    assert not result.json()['items'][0]['has_conflict']
    assert '外部用户' not in result.text
    client.patch(f"/api/v1/companies/{co['id']}/members/{bid}", headers=owner, json={'role':'operator'})
    assert batch(client, b, co['id'], [item(bid, rid, day='2030-01-03')], key='op').status_code == 201
    client.patch(f"/api/v1/companies/{co['id']}/members/{bid}", headers=owner, json={'role':'member'})
    assert batch(client, b, co['id'], [item(bid, rid, day='2030-01-03')], key='op').status_code == 403
    client.delete(f"/api/v1/companies/{co['id']}/members/{aid}", headers=owner)
    r = batch(client, owner, co['id'], [item(bid, rid, day='2030-01-04'), item(aid, rid, day='2030-01-05')], key='removed', confirm_overlap=True)
    assert r.status_code == 403
    assert len(rows(client, owner, co['id'])) == 2


@pytest.mark.parametrize('kind', ['empty', 'too_many', 'no_room', 'no_member', 'reverse', 'per_item_confirm'])
def test_batch_input_bounds_and_item_validation(client, kind):
    owner, a, b, outside, co, aid, bid, rid = setup(client)
    payload = [item(aid, rid)]
    if kind == 'empty': payload = []
    if kind == 'too_many': payload = payload * 61
    if kind == 'no_room': payload[0].pop('room_id')
    if kind == 'no_member': payload[0].pop('user_id')
    if kind == 'reverse': payload[0]['end_at'] = payload[0]['start_at']
    if kind == 'per_item_confirm': payload[0]['confirm_overlap'] = True
    assert batch(client, owner, co['id'], payload).status_code == 422
    assert rows(client, owner, co['id']) == []


def test_batch_serialization_failure_rolls_back_every_new_row_and_key(client, monkeypatch):
    owner, a, b, outside, co, aid, bid, rid = setup(client)
    def broken(*args, **kwargs):
        raise RuntimeError('injected result failure')
    monkeypatch.setattr('app.schedules.schedule_view', broken)
    with pytest.raises(RuntimeError, match='injected result failure'):
        batch(client, owner, co['id'], [item(aid, rid), item(bid, rid, day='2030-01-02')])
    assert rows(client, owner, co['id']) == []
    with Session(client.app.state.engine) as db:
        assert db.scalar(select(func.count()).select_from(Idempotency).where(Idempotency.scope.like('%/schedules/batch'))) == 0
