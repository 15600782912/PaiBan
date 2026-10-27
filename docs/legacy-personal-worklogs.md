> 历史版本说明：个人记工时和月历已从当前小程序移除。本文仅用于理解保留的后端接口与历史数据，不代表当前界面。

# 播时 · 主播排班与个人工时

原生微信小程序 + FastAPI + SQLite，前后端分离。小程序包含「个人」「薪资」「公司」三个底部入口。

- **个人工时**：填写起止日期时间，可编辑删除；按北京时间拆分每日/月度时长，仅本人可见。
- **月历与收入**：日期下显示工时和已记录收入；支持时薪、日期时长打卡、一套快捷默认设置、底部编辑表单及金额隐藏，旧记录可补填时薪。
- **个人薪资**：新增、编辑、删除带名称的时薪，例如“常规场（80.00元/小时）”；所有工时入口使用薪资下拉框，薪资列表仅本人可见。
- **公司排班**：创建公司、邀请码加入、多公司切换；管理员/运营排班，主播只读自己的排班。
- **权限与冲突**：个人工时不向公司开放；跨公司冲突只提醒本人；排班版本校验，创建请求去重。

## 本地运行

需要 Python 3.11+、Node.js 18+（仅运行前端测试）和微信开发者工具。当前工作区已建立 `.venv`。

在项目根目录的 PowerShell 中执行：

```powershell
# 如果需要重新创建虚拟环境：python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock
Copy-Item backend/.env.example backend/.env
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
```

编辑 `backend/.env`，填写随机生成的 `ZHUBO_JWT_SECRET`。本地默认使用开发测试登录，设置 `ZHUBO_ENVIRONMENT=development`、`ZHUBO_DEV_LOGIN_ENABLED=true`，无需填写微信 AppID/AppSecret。

当前工作区已配置开发测试登录。后端用于签发令牌的随机密钥保留，不需要重新填写。此模式只用于本地开发，不要把测试服务开放到公网。

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --reload
```

开发环境接口文档：<http://127.0.0.1:8000/docs>；健康检查：<http://127.0.0.1:8000/health>。

### 小程序

1. 微信开发者工具导入 `miniprogram/`，可使用开发者工具测试号开发。当前默认的开发测试登录不调用 `wx.login`，不需要微信密钥。
2. `miniprogram/config.js` 默认连接 `http://127.0.0.1:8000/api/v1`。仅本机开发时，可在开发者工具中临时关闭合法域名校验。
3. 真机调试和上线应改为 HTTPS 接口地址，并在微信小程序后台配置该 `request` 合法域名；真机的 `127.0.0.1` 不是开发电脑。
4. 点击「开发测试登录」，选择测试用户1/2/3。同一账号再次登录仍保留原数据；在个人页退出后可切换账号。测试账号本身不带管理员/运营权限，权限由公司角色决定。
5. 用用户1创建公司，进入「公司管理」复制邀请码；退出后用用户2加入。再切回用户1，可以给用户2授予运营权限、安排排班，测试不同角色。

### 薪资与打卡

1. 进入「薪资」添加名称和时薪，例如“常规场，80元/小时”。
2. 返回「个人」，展开「快捷打卡设置」，从下拉框选薪资，填时长和备注并保存；选日期后可快捷打卡。
3. 日期打卡底部表单及旧起止时间编辑页使用同一薪资列表。空列表会提示去添加，不会自动套用第一项。
4. 薪资改价只影响后续选择和新打卡，历史记录保留名称/价格快照。旧记录编辑默认“保留原薪资”，明确换选才更新价格。
5. 删除薪资保留历史工时和收入；绑定它的快捷设置保留时长、备注，但需要重新选择薪资并保存。
6. 表单打开期间遇到改价/删除，会提示重新选择并刷新选项，时长和备注保留。切换账号会清理旧账号草稿，避免把待重试内容提交给新账号。

### 切换真实微信登录

