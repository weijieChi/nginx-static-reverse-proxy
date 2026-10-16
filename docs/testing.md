# Project 05 — Nginx 功能測試紀錄

本文件記錄 **Nginx Reverse Proxy & Docker Compose Lab** 的操作方法、預期結果與實際驗證紀錄。測試重點為 Nginx、Docker Compose 與 Express API 之間的協作，不是效能或壓力測試。

> 驗證環境：Ubuntu 24.04.5 LTS、Docker Compose、Nginx `1.30.4-alpine`、Node.js 24、Express 5。  
> 已實測的結果來自 **2026-10-16** 在 Ubuntu VM 上執行的命令；「待驗證」案例提供可執行步驟，**不代表已測試通過**。

## 1. 啟動與測試環境

專案根目錄：

```text
~/docker/nginx-static-reverse-proxy/
├── compose.yaml
├── nginx/default.conf
├── api/
├── web/
└── docs/testing.md
```

服務配置：

| Compose Service | 用途 | Port |
| --- | --- | --- |
| `nginx` | 靜態網站、反向代理及 HTTP 功能測試 | Host `8080` → Container `80` |
| `api` | 一般 API、Timeout、Rate Limit | 只在 Compose Network 使用 `3000` |
| `api1` | Load Balancing Instance 1 | 只在 Compose Network 使用 `3000` |
| `api2` | Load Balancing Instance 2 | 只在 Compose Network 使用 `3000` |

```bash
# 進入專案
cd ~/docker/nginx-static-reverse-proxy

# 確認合併後的 Compose 設定
# （此項為建議驗證，尚無本次操作紀錄）
docker compose config

# 建立 Image，並在背景啟動容器
docker compose up -d --build

# 查看四個容器及健康狀態
docker compose ps

# 驗證 Nginx 設定語法
docker compose exec nginx nginx -t
```

**已實測（2026-10-16）：** 三台 API 與 Nginx 均顯示 `healthy`；`nginx -t` 顯示 `syntax is ok`、`test is successful`。API 容器沒有發布 Host Port。

> 以下 `localhost:8080` 指的是 **Ubuntu VM 自己**。若從 Windows 瀏覽器操作，需使用 VM 可連線的 IP 與 8080 Port。`curl` 命令可直接在 Ubuntu Bash 執行。

## 2. 各功能測試總覽

| 功能 | 驗證網址／方式 | 預期結果 | 狀態 |
| --- | --- | --- | --- |
| Compose / Nginx 設定 | `docker compose ps`、`nginx -t` | Healthy、語法正確 | ✅ 已實測 |
| Nginx Liveness | `/health/live` | HTTP 200、`nginx alive` | ✅ 已實測 |
| API Readiness | `/health/ready` | HTTP 200、`api-main` | ✅ 已實測 |
| Reverse Proxy | `/api/info` | HTTP 200、轉發 Header 正確 | ✅ 已實測 |
| Static Site | `/`、`/assets/style.css` | HTTP 200 | ⏳ 待單獨驗證 |
| Browser Cache | `/lab/cache/cache.css` | HTTP 200、`max-age=3600` | ✅ 已實測 |
| Gzip | `/lab/gzip/large.txt` | HTTP 200、`Content-Encoding: gzip` | ✅ 已實測 |
| Proxy Timeout | `/lab/timeout?seconds=5` | HTTP 504、自訂 50x 頁面 | ✅ 已實測 |
| Timeout 正常情境 | `/lab/timeout?seconds=2` | HTTP 200 | ✅ 已實測 |
| Rate Limiting | `/lab/rate` | 密集請求出現 HTTP 429 | ✅ 已實測 |
| Round Robin | `/lab/balance` | `api-1`、`api-2` 輪流回應 | ✅ 已實測 |
| 自訂 404 | 不存在的靜態路徑 | HTTP 404、自訂錯誤頁 | ✅ 已實測 |
| JSON Access Log | Nginx 容器日誌 | 一行一筆 JSON，含狀態與上游資訊 | ✅ 已實測 |

