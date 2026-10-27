import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from . import auth, companies, rooms, salaries, schedules, work_logs
from .db import Base, make_engine
from .settings import Settings


def create_app(settings=None, *, exchange_code=None, initialize_schema=False):
    settings = settings or Settings()
    engine = make_engine(settings.database_url)
    if initialize_schema:
        if settings.environment != 'test':
            raise ValueError('Use Alembic migrations outside tests')
        Base.metadata.create_all(engine)

    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.dispose()

    app = FastAPI(title='主播排班与个人工时', version='1.0.0', lifespan=lifespan,
                  docs_url='/docs' if settings.environment != 'production' else None,
                  redoc_url=None)
    app.state.settings = settings
    app.state.engine = engine
    app.state.exchange_code = exchange_code or (lambda code: auth.exchange_wechat(settings, code))
    for router in (auth.router, work_logs.router, companies.router, schedules.router, salaries.router, rooms.router):
        app.include_router(router, prefix='/api/v1')

    @app.get('/health')
    def health():
        with engine.connect() as connection:
            connection.execute(text('SELECT 1 FROM users LIMIT 1'))
        return {'status': 'ok'}

    @app.exception_handler(OperationalError)
    async def database_error(request, exc):
        logging.getLogger('zhubo').error('Database operation failed: %s', type(exc.orig).__name__)
        return JSONResponse(status_code=503, content={'detail': {'code': 'database_unavailable',
            'message': '数据库暂不可用，请稍后重试'}}, headers={'Retry-After': '2'})

    return app
