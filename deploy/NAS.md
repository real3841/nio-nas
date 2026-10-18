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

容器/主机重启后需要执行一次 `sh run-nas.sh start`。若要开机自启，把它加进 NAS 的计划任务：

```sh
# QNAP 控制台 → 计划任务 → 开机时执行
cd /path/to/nio-dash-nas && sh run-nas.sh start
```

## 注意

- 本仓库**不含**任何 Token、Cookie、车辆数据，`deploy/.env` 与 `data/` 都在 `.gitignore` 里。
- 通过反向代理访问时，「签名与密钥」「换电中转」两个面板会提示仅桌面 App 可用——这两个能力需要原生层接口（`/api/auth*`、`/api/vehicle-photos`），转发层没有实现。
