# NAS 常驻部署

这个仓库是 [nio-dash-v2](https://github.com/real3841/nio-dash-v2) 的完整源码副本，专门用来在 NAS / 服务器上 24 小时运行：**采集 + 网页看板**，不需要 Mac 开着。

## 与 nio-dash-v2 的区别

| | nio-dash-v2 | 本仓库 |
|---|---|---|
| 目标 | macOS 桌面 App（Swift + WKWebView） | Linux / NAS 常驻服务 |
| 启动 | 双击 App | `sh run-nas.sh start` |
| 界面 | 原生窗口 | 浏览器 |
| 采集 | App 内定时器 | 独立 Node 进程 |

数据层、前端代码、版本号完全一致，改前端需要两边都同步（或只改这边，桌面 App 按需拉回去）。

## 两条部署路线

| 路线 | 入口 | 适合 |
|---|---|---|
| **直跑 Node**（本文） | `sh run-nas.sh start` | 已有 Node 环境，想直接控制采集进程与历史回填 |
| Docker Compose（仓库自带） | `sh deploy/setup.sh` | 想完全隔离，`docker-compose.yml` 里有 fetcher + nginx 两个容器 |

两条路线用的是同一套采集逻辑，数据格式一致，选一条即可。

## 部署

```sh
git clone https://github.com/real3841/nio-dash-nas.git
cd nio-dash-nas

npm ci
npm run build                # 生成 dist/

cp deploy/.env.example deploy/.env
vi deploy/.env               # 填 NIO_ACCESS_TOKEN 等，见下

sh run-nas.sh start
sh run-nas.sh status
```

`deploy/.env` 最少需要 `NIO_ACCESS_TOKEN`（车辆/行程接口）。换电、签到、高德逆地理编码等按需补充，字段说明见 `deploy/.env.example`。

## 端口

| 端口 | 用途 | 暴露建议 |
|---|---|---|
| 8788 | 网页看板（静态前端 + `/data` + 轨迹接口） | 局域网 / 反向代理 |
| 8789 | 内部接口（车辆、换电、签到、配置） | **只对本机**，由 8788 转发 |

网页看板通过 `/api/*` 访问 8789，所以外部只需要开 8788。

### 反向代理示例（QNAP QTS）

控制台 → 应用程序 → 反向代理服务器 → 新增：

- 来源：`<NAS IP>:6300`
- 目标：`http://<容器 IP>:8788`

## 数据目录

默认 `/workspace/nio-dash/data`（可用 `NIO_DATA_DIR` 覆盖）：

```
vehicle.json          车辆状态
battery-orders.json   换电订单
battery-ledger.json   换电台账
trips.json            行程
tracks-index.json     轨迹索引
tracks-YYYY-MM.json   每月轨迹点
```

前端直接读这些 JSON，所以采集进程重启不影响看板展示。

## 补全历史轨迹

```sh
# 补到购车月（示例：2025-06 起，共 17 个月）
node_modules/.bin/tsx scripts/fetch-tracks.ts --months 17 --from 2025-06 --out /workspace/nio-dash/data
```

已存在的月份会跳过，可随时中断重跑。每月约 12–20 分钟。

## 常驻与自启

`run-nas.sh start` 用 `setsid nohup` 守护，进程异常退出 10 秒后自动拉起。

容器/主机重启后需要执行一次 `sh run-nas.sh start`。`run-nas.sh` 的守护循环只能应对**进程崩溃**，容器重启后它自己也一起没了——所以要么手工执行一次，要么在 NAS 上加计划任务。

```sh
# QNAP 控制台 → 计划任务 → 用户定义的脚本（建议「每 5 分钟」+「开机时」各一条）
docker exec <容器名> sh -c 'cd /workspace/nio-dash-nas && sh run-nas.sh start'
```

容器名在 Container Station 里能看到，也可以用 `docker ps --format '{{.Names}}'` 查。脚本是幂等的：已经在跑时 `run-nas.sh start` 只打印「已在运行」，不会起第二份。

## 注意

- 本仓库**不含**任何 Token、Cookie、车辆数据，`deploy/.env` 与 `data/` 都在 `.gitignore` 里。
- 通过反向代理访问时，「签名与密钥」「换电中转」两个面板会提示仅桌面 App 可用——这两个能力需要原生层接口（`/api/auth*`、`/api/vehicle-photos`），转发层没有实现。

## 备份

每天 **03:30（北京时间）** 自动备份一次，也可以在「数据同步 → 备份」里点「立即备份」。

- 归档位置：`/workspace/nio-backup/{daily,weekly,monthly}/nio-backup-YYYYMMDD-HHMMSS.tar.gz`
- 内容：`data/` 下全部数据 + `deploy/.env`（配置与 Token）+ `manifest.json`（sha256 清单）
- 保留：日备 7 份、周备 4 份、月备 6 份；更老的自动删
- 写归档走 `.partial` 临时文件，成功才改名；manifest sha256 校验不过不会覆盖已有归档

手动备份与下载：

```sh
cd /workspace/nio-dash-nas
node_modules/.bin/tsx scripts/backup.ts run        # 立即备份
node_modules/.bin/tsx scripts/backup.ts list       # 看现有归档

# 网页里下载：数据同步 → 备份 → 下载（走 /api/backup/download）
```

`NIO_BACKUP_DIR` 可改归档目录；`NIO_BACKUP_NOW=1` 让定时任务无视「今天已备过」立即跑。

## 恢复（换容器也用这一套）

```sh
cd /workspace/nio-dash-nas
node_modules/.bin/tsx scripts/backup.ts restore \
  --archive /workspace/nio-backup/daily/nio-backup-20261019-052613.tar.gz \
  --to /tmp/drill
```

- `--to` 必须是空目录；非空要加 `--force`（允许写入，同名文件被覆盖，多余文件保留不删）
- 先解到临时目录、校验 manifest、再整体移动；校验失败不会写入目标
- 恢复出来的 `deploy/.env` 权限为 600

### 恢复后校验

```sh
# 1) 目录结构：应有 data/ 与 deploy/.env
ls /tmp/drill/data/tracks-index.json /tmp/drill/deploy/.env

# 2) 用恢复出来的数据起一个临时看板（不同端口，只读、不轮询）
cd /workspace/nio-dash-nas
NIO_DATA_DIR=/tmp/drill/data NIO_ENV_FILE=/tmp/drill/deploy/.env \
NIO_WEB_PORT=8899 NIO_API_PORT=8898 NIO_DRILL=1 \
node_modules/.bin/tsx scripts/serve-web.ts

# 3) 另开一个终端对比轨迹统计，应与正式看板完全一致
curl -s http://127.0.0.1:8899/api/tracks/status
curl -s http://127.0.0.1:8788/api/tracks/status
curl -s http://127.0.0.1:8899/data/vehicle.json | head -c 200
```

`NIO_DRILL=1` 只关掉轮询与抓取，静态页和数据接口照常，适合演练。确认无误后 `kill` 掉临时进程。

### 演练记录

- 2026-10-19：恢复 最近的日备份到 `/tmp/drill`，全部文件 sha256 校验通过；`NIO_DRILL=1` 起在 8899，`/api/tracks/status` 与正式服务 8788 输出逐字节一致（月数、趟数、里程均为全量），`/data/vehicle.json` 正常返回，首页 200。演练后已关闭临时进程、删除目录。

## 告警

「数据同步 → 告警」里填两个地址（至少一个），保存后点「发送测试消息」验证：

- 通用 Webhook：POST JSON `{event, level, title, message, ts}`
- 企业微信群机器人：POST `{msgtype:"markdown", markdown:{content}}`

触发条件：采集连续失败 3 次、超过 6 小时没有成功采集、Token/签名类错误、定时备份失败。同一事件同一天只发一次；发送失败会 2 秒后重试一次，重试用尽不占用当天名额。

保存的是 `deploy/.env` 里的 `NIO_ALERT_WEBHOOK_URL` / `NIO_ALERT_WECOM_URL`；不想用网页也可以直接改 `.env` 后重启。