## 3. Liveness / Readiness

```bash
# Nginx 自身是否存活
curl -i http://localhost:8080/health/live

# Nginx 是否能取得主 API 的健康回應
curl -i http://localhost:8080/health/ready
```

**預期及已實測結果：**

```text
GET /health/live   → HTTP/1.1 200 OK
nginx alive

GET /health/ready  → HTTP/1.1 200 OK
{"status":"ok","service":"express-api","instance":"api-main"}
```

`/health/live` 只檢查 Nginx 自身；`/health/ready` 只轉發至主 API `api` 的 `/health`，**並未檢查 `api1`、`api2`**。不要將它描述成整個系統的完整就緒檢查。

## 4. Reverse Proxy 與 Forwarded Headers

```bash
# 顯示完整 HTTP Response（Headers + JSON）
curl -i http://localhost:8080/api/info

# 僅取 JSON Body，再交給 jq 格式化
curl -sS http://localhost:8080/api/info | jq .
```

**已實測結果：** HTTP 200，回應顯示 `instance: api-main`、`request.path: /api/info`、Node.js `v24.22.0`，並帶有 `xRealIp`、`xForwardedFor`、`xForwardedProto` 等欄位。

**檢查重點：**

- Nginx 對外提供 `:8080`，Express `:3000` 不直接發布到 Host。
- `proxy_pass http://api:3000` 保留 `/api/info` 路徑。
- `Host` 與 `X-Forwarded-*` 由 Nginx 傳遞給 Express。

> `curl -i ... | jq` **不能直接使用**，因為 `-i` 會把 HTTP Status Line 與 Headers 一起送進 `jq`，造成 JSON 解析失敗。此診斷端點會顯示連線與執行環境資訊，僅適合受控的作品展示環境。

## 5. 靜態檔案與自訂 404

```bash
# 靜態首頁
curl -sS -o /dev/null -w 'Homepage: HTTP %{http_code}\n' \
  http://localhost:8080/

# CSS 資源
curl -sS -o /dev/null -w 'Stylesheet: HTTP %{http_code}\n' \
  http://localhost:8080/assets/style.css

# 故意要求不存在的靜態路徑
curl -i http://localhost:8080/__nginx_lab_missing_resource
```

**首頁與 CSS：** 預期 HTTP 200；目前仍未取得獨立的 curl 驗證紀錄。

**自訂 404 已實測（2026-10-16）：** `curl -i http://localhost:8080/abc123` 回傳 `HTTP/1.1 404 Not Found`、`Content-Type: text/html`，Body 包含 `Resource Not Found`，內容由 `web/404.html` 提供。

**注意：** `/api/不存在的路由` 是 Express 自己回應 JSON 404，因目前沒有啟用 `proxy_intercept_errors`，不應預期它也會顯示 Nginx 的 HTML 404 頁面。

## 6. Browser Cache

```bash
curl -i http://localhost:8080/lab/cache/cache.css
```

**已實測結果：** HTTP 200，且包含：

```http
Content-Type: text/css
Cache-Control: max-age=3600
X-Lab-Cache: enabled
Expires: Fri, 16 Oct 2026 13:17:31 GMT
```

表示 Nginx 設定的 **1 小時瀏覽器快取標頭**正常輸出。`Expires` 是此次測試紀錄中的實際時間，後續執行會改變。

必須存在對應檔案：`web/lab/cache/cache.css`（已在使用者 VM 上驗證可讀取）。

**驗證範圍：** `curl` 可確認 **快取政策的 Response Headers**，但 `curl` 預設不會像瀏覽器一樣保存並重用 HTTP 快取，因此不代表已證明瀏覽器命中快取。若要驗證命中，請在 Chrome DevTools → Network 觀察連續載入同一網址的請求狀態。

## 7. Gzip Compression

