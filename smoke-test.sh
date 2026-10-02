#!/usr/bin/env bash
# smoke-test.sh — ClawDao 图像工厂 端到端冒烟测试
#
# 流程：health → POST /api/task/create → 轮询 /api/task/:id → 校验 outputs/*.jpeg
#
# 用法：
#   bash smoke-test.sh                       # 默认 18795
#   API_PORT=7001 bash smoke-test.sh         # 自定义端口
#   CATEGORY=top_banner bash smoke-test.sh   # 自定义 category
#
# 退出码：0=通过 / 1=health 失败 / 2=create 失败 / 3=轮询失败 / 4=输出文件缺失
#         / 5=HTTP 静态文件 404 / 6=超时

set -u
API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-18795}"
BASE="http://${API_HOST}:${API_PORT}"
CATEGORY="${CATEGORY:-cover}"
SCENE="${SCENE:-livestream}"
COLOR_TONE="${COLOR_TONE:-blue_purple}"
USE_LOBSTER="${USE_LOBSTER:-true}"
POLL_MAX="${POLL_MAX:-30}"      # 30 * 3s = 90s
POLL_INTERVAL="${POLL_INTERVAL:-3}"
TITLE="${TITLE:-Smoke Test · 直播封面}"
SUBTITLE="${SUBTITLE:-端到端冒烟测试}"

say()  { printf "\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[1;32m✔ %s\033[0m\n" "$*"; }
fail() { printf "  \033[1;31m✘ %s\033[0m\n" "$*"; exit "${2:-1}"; }
# 从 JSON 取字段：jq_get '<json>' path.a.b.c
jq_get() { python3 -c "import sys,json; d=json.loads(sys.argv[1]); keys=sys.argv[2].split('.'); [d:=d[k] for k in keys]; print(d)" "$1" "$2"; }
jq_get_def() { python3 -c "import sys,json; d=json.loads(sys.argv[1]); keys=sys.argv[2].split('.'); 
for k in keys:
    if isinstance(d, dict) and k in d: d=d[k]
    else: d=sys.argv[3]; break
print(d)" "$1" "$2" "$3"; }

say "[1/5] GET /api/health"
HEALTH=$(curl -fsS --max-time 5 "${BASE}/api/health") || fail "health unreachable" 1
KEY_OK=$(jq_get "$HEALTH" data.keyConfigured)
[ "$KEY_OK" = "True" ] && ok "key 已配置 (MiniMax)" || fail "key 未配置（MINIMAX_API_KEY/MINIMAX_CN_API_KEY/auth.json）" 1

say "[2/5] POST /api/task/create (category=$CATEGORY scene=$SCENE)"
REQ=$(cat <<JSON
{"category":"$CATEGORY","scene":"$SCENE","colorTone":"$COLOR_TONE","useLobster":$USE_LOBSTER,"theme":{"title":"$TITLE","subtitle":"$SUBTITLE","tags":["smoke","test"],"gifts":[{"name":"小星星","value":"x1"}]}}
JSON
)
RESP=$(curl -fsS --max-time 10 -X POST -H 'Content-Type: application/json' \
  -d "$REQ" "${BASE}/api/task/create") || fail "create 请求失败" 2
TID=$(jq_get "$RESP" data.taskId)
[ -n "$TID" ] && ok "taskId=$TID" || fail "create 返回无 taskId" 2

say "[3/5] 轮询 /api/task/:id (max ${POLL_MAX}x${POLL_INTERVAL}s)"
START=$(date +%s)
FINAL=""
for i in $(seq 1 "$POLL_MAX"); do
  R=$(curl -fsS --max-time 5 "${BASE}/api/task/${TID}") || fail "轮询请求失败 (i=$i)" 3
  S=$(jq_get "$R" data.status)
  P=$(jq_get_def "$R" data.progress 0)
  ELAPSED=$(($(date +%s) - START))
  printf "  [%02d] t=%02ds  status=%-10s progress=%s\n" "$i" "$ELAPSED" "$S" "$P"
  case "$S" in
    completed*) FINAL="$R"; break ;;
    failed*)    fail "任务失败：$(jq_get_def "$R" data.error unknown)" 3 ;;
  esac
  sleep "$POLL_INTERVAL"
done
[ -n "$FINAL" ] || fail "超时（>${POLL_MAX}*${POLL_INTERVAL}s）未完成" 6
ELAPSED=$(($(date +%s) - START))
ok "completed in ${ELAPSED}s"

say "[4/5] 校验 outputs/*.jpeg 落盘"
IMG_URL=$(jq_get "$FINAL" data.result.imageUrl)
FILE_NAME=$(basename "$IMG_URL")
FILE_PATH="outputs/${FILE_NAME}"
[ -f "$FILE_PATH" ] || fail "outputs/${FILE_NAME} 不存在" 4
SIZE=$(stat -f "%z" "$FILE_PATH" 2>/dev/null || stat -c "%s" "$FILE_PATH")
MIME=$(file -b --mime-type "$FILE_PATH")
ok "$FILE_NAME  size=${SIZE}B  mime=${MIME}"

say "[5/5] 验证 /outputs 静态访问"
HEAD=$(curl -fsSI --max-time 5 "${BASE}${IMG_URL}") || fail "HTTP 静态文件不可达" 5
echo "$HEAD" | grep -q "200 OK" && ok "HTTP 200" || fail "HTTP 非 200" 5
echo "$HEAD" | grep -qi "image/jpeg" && ok "Content-Type: image/jpeg" || fail "Content-Type 不是 image/jpeg" 5

printf "\n\033[1;32m══════ ✅ SMOKE PASS  ══════\033[0m\n"
printf "  taskId : %s\n" "$TID"
printf "  image  : %s\n" "$IMG_URL"
printf "  elapsed: %ds\n" "$ELAPSED"
exit 0