将 `miniprogram/config.js` 的 `loginMode` 改为 `wechat`，后端设置 `ZHUBO_DEV_LOGIN_ENABLED=false`，填写配套的真实小程序 `ZHUBO_WECHAT_APP_ID` 和 `ZHUBO_WECHAT_APP_SECRET`，开发者工具项目使用同一个 AppID，重启后端并重新编译。AppSecret 仅保存在后端。生产环境设置 `ZHUBO_ENVIRONMENT=production`，即使误开启测试登录开关也会拒绝测试登录及旧测试令牌。

## 测试与验收

```powershell
# 项目根目录
.\.venv\Scripts\python.exe -m pytest -c backend/pytest.ini backend/tests -q
node --test miniprogram/tests/*.test.js
# Windows 下调用已安装的微信开发者工具原生编译器，另检 JS 和 JSON
.\tools\check-miniprogram.ps1
```

后端集成测试使用临时 SQLite 文件，微信凭证兑换仅在测试中注入替身，开发测试登录必须同时满足开发环境和显式开关，生产环境不可使用。覆盖身份验证、个人数据隔离、角色变更、成员退出、多公司冲突、跨月/跨年汇总、重复提交、并发修改、显式迁移及在线备份恢复。前端测试运行实际时间工具、请求封装和编辑页逻辑。

当前自动化测试不能代替微信开发者工具编译和手机验收；真实微信凭证、域名和设备需要由部署方提供。手动验收清单见 [docs/acceptance.md](acceptance.md)。

## 接口与规则

接口前缀 `/api/v1`，登录后使用 `Authorization: Bearer <token>`。完整参数与响应可查看开发环境 `/docs`。

| 接口 | 行为 |
| --- | --- |
| `POST /auth/wechat` | 用微信 code 登录，返回令牌和用户资料 |
| `POST /auth/dev` | 仅显式开启的开发环境：用稳定测试账号登录，无需微信密钥 |
| `GET/PATCH /me` | 查询/修改本人姓名 |
| `GET/PUT /me/work-log-defaults` | 查询/保存本人快捷时薪、时长及备注 |
| `GET/POST /salaries` | 查询/新增本人的薪资项，新增需 Idempotency-Key |
| `PUT/DELETE /salaries/{id}` | 修改/删除本人的薪资项 |
| `GET/POST /work-logs` | 按月份查本人工时/新增工时 |
| `GET/PUT/DELETE /work-logs/{id}` | 本人记录详情、修改、删除 |
| `GET/POST /companies` | 查询已加入公司/创建公司 |
| `POST /companies/join` | 输入邀请码加入 |
| `PATCH /companies/{cid}` | 管理员修改公司名称 |
| `POST /companies/{cid}/invite/reset` | 管理员重置邀请码 |
| `GET /companies/{cid}/members` | 管理员/运营查询有效成员 |
| `PATCH/DELETE /companies/{cid}/members/{uid}` | 管理员设置角色/移除成员 |
| `POST /companies/{cid}/leave` | 非创建者退出公司 |
| `GET/POST /companies/{cid}/schedules` | 按权限查询/新增排班 |
| `PUT /companies/{cid}/schedules/{sid}` | 管理员/运营修改排班，必须带 version |
| `POST /companies/{cid}/schedules/{sid}/cancel` | 取消排班，必须带 version |
| `GET /my-schedules` | 本人在有效公司中的排班及冲突标记 |

