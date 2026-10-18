#!/bin/sh
# 蔚来车辆看板 · NAS 常驻运行（采集 + 网页看板）
#
#   sh run-nas.sh start     启动并守护（进程挂了 10 秒后自动拉起）
#   sh run-nas.sh stop      停止
#   sh run-nas.sh status    查看状态与轨迹进度
#   sh run-nas.sh restart   重启
#
# 环境变量（都可省略，下面是默认值）：
#   NIO_DATA_DIR   数据目录      /workspace/nio-dash/data
#   NIO_WEB_PORT   网页端口      8788
#   NIO_API_PORT   内部接口端口  8789
set -u

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DATA_DIR=${NIO_DATA_DIR:-/workspace/nio-dash/data}
WEB_PORT=${NIO_WEB_PORT:-8788}
API_PORT=${NIO_API_PORT:-8789}
RUN_DIR=/workspace/nio-dash
PID_FILE="$RUN_DIR/serve-web.pid"
LOG_FILE="$RUN_DIR/serve-web.log"

start() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "已在运行（PID $(cat "$PID_FILE")）"
    return 0
  fi
  if [ ! -d "$APP_DIR/dist" ]; then
    echo "缺少 dist/，先执行：npm ci && npm run build"
    return 1
  fi
  if [ ! -f "$APP_DIR/deploy/.env" ]; then
    echo "缺少 deploy/.env，先按 deploy/.env.example 填好密钥"
    return 1
  fi
  mkdir -p "$DATA_DIR" "$RUN_DIR"
  cd "$APP_DIR" || exit 1
  NIO_DATA_DIR="$DATA_DIR" NIO_WEB_PORT="$WEB_PORT" NIO_API_PORT="$API_PORT" \
    setsid nohup sh -c '
      while true; do
        node_modules/.bin/tsx scripts/serve-web.ts
        echo "[guard] 进程退出，10 秒后重启 $(date "+%F %T")"
        sleep 10
      done
    ' >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 3
  echo "已启动（守护 PID $(cat "$PID_FILE")）· 网页端口 $WEB_PORT · 数据 $DATA_DIR"
}

stop() {
  [ -f "$PID_FILE" ] && kill "$(cat "$PID_FILE")" 2>/dev/null
  pkill -f "scripts/serve-web.ts" 2>/dev/null
  rm -f "$PID_FILE"
  echo "已停止"
}

status() {
  if curl -s -m 3 -o /dev/null "http://127.0.0.1:$WEB_PORT/"; then
    echo "运行中 · http://127.0.0.1:$WEB_PORT"
    echo -n "  轨迹："
    curl -s -m 3 "http://127.0.0.1:$WEB_PORT/api/tracks/status"
    echo
  else
    echo "未运行"
  fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 2; start ;;
  status) status ;;
  *) echo "用法: sh run-nas.sh {start|stop|restart|status}" ;;
esac
