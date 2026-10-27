# 播时 · 主播与直播间排班

原生微信小程序 + FastAPI + SQLite，前后端分离。小程序默认进入「个人」，底部导航依次为「个人」「公司」「排班」。

- **个人排班**：只读汇总本人在各公司的排班，显示公司、直播间、时间、时长及冲突提示，支持公司与周/单日筛选。
- **公司信息**：仅展示公司名称、本人角色、公司切换、加入/创建及公司管理入口。邀请码仅创建者可见。
- **直播间排班**：在「排班」页选择公司、直播间和日期，默认全部直播间，按直播间展示当天主播安排。创建者和可排班成员可排班，普通主播仅看到本人记录及相关分组。
- **直播间管理**：创建者和可排班成员可新增、改名、停用。停用不删除历史记录，历史排班可取消或改派。
- **冲突提醒**：同公司同主播、同直播间的有效时间重叠合并提醒，确认后可保存；列表动态标记冲突，取消后不再参与计算。首尾相接不算重叠。
- **账号操作**：个人页提供修改姓名和退出登录，各入口保留登录指引。

个人页不提供记工时、快捷打卡或收入汇总，薪资入口已移除；历史薪资和个人工时的数据及兼容API保留。直播间为公司内部排班资源，不对接直播平台。

普通主播看不到其他主播的信息，冲突仅显示标记；公司运营无法查看主播在其他公司的安排。

## 在 VS Code 中运行

打开项目目录，在 PowerShell 终端执行：

```powershell
# 项目根目录；已有 .venv 时可跳过创建
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock
```

首次配置时复制 `backend/.env.example` 为 `backend/.env`，已有配置不要覆盖。生成至少32字符的随机 `ZHUBO_JWT_SECRET`；本地测试使用 `ZHUBO_ENVIRONMENT=development` 和 `ZHUBO_DEV_LOGIN_ENABLED=true`。

```powershell
cd backend
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --reload
```

接口文档：<http://127.0.0.1:8000/docs>；健康检查：<http://127.0.0.1:8000/health>。

用微信开发者工具导入 `miniprogram/`。本地可使用测试号并关闭合法域名校验，云服务选择「不使用云服务」。`miniprogram/config.js` 默认连接 `http://127.0.0.1:8000/api/v1`，开发测试登录不调用 `wx.login`。

启动后默认显示个人排班页。点击「开发测试登录」直接进入账号列表，选择一个账号即可登录，不需要先选择身份。个人页退出后可切换角色，同一账号的数据会保留。预置演示数据及体验顺序见 [docs/demo-data.md](docs/demo-data.md)。

个人页汇总本人全部公司的本周安排。公司页只显示公司信息；排班页默认今天，可前后切换日期。在直播间下点击“＋ 排班”，预填直播间和日期，明确选择主播后保存。跨午夜场次在相交的两天均显示，并按北京时间展示当天时段。

### 本次数据库升级（0004）

升级前先备份，在 `backend/` 下执行：

```powershell
..\.venv\Scripts\python.exe -m app.backup --source data/zhubo.db --output backups
..\.venv\Scripts\python.exe -m alembic upgrade head
```

新增直播间表和可空的排班直播间关联。旧记录不根据备注猜测直播间，统一显示“待分配直播间”，创建者或可排班成员编辑后选择有效直播间。新前端必选主播和直播间；旧API调用省略直播间仍兼容。升级后重启后端并重新编译小程序。

直播间接口：`GET/POST /api/v1/companies/{cid}/rooms`、`PATCH /api/v1/companies/{cid}/rooms/{rid}`。创建需 `Idempotency-Key`；PATCH可修改名称或将 `active` 设为false。公司成员可查询，创建者和可排班成员可写入。

### 公司身份与高效排班

所有账号都是普通用户，登录后可选择创建公司或用邀请码加入公司。公司创建者自动拥有本公司的管理权限；其他人加入后为普通成员，可由创建者“授权排班”，成为该公司的可排班成员。权限按公司生效，不是登录身份。

在排班卡片点击“复制排班”，可选明天、下周同一天或自选日期，预填主播、直播间、时间和备注。新增时也可按日期范围及星期重复，预览每场日期与时间后再明确保存，每批最多60场。跨午夜场次保留跨日跨度。生成的是独立排班，后续修改或取消只影响单场。

批量保存接口 `POST /api/v1/companies/{cid}/schedules/batch` 接收 `items`（1–60场、每项必选有效直播间）及 `confirm_overlap`。已有场次和本批内部重叠集中确认；任何校验/写入失败全部回滚，成功后通过请求标识去重，避免超时重试重复生成。新接口无数据库迁移。

个人页与排班页默认收起取消记录，点击“查看已取消（N）”展开；数量随当前筛选变化，取消记录仍不参与冲突。公司内统一显示创建者、可排班成员、普通成员。

## 测试与验收

在项目根目录执行：

```powershell
.\.venv\Scripts\python.exe -m pytest -c backend/pytest.ini backend/tests -q
node --test miniprogram/tests/*.test.js
.\tools\check-miniprogram.ps1
```

前端覆盖导航、账号隔离、排班编辑、重试去重、直播间管理和公共工具。后端继续验证权限、排班冲突、历史个人工时兼容、迁移和备份。原生编译器检查不代替模拟器与真机交互验收，清单见 [docs/acceptance.md](docs/acceptance.md)。

## 生产部署

小程序将 `loginMode` 改为 `wechat`，后端关闭开发登录并设置真实微信凭证；项目 AppID 必须配套。生产环境使用 HTTPS 合法域名，设置 `ZHUBO_ENVIRONMENT=production`，具体见 [deploy/README.md](deploy/README.md)。

数据库由 Alembic 显式迁移，部署前先备份。SQLite 使用单机单 worker 和持久化本地磁盘；保留在线备份工具。真机上的 `127.0.0.1` 不指向开发电脑。
