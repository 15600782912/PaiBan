"""Private date-duration entries, optional rates and personal defaults."""
from alembic import op
import sqlalchemy as sa

revision='0002'
down_revision='0001'
branch_labels=None
depends_on=None


def upgrade():
    with op.batch_alter_table('work_logs',recreate='always') as batch:
        batch.alter_column('start_at',existing_type=sa.Integer(),nullable=True)
        batch.alter_column('end_at',existing_type=sa.Integer(),nullable=True)
        batch.add_column(sa.Column('entry_type',sa.String(16),nullable=False,server_default='interval'))
        batch.add_column(sa.Column('record_date',sa.String(10),nullable=True))
        batch.add_column(sa.Column('duration_minutes',sa.Integer(),nullable=True))
        batch.add_column(sa.Column('hourly_rate_fen',sa.Integer(),nullable=True))
        batch.create_check_constraint('ck_work_logs_interval_order','end_at > start_at')
        batch.create_check_constraint('ck_work_logs_type',"(entry_type = 'interval' AND start_at IS NOT NULL AND end_at IS NOT NULL AND record_date IS NULL AND duration_minutes IS NULL) OR (entry_type = 'duration' AND start_at IS NULL AND end_at IS NULL AND record_date IS NOT NULL AND duration_minutes BETWEEN 1 AND 1440)")
        batch.create_check_constraint('ck_work_logs_rate','hourly_rate_fen IS NULL OR hourly_rate_fen >= 0')
        batch.create_index('ix_logs_user_date',['user_id','record_date'])
    op.create_table('work_log_defaults',sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id'),primary_key=True),
        sa.Column('hourly_rate_fen',sa.Integer(),nullable=False),sa.Column('duration_minutes',sa.Integer(),nullable=False),
        sa.Column('note',sa.String(500),nullable=False),
        sa.CheckConstraint('duration_minutes BETWEEN 1 AND 1440',name='ck_defaults_duration'),
        sa.CheckConstraint('hourly_rate_fen >= 0',name='ck_defaults_rate'))


def downgrade():
    if op.get_bind().execute(sa.text("SELECT count(*) FROM work_logs WHERE entry_type = 'duration'")).scalar():
        raise RuntimeError('Cannot downgrade duration entries to interval-only schema; restore a verified backup instead')
    op.drop_table('work_log_defaults')
    with op.batch_alter_table('work_logs',recreate='always') as batch:
        batch.drop_constraint('ck_work_logs_interval_order',type_='check')
        batch.drop_constraint('ck_work_logs_type',type_='check')
        batch.drop_constraint('ck_work_logs_rate',type_='check')
        batch.drop_index('ix_logs_user_date')
        for name in ['hourly_rate_fen','duration_minutes','record_date','entry_type']:
            batch.drop_column(name)
        batch.alter_column('start_at',existing_type=sa.Integer(),nullable=False)
        batch.alter_column('end_at',existing_type=sa.Integer(),nullable=False)
        batch.create_check_constraint('ck_work_logs_interval_order','end_at > start_at')
