"""Company rooms and nullable room assignment, preserving legacy schedules."""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('rooms',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('name', sa.String(80), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='1'),
        sa.UniqueConstraint('company_id', 'name', name='uq_rooms_company_name'))
    # SQLite natively supports a nullable REFERENCES column without recreating the
    # table; this retains the original unnamed CHECK constraints and all data.
    op.execute('ALTER TABLE schedules ADD COLUMN room_id INTEGER REFERENCES rooms(id)')
    op.create_index('ix_schedules_room_time', 'schedules', ['room_id', 'start_at', 'end_at'])


def downgrade():
    op.drop_index('ix_schedules_room_time', table_name='schedules')
    op.drop_column('schedules', 'room_id')
    op.drop_table('rooms')
