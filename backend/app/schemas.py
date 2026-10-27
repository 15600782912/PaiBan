from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class LoginInput(StrictModel):
    code: str = Field(min_length=1, max_length=256)
    display_name: str = Field(default='主播', min_length=1, max_length=40)


class ProfileInput(StrictModel):
    display_name: str = Field(min_length=1, max_length=40)


class DevLoginInput(StrictModel):
    account: str = Field(min_length=1, max_length=40, pattern=r'^[A-Za-z0-9_-]+$')
    display_name: str = Field(default='测试用户', min_length=1, max_length=40)


class IntervalInput(StrictModel):
    start_at: datetime
    end_at: datetime
    note: str = Field(default='', max_length=500)
    confirm_overlap: bool = False

    @field_validator('start_at', 'end_at')
    @classmethod
    def aware_minute(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError('时间必须包含时区')
        if value.second or value.microsecond:
            raise ValueError('时间精确到分钟，不接受秒')
        if not 2000 <= value.year <= 2100:
            raise ValueError('年份须在 2000–2100 之间')
        return value.astimezone(timezone.utc)

    @model_validator(mode='after')
    def positive(self):
        if self.end_at <= self.start_at:
            raise ValueError('结束时间必须晚于开始时间')
        return self


class ScheduleInput(IntervalInput):
    user_id: int = Field(gt=0)
    room_id: int | None = Field(default=None, gt=0, strict=True)


class BatchScheduleItem(ScheduleInput):
    room_id: int = Field(gt=0, strict=True)
    # Confirmation belongs to the entire transaction, never individual rows.
    confirm_overlap: Literal[False] = False


class BatchScheduleInput(StrictModel):
    items: list[BatchScheduleItem] = Field(min_length=1, max_length=60)
    confirm_overlap: bool = Field(default=False, strict=True)


class RoomInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)


class RoomUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    active: bool | None = Field(default=None, strict=True)

    @field_validator('name', 'active')
    @classmethod
    def not_null(cls, value):
        if value is None:
            raise ValueError('字段不可为空')
        return value

    @model_validator(mode='after')
    def not_empty(self):
        if not self.model_fields_set:
            raise ValueError('请提供需要修改的字段')
        return self


class WorkLogIntervalInput(IntervalInput):
    entry_type: Literal['interval'] = 'interval'
    hourly_rate_fen: int | None = Field(default=None,ge=0,le=100_000_000,strict=True)
    salary_id: int | None = Field(default=None,gt=0,strict=True)


class WorkLogDurationInput(StrictModel):
    entry_type: Literal['duration']
    record_date: str
    duration_minutes: int = Field(ge=1,le=1440,strict=True)
    hourly_rate_fen: int | None = Field(default=None,ge=0,le=100_000_000,strict=True)
    note: str = Field(default='',max_length=500)
    confirm_overlap: bool = False
    salary_id: int | None = Field(default=None,gt=0,strict=True)

    @field_validator('record_date')
    @classmethod
    def valid_date(cls,value):
        parsed=date.fromisoformat(value)
        if parsed.isoformat()!=value or not 2000<=parsed.year<=2100:
            raise ValueError('日期格式应为 YYYY-MM-DD，年份 2000–2100')
        return value


class WorkLogDefaultsInput(StrictModel):
    hourly_rate_fen: int = Field(ge=0,le=100_000_000,strict=True)
    duration_minutes: int = Field(ge=1,le=1440,strict=True)
    note: str = Field(default='',max_length=500)
    salary_id: int | None = Field(default=None,gt=0,strict=True)


class SalaryInput(StrictModel):
    name: str = Field(min_length=1,max_length=80)
    hourly_rate_fen: int = Field(ge=0,le=100_000_000,strict=True)


class ScheduleUpdate(ScheduleInput):
    version: int = Field(ge=1)


class VersionInput(StrictModel):
    version: int = Field(ge=1)


class CompanyInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)


class JoinInput(StrictModel):
    invite_code: str = Field(min_length=1, max_length=32)


class RoleInput(StrictModel):
    role: Literal['operator', 'member']