```bash
# 主動宣告支援 gzip；只印 Headers，避免輸出壓縮後的二進位內容
curl -sS -D - -o /dev/null \
  -H 'Accept-Encoding: gzip' \
  http://localhost:8080/lab/gzip/large.txt
```

**已實測結果：** HTTP 200，且包含：

```http
Content-Type: text/plain
Vary: Accept-Encoding
Content-Encoding: gzip
```

`Content-Encoding: gzip` 確認 Nginx 對此回應進行 Gzip 壓縮。`Vary` 表示快取應區分不同 `Accept-Encoding` 的回應。

可選擇比較下載大小（**待驗證**）：

```bash
# 不要求 gzip
curl -sS -o /dev/null -w 'Without gzip: %{size_download} bytes\n' \
  -H 'Accept-Encoding: identity' \
  http://localhost:8080/lab/gzip/large.txt

# 要求 gzip；不使用 --compressed，以便觀察傳輸位元組數
curl -sS -o /dev/null -w 'With gzip: %{size_download} bytes\n' \
  -H 'Accept-Encoding: gzip' \
  http://localhost:8080/lab/gzip/large.txt
```

這是單一測試檔案的傳輸量比較，不應視為網站整體效能基準。

## 8. Proxy Timeout 與自訂 50x 錯誤頁

Nginx 此路由設定 `proxy_read_timeout 3s`，Express 會依 `seconds` 參數模擬回應延遲。

```bash
# 正常情境：後端等待 2 秒（已實測）
curl -sS -o /dev/null \
  -w '2s: HTTP %{http_code}, total=%{time_total}s\n' \
  'http://localhost:8080/lab/timeout?seconds=2'

# 逾時情境：後端等待 5 秒（已實測）
curl -i 'http://localhost:8080/lab/timeout?seconds=5'
```

| 測試 | 預期結果 | 狀態 |
| --- | --- | --- |
| `seconds=2` | HTTP 200，回應時間約 2 秒 | 已實測，總時間 `2.002598s` |
| `seconds=5` | HTTP 504 Gateway Time-out，約 3 秒觸發讀取逾時 | 已實測 HTTP 504 |

**已實測結果：** 2 秒案例回傳 `HTTP/1.1 200 OK`，JSON 包含 `"lab":"timeout"`、`"instance":"api-main"`、`"waitedSeconds":2`，curl 總時間為 `2.002598s`。5 秒案例回傳 `HTTP/1.1 504 Gateway Time-out`，Body 內容來自 `web/50x.html`，包含 `Service Error` 與 `Backend service is temporarily unavailable.`。自訂錯誤頁**沒有**將原本的 504 狀態改成 200。

> `proxy_read_timeout` 是兩次上游讀取動作之間的逾時限制，不是所有 HTTP 請求都一定在精確 3 秒時結束。這個 Lab 因後端刻意等待後才一次回應，因此能直觀呈現 504。

## 9. Rate Limiting

Nginx 設定：

```nginx
limit_req_zone $binary_remote_addr zone=lab_rate:10m rate=2r/s;

location = /lab/rate {
    limit_req zone=lab_rate burst=3 nodelay;
    limit_req_status 429;
    proxy_pass http://api:3000;
}
```

在 Ubuntu Bash 連續發送 12 次請求：

```bash
for i in {1..12}; do
    curl -sS -o /dev/null -w '%{http_code}\n' \
      http://localhost:8080/lab/rate
done
```

**已實測結果（2026-10-16）：**

```text
200
200
200
200
429
429
429
429
429
429
429
429
```

總計 HTTP 200 × **4**、HTTP 429 × **8**。前幾次請求被允許，之後超過限流額度被 Nginx 拒絕，符合 `rate=2r/s`、`burst=3`、`nodelay` 的設定行為。

**注意：** 次數並非固定保證；來源 IP 的既有請求、迴圈速度及其他流量都可能影響 200/429 比例。429 在這個實驗中是**預期結果**，不是 API 故障。

## 10. Load Balancing（Round Robin）

