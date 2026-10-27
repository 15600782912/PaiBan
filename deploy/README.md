# 单机部署示例

示例按 Linux + systemd + Nginx，项目放在 `/opt/zhubo`，服务账户为 `zhubo`。以下文件是模板，不会自动修改你的服务器。

1. 创建服务账户，准备 Python 虚拟环境，安装 `backend/requirements.lock`，让服务账户可写 `backend/data`、`backend/backups`；代码目录保持只读。
2. 配置 `backend/.env`：`ZHUBO_ENVIRONMENT=production`、`ZHUBO_DEV_LOGIN_ENABLED=false`、随机 JWT 密钥、真实微信凭证、`ZHUBO_DATABASE_URL=sqlite:////opt/zhubo/backend/data/zhubo.db`。仅允许服务账户读取 `.env`。小程序 `loginMode` 设为 `wechat`；开发测试账号与令牌不能用于生产环境。
3. 在 `backend` 下执行 `/opt/zhubo/.venv/bin/python -m alembic upgrade head`。
4. 调整并安装本目录的 `zhubo.service`、`zhubo-backup.service`、`zhubo-backup.timer`；启用应用服务及备份 timer。每天北京时间 03:00 备份，保留 30 天。
5. 配置 Nginx 模板中的域名和有效 TLS 证书，转发至 `127.0.0.1:8000`；应用端口不对公网开放。根据业务流量调整登录限流。
6. 将 HTTPS 域名配置为微信 `request` 合法域名，更新小程序 `config.js`，走通三种角色的手机验收后发布。

日志通过 journald 收集；访问日志不要记录 Authorization、微信 code、AppSecret、个人工时请求/响应体。通过 `/health` 监控服务及数据库可用性；timer 的失败退出和备份完整性失败应接入服务器告警。

恢复演练：停止服务，在新的临时路径打开备份执行 `PRAGMA integrity_check` 并检查记录；恢复到数据库路径前保留当前数据库及配套 WAL/SHM；确认服务已停止后整体移走旧文件，放入备份，修正所有权，再启动服务。不要在服务运行时覆盖数据库文件，也不要直接只复制活动中的 `.db` 文件备份。

生产迁移前先备份；本次首次迁移无旧数据兼容问题。`alembic downgrade base` 会删除全部业务表，仅供临时测试数据库使用。
