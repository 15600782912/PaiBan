from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_prefix='ZHUBO_', extra='ignore')
    database_url: str = 'sqlite:///./data/zhubo.db'
    jwt_secret: str = Field(min_length=32)
    wechat_app_id: str = ''
    wechat_app_secret: str = ''
    environment: str = 'production'
    dev_login_enabled: bool = False
    token_days: int = Field(default=7, ge=1, le=30)

    @field_validator('jwt_secret')
    @classmethod
    def reject_placeholder(cls, value):
        if value.startswith('replace-'):
            raise ValueError('请生成随机 ZHUBO_JWT_SECRET，不可使用示例占位符')
        return value

    @property
    def development_login_allowed(self):
        return self.environment == 'development' and self.dev_login_enabled
