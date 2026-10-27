"""Private named salaries and immutable per-log salary snapshots."""
from alembic import op
import sqlalchemy as sa

revision='0003'
down_revision='0002'
branch_labels=None
depends_on=None


def upgrade():
    op.create_table('salaries',sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False),
        sa.Column('name',sa.String(80),nullable=False),sa.Column('hourly_rate_fen',sa.Integer(),nullable=False),
        sa.Column('deleted',sa.Boolean(),nullable=False,server_default='0'),
        sa.CheckConstraint('hourly_rate_fen >= 0',name='ck_salaries_rate'))
    op.create_index('ix_salaries_user','salaries',['user_id','deleted'])
    with op.batch_alter_table('work_logs',recreate='always') as batch:
        batch.add_column(sa.Column('salary_id',sa.Integer(),nullable=True))
        batch.add_column(sa.Column('salary_name',sa.String(80),nullable=True))
        batch.create_foreign_key('fk_work_logs_salary','salaries',['salary_id'],['id'])
    with op.batch_alter_table('work_log_defaults',recreate='always') as batch:
        batch.add_column(sa.Column('salary_id',sa.Integer(),nullable=True))
        batch.create_foreign_key('fk_work_log_defaults_salary','salaries',['salary_id'],['id'])
    db=op.get_bind()
    rates=db.execute(sa.text('SELECT user_id,hourly_rate_fen FROM work_logs WHERE hourly_rate_fen IS NOT NULL UNION SELECT user_id,hourly_rate_fen FROM work_log_defaults ORDER BY user_id,hourly_rate_fen')).fetchall()
    for uid,rate in rates:
        name=f'历史时薪{rate//100}.{rate%100:02d}元'
        sid=db.execute(sa.text('INSERT INTO salaries(user_id,name,hourly_rate_fen,deleted) VALUES(:uid,:name,:rate,0)'),{'uid':uid,'name':name,'rate':rate}).lastrowid
        db.execute(sa.text('UPDATE work_logs SET salary_id=:sid,salary_name=:name WHERE user_id=:uid AND hourly_rate_fen=:rate'),{'sid':sid,'name':name,'uid':uid,'rate':rate})
        db.execute(sa.text('UPDATE work_log_defaults SET salary_id=:sid WHERE user_id=:uid AND hourly_rate_fen=:rate'),{'sid':sid,'uid':uid,'rate':rate})


def downgrade():
    with op.batch_alter_table('work_logs',recreate='always') as batch:
        batch.drop_constraint('fk_work_logs_salary',type_='foreignkey')
        batch.drop_column('salary_id');batch.drop_column('salary_name')
    with op.batch_alter_table('work_log_defaults',recreate='always') as batch:
        batch.drop_constraint('fk_work_log_defaults_salary',type_='foreignkey')
        batch.drop_column('salary_id')
    op.drop_index('ix_salaries_user',table_name='salaries');op.drop_table('salaries')