- 工时列表参数 `month=2030-01`，默认北京时间本月；包含跨月记录的原始起止时间、整条时长 `minutes`、本月计入时长 `month_minutes`、`daily_minutes` 和 `total_minutes`。
- 月度响应还包含 `daily_income_fen`、`total_income_fen`、`daily_unpriced_count` 和 `unpriced_count`。每条记录返回自身的每日分配；未设时薪不当作零收入，界面显示待补填提示。
- 新按日期记录请求使用 `entry_type: "duration"`、`record_date: "2026-10-24"`、`duration_minutes: 240`、`hourly_rate_fen: 8000`、`note`。起止时间记录可省略 `entry_type` 保持兼容。日历新记录不虚构开始、结束时间。
- 时薪最多两位小数，非负且最高100万元/小时；内部整数分保存。日期时长范围1–1440分钟。每笔按「时薪分×分钟÷60」四舍五入到分，跨天起止时间记录逐个北京时间自然日计价再汇总。
- 默认设置只影响将来新记录，每条记录保存自己的时薪。旧记录时薪为空，待本人编辑补填；省略时薪字段的旧客户端更新不会清除既有时薪。
- 新客户端选薪资时传 `salary_id` 和表单显示的 `hourly_rate_fen`，后端校验归属及当前价格。价格变化返回409 `salary_changed`；被删除或非本人的薪资返回404 `salary_unavailable`。历史编辑若保留原薪资，省略这两个字段，维持历史快照。
- 默认设置关联的薪资改价后，查询设置返回最新薪资名称和价格；删除后 `salary_id` 为null，需要重新选薪资。历史记录的 `salary_name` 和 `hourly_rate_fen` 不随薪资库修改。
- 快捷设置编辑后须先保存，快捷打卡使用已保存值；手动日期打卡预填默认值，但修改表单不会修改默认设置。同日已有记录需确认后追加。
- 排班列表可传 `start_at`、`end_at`，筛选与区间有交集的记录；前端默认显示所选周，可切换单日。
- 所有写入起止时间必须带时区、精确到分钟，结束必须晚于开始；年份支持 2000–2100。数据库使用 UTC Unix 秒保存。
- 创建公司、工时、排班必须传 `Idempotency-Key`；同一用户同一接口重复请求返回首次成功结果，键相同但内容变化返回 409。
- 重叠时返回 `409`，错误代码 `overlap`；明确确认后带 `confirm_overlap: true` 重试。首尾相接不算重叠；个人记录允许重叠并按条累加。
- 版本冲突代码 `stale_version`，需重新加载后编辑。前端不会悄悄覆盖其他运营的修改。
- 退出/移除取消尚未开始的有效排班，历史记录保留；重新加入默认普通成员，已取消排班不会恢复。
- 不存在或非本人的个人工时统一返回 404；跨公司越权返回 403。错误一般为 `detail: {code, message}`，参数验证错误使用 FastAPI 的 detail 数组。

## 部署与备份

见 [deploy/README.md](../deploy/README.md)。生产启动前必须执行 Alembic 迁移，不在启动时自动建表。单机单 worker，数据库位于持久化本地磁盘，暂不支持多机共享 SQLite 文件。

```powershell
# 在 backend/ 下执行；服务运行期间也可备份
..\.venv\Scripts\python.exe -m app.backup --source data/zhubo.db --output backups --retain-days 30
```

备份通过 SQLite 在线备份接口生成、校验完整性后原子发布，只清理本工具生成且超过保留期的文件。恢复时先停止服务，把验证过的备份恢复到数据库路径，并在确认无进程占用后移走旧数据库配套的 WAL/SHM，再启动服务。定期把备份复制到独立存储，并执行恢复演练。

不包含定位/实时上下班考勤、工时审批、工资发放、提成、自动排班、直播平台对接、消息推送、公司注销和所有权转移。个人“打卡”指手动登记工时与预计收入。

月历版本需要迁移到 `0002`：先备份，再在 `backend/` 下执行 `alembic upgrade head`。此工作区的本地数据库已完成备份和升级。已有按时长记录无法无损降级到旧版起止时间结构，迁移会拒绝此类降级，请使用升级前的验证备份恢复。

薪资列表版本需要迁移到 `0003`，本工作区已备份并升级。迁移按每个用户已有的不同非空时薪生成“历史时薪80.00元”等选项并关联，零时薪也保留；原有工时和收入不变，未定价记录继续待补填。可在「薪资」页重命名自动生成的选项。
