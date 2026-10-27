"""Initial explicit schema for users, private logs, companies and schedules."""
from alembic import op
import sqlalchemy as sa

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('users', sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('openid',sa.String(128),nullable=False,unique=True),
        sa.Column('display_name',sa.String(40),nullable=False))
    op.create_table('work_logs',sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False),
        sa.Column('start_at',sa.Integer(),nullable=False),sa.Column('end_at',sa.Integer(),nullable=False),
        sa.Column('note',sa.String(500),nullable=False),sa.CheckConstraint('end_at > start_at'))
    op.create_index('ix_logs_user_time','work_logs',['user_id','start_at','end_at'])
    op.create_table('companies',sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('name',sa.String(80),nullable=False),
        sa.Column('owner_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False),
        sa.Column('invite_code',sa.String(32),nullable=False,unique=True))
    op.create_table('memberships',sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('company_id',sa.Integer(),sa.ForeignKey('companies.id'),nullable=False),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False),
        sa.Column('role',sa.String(16),nullable=False),sa.Column('active',sa.Boolean(),nullable=False),
        sa.UniqueConstraint('company_id','user_id'),sa.CheckConstraint("role IN ('owner','operator','member')"))
    op.create_table('schedules',sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('company_id',sa.Integer(),sa.ForeignKey('companies.id'),nullable=False),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False),
        sa.Column('start_at',sa.Integer(),nullable=False),sa.Column('end_at',sa.Integer(),nullable=False),
        sa.Column('note',sa.String(500),nullable=False),sa.Column('version',sa.Integer(),nullable=False),
        sa.Column('status',sa.String(16),nullable=False),sa.CheckConstraint('end_at > start_at'),
        sa.CheckConstraint("status IN ('active','cancelled')"))
    op.create_index('ix_schedules_user_time','schedules',['user_id','start_at','end_at'])
    op.create_index('ix_schedules_company','schedules',['company_id','start_at'])
    op.create_table('idempotency',sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('users.id'),nullable=False),
        sa.Column('scope',sa.String(120),nullable=False),sa.Column('key',sa.String(100),nullable=False),
        sa.Column('digest',sa.String(64),nullable=False),sa.Column('response',sa.Text(),nullable=False),
        sa.UniqueConstraint('user_id','scope','key'))


def downgrade():
    for name in ['idempotency','schedules','memberships','companies','work_logs','users']:
        op.drop_table(name)