Nginx 的 `lab_backend` 包含兩個後端：`api1:3000`、`api2:3000`。API 回應中的 `instance` 可以辨識實際處理請求的容器。

```bash
# 連續 6 次
for i in {1..6}; do
    curl -sS http://localhost:8080/lab/balance | jq -r '.instance'
done

# 連續 12 次
for i in {1..12}; do
    curl -sS http://localhost:8080/lab/balance | jq -r '.instance'
done
```

**已實測結果：**

```text
6 次： api-1 → api-2 → api-1 → api-2 → api-1 → api-2
12 次：api-1 → api-2 → api-1 → api-2 → api-1 → api-2
      → api-1 → api-2 → api-1 → api-2 → api-1 → api-2
```

合計 18 次請求，`api-1` **9 次**、`api-2` **9 次**，符合預設 Round Robin 的分配方式。若同時有其他請求或上游節點異常，單一終端機不一定會觀察到嚴格交替。

## 11. JSON Access Log

此專案將 Nginx Access Log 以 JSON 輸出至標準輸出，方便使用 Docker Compose 觀察。

```bash
# 先製造一筆 API 請求
curl -sS http://localhost:8080/api/info > /dev/null

# 觀察 Nginx 日誌（可能包含非 JSON 的啟動訊息）
docker compose logs --no-log-prefix nginx

# 只篩選以「{」開頭的 JSON 行，再選擇重要欄位
docker compose logs --no-log-prefix nginx \
  | grep '^{' \
  | jq -c '{time, method, uri, status, upstream_addr, request_time, gzip_ratio}'
```

**已實測（2026-10-16）：** `docker compose logs --tail=5 --no-log-prefix nginx | jq` 成功解析 5 筆 JSON 紀錄，包含 `/api/info` HTTP 200、`/abc123` HTTP 404 與 `/lab/timeout?seconds=2` HTTP 200。

其中 2 秒延遲案例的日誌包含：

```json
{
  "uri": "/lab/timeout?seconds=2",
  "status": 200,
  "request_time": "2.002",
  "upstream_addr": "172.24.0.2:3000",
  "upstream_response_time": "2.001"
}
```

日誌中的時間為 UTC（`+00:00`）；Nginx 自行處理的 404 沒有上游服務，因此 `upstream_addr` 為空。示例 IP 是當次 VM 測試紀錄，不代表固定 IP。

`/health/live` 設為 `access_log off`，因此不應期待它出現在 Access Log。`/lab/gzip/large.txt` 的請求可用來觀察 `gzip_ratio`，未壓縮請求可能顯示 `-`。

## 12. 測試結束與環境清理

```bash
# 查看容器與服務日誌
docker compose ps
docker compose logs --tail=50 nginx

# 停止並移除本專案容器與預設網路
docker compose down
```

此專案沒有資料庫與持久化資料需求，通常不需要使用 `docker compose down -v`。再次啟動可執行 `docker compose up -d`；若有修改 API 或 Dockerfile，再使用 `--build`。

## 13. 測試結論

截至 **2026-10-16**，已從使用者的實際終端機紀錄確認：

- 四個容器啟動且 Healthy，Nginx 設定通過語法檢查。
- Liveness、Readiness、Reverse Proxy、Browser Cache、Gzip 均回傳預期結果。
- Timeout 5 秒情境回傳 504，並正確使用自訂 50x 頁面。
- Rate Limiting 成功產生 200／429；Round Robin 兩台後端各處理 9 次請求。
- Timeout 2 秒正常回應 HTTP 200（`2.002598s`）；自訂 404 保留 HTTP 404 狀態。
- JSON Access Log 可由 Docker stdout 擷取，並已使用 `jq` 解析。

**後續可補充驗證：** 靜態首頁與 CSS 的獨立 HTTP 200 紀錄，以及 Gzip 壓縮前後傳輸量比較；這些項目不影響已實測的 Nginx 代理與 HTTP 功能。
