from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    openid: Mapped[str] = mapped_column(String(128), unique=True)
    display_name: Mapped[str] = mapped_column(String(40))


class Salary(Base):
    __tablename__ = 'salaries'
    __table_args__ = (CheckConstraint('hourly_rate_fen >= 0',name='ck_salaries_rate'),Index('ix_salaries_user','user_id','deleted'))
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    name: Mapped[str] = mapped_column(String(80))
    hourly_rate_fen: Mapped[int] = mapped_column(Integer)
    deleted: Mapped[bool] = mapped_column(default=False,server_default='0')


class WorkLog(Base):
    __tablename__ = 'work_logs'
    __table_args__ = (CheckConstraint('end_at > start_at',name='ck_work_logs_interval_order'),
        CheckConstraint("(entry_type = 'interval' AND start_at IS NOT NULL AND end_at IS NOT NULL AND record_date IS NULL AND duration_minutes IS NULL) OR (entry_type = 'duration' AND start_at IS NULL AND end_at IS NULL AND record_date IS NOT NULL AND duration_minutes BETWEEN 1 AND 1440)",name='ck_work_logs_type'),
        CheckConstraint('hourly_rate_fen IS NULL OR hourly_rate_fen >= 0',name='ck_work_logs_rate'),
        Index('ix_logs_user_time', 'user_id', 'start_at', 'end_at'),Index('ix_logs_user_date', 'user_id', 'record_date'))
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    # UTC integer epoch seconds only for interval records; duration records have no fabricated times.
    start_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    entry_type: Mapped[str] = mapped_column(String(16),default='interval',server_default='interval')
    record_date: Mapped[str | None] = mapped_column(String(10),nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer,nullable=True)
    hourly_rate_fen: Mapped[int | None] = mapped_column(Integer,nullable=True)
    salary_id: Mapped[int | None] = mapped_column(ForeignKey('salaries.id'),nullable=True)
    salary_name: Mapped[str | None] = mapped_column(String(80),nullable=True)
    note: Mapped[str] = mapped_column(String(500), default='')


class WorkLogDefaults(Base):
    __tablename__ = 'work_log_defaults'
    __table_args__ = (CheckConstraint('duration_minutes BETWEEN 1 AND 1440',name='ck_defaults_duration'),CheckConstraint('hourly_rate_fen >= 0',name='ck_defaults_rate'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'),primary_key=True)
    hourly_rate_fen: Mapped[int] = mapped_column(Integer)
    salary_id: Mapped[int | None] = mapped_column(ForeignKey('salaries.id'),nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(String(500),default='')


class Company(Base):
    __tablename__ = 'companies'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    owner_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    invite_code: Mapped[str] = mapped_column(String(32), unique=True)


class Membership(Base):
    __tablename__ = 'memberships'
    __table_args__ = (UniqueConstraint('company_id', 'user_id'),
                     CheckConstraint("role IN ('owner','operator','member')"))
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey('companies.id'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    role: Mapped[str] = mapped_column(String(16), default='member')
    active: Mapped[bool] = mapped_column(default=True)


class Room(Base):
    __tablename__ = 'rooms'
    __table_args__ = (UniqueConstraint('company_id', 'name', name='uq_rooms_company_name'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey('companies.id'))
    name: Mapped[str] = mapped_column(String(80))
    active: Mapped[bool] = mapped_column(default=True, server_default='1')


class Schedule(Base):
    __tablename__ = 'schedules'
    __table_args__ = (CheckConstraint('end_at > start_at'),
                     CheckConstraint("status IN ('active','cancelled')"),
                     Index('ix_schedules_user_time', 'user_id', 'start_at', 'end_at'),
                     Index('ix_schedules_company', 'company_id', 'start_at'),
                     Index('ix_schedules_room_time', 'room_id', 'start_at', 'end_at'))
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey('companies.id'))
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    room_id: Mapped[int | None] = mapped_column(ForeignKey('rooms.id'), nullable=True)
    start_at: Mapped[int] = mapped_column(Integer)
    end_at: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(String(500), default='')
    version: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(String(16), default='active')


class Idempotency(Base):
    __tablename__ = 'idempotency'
    __table_args__ = (UniqueConstraint('user_id', 'scope', 'key'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'))
    scope: Mapped[str] = mapped_column(String(120))
    key: Mapped[str] = mapped_column(String(100))
    digest: Mapped[str] = mapped_column(String(64))
    response: Mapped[str] = mapped_column(Text)
