import os

from alembic import context
from dotenv import load_dotenv

from app.db import Base, make_engine
from app import models  # noqa: F401

load_dotenv()
config = context.config
url = os.getenv('ZHUBO_DATABASE_URL', config.get_main_option('sqlalchemy.url'))

if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = make_engine(url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
