from fastapi import APIRouter, Depends, Header, Request, Response
from sqlalchemy import select, update

from .common import fail, reject_extra_query, remember, replay
from .dependencies import current_user, session
from .models import Salary, WorkLogDefaults
from .schemas import SalaryInput

router=APIRouter(prefix='/salaries')


def salary_view(row):
    return {'id':row.id,'name':row.name,'hourly_rate_fen':row.hourly_rate_fen}


def owned_salary(db,uid,sid):
    row=db.scalar(select(Salary).where(Salary.id==sid,Salary.user_id==uid,Salary.deleted.is_(False)))
    if row is None:
        fail(404,'salary_unavailable','薪资已删除或不可用，请重新选择')
    return row


def selected_price(db,uid,body):
    row=owned_salary(db,uid,body.salary_id)
    if body.hourly_rate_fen is None:
        fail(422,'salary_expected_price','选择薪资时需要传入表单显示的时薪')
    if row.hourly_rate_fen!=body.hourly_rate_fen:
        fail(409,'salary_changed','该薪资价格已更新，请刷新薪资列表并重新选择确认；时长和备注会保留')
    return {'salary_id':row.id,'salary_name':row.name,'hourly_rate_fen':row.hourly_rate_fen}


@router.get('')
def list_salaries(request: Request,user=Depends(current_user),db=Depends(session,scope='function')):
    reject_extra_query(request,[])
    rows=db.scalars(select(Salary).where(Salary.user_id==user.id,Salary.deleted.is_(False)).order_by(Salary.id)).all()
    return {'items':[salary_view(row) for row in rows]}


@router.post('',status_code=201)
def create_salary(body: SalaryInput,idempotency_key: str | None=Header(default=None),
                  user=Depends(current_user),db=Depends(session,scope='function')):
    digest,old=replay(db,user.id,'salaries',idempotency_key,body)
    if old is not None:
        return old
    row=Salary(user_id=user.id,**body.model_dump())
    db.add(row);db.flush()
    result=salary_view(row)
    remember(db,user.id,'salaries',idempotency_key,digest,result)
    return result


@router.put('/{sid}')
def update_salary(sid: int,body: SalaryInput,user=Depends(current_user),db=Depends(session,scope='function')):
    row=owned_salary(db,user.id,sid)
    row.name=body.name;row.hourly_rate_fen=body.hourly_rate_fen
    db.flush()
    return salary_view(row)


@router.delete('/{sid}',status_code=204)
def delete_salary(sid: int,user=Depends(current_user),db=Depends(session,scope='function')):
    row=owned_salary(db,user.id,sid)
    row.deleted=True
    db.execute(update(WorkLogDefaults).where(WorkLogDefaults.user_id==user.id,WorkLogDefaults.salary_id==sid).values(salary_id=None))
    db.flush()
    return Response(status_code=204)
