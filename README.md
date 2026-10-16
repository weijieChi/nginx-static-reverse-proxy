# Nginx Reverse Proxy & Docker Compose

使用 **Nginx 作為單一 HTTP 入口**，整合靜態網站與三個 Node.js／Express API 容器，展示反向代理、流量控制、負載平衡及容器化部署的實作。

這是以 **後端服務整合與 HTTP 基礎設施**為主題的作品。重點不在複雜的商業功能，而是展示 HTTP Request 如何經過 Nginx、路由到不同服務，以及如何透過 Docker Compose 建立可重現的執行環境。

## 核心實作

- **單一服務入口：** 對外只發布 Nginx 的 `8080` Port；三個 Express API 僅透過 Docker Compose 內部網路存取。
- **反向代理與負載平衡：** 依 URL 分流靜態資源與 API，並以 Nginx `upstream` 對兩個 API Instance 進行 Round Robin。
- **HTTP 行為控制：** 實作 Rate Limiting（`2r/s`、`burst=3`）、Proxy Timeout（`3s`）、Gzip、1 小時 Browser Cache，以及自訂 404／50x 錯誤頁。
- **容器建置與啟動：** 使用 TypeScript Multi-stage Dockerfile、Production Dependencies、非 root 執行，以及 Compose Healthcheck／`depends_on`。
- **請求診斷：** 透過 Forwarded Headers 與 JSON Access Log，觀察 Client、HTTP Status、Request Time 和 Upstream Response Time。

## 系統架構

```text
Browser / HTTP Client
         |
         | :8080
         v
   +------------------------+
   | Nginx (:80)            |
   | Static / Reverse Proxy |
   +-----+-------------+----+
         |             |
         |             +-- /api/*, /health/ready,
         |             |   /lab/rate, /lab/timeout
         |             |       -> api:3000 (api-main)
         |             |
         |             +-- /lab/balance
         |                     -> upstream lab_backend
         |                        +-- api1:3000
         |                        +-- api2:3000
         |
         +-- /, /assets/*, /docs/*,
             /lab/gzip/*, /lab/cache/*
                  -> Static Files (web/)
```

`api`、`api1`、`api2` 使用相同的 Express 程式碼，透過環境變數 `INSTANCE_NAME` 區分。只有 Nginx 設定 `ports`；API 不直接暴露 Host Port。

## 技術組合

| 項目 | 使用技術 |
| --- | --- |
| Reverse Proxy | Nginx `1.30.4-alpine` |
| Backend API | Node.js 24、TypeScript、Express 5、ESM |
| Container | Docker、Docker Compose、Multi-stage Dockerfile |
| Frontend | HTML、CSS、Vanilla JavaScript |
| Logging | Nginx JSON Access Log、Docker stdout |

## 功能與驗證方式

| 功能 | 展示端點 | 可觀察的結果 |
| --- | --- | --- |
| Reverse Proxy | `/api/info` | API Instance、Forwarded Headers |
| Liveness / Readiness | `/health/live`、`/health/ready` | Nginx 與主 API 各自回傳 HTTP 200 |
| Round Robin | `/lab/balance` | `api-1` 與 `api-2` 輪流回應 |
| Rate Limiting | `/lab/rate` | 超過限制時回傳 HTTP 429 |
| Proxy Timeout | `/lab/timeout?seconds=2`、`?seconds=5` | 分別觀察 HTTP 200 與 504 |
| Gzip | `/lab/gzip/large.txt` | `Content-Encoding: gzip` |
| Browser Cache | `/lab/cache/cache.css` | `Cache-Control: max-age=3600` |
| Custom Error Page | `/abc123`、Timeout 測試 | 保留 HTTP 404／504 並顯示自訂頁面 |
| JSON Access Log | `docker compose logs nginx` | JSON 格式的狀態碼、耗時與 Upstream 資訊 |

首頁提供操作介面，也可以直接使用 `curl` 驗證。完整指令、預期結果及測試紀錄請參考 **[docs/testing.md](docs/testing.md)**。

## 實際測試結果

2026-10-16 在 Ubuntu 24.04.5 LTS VM／Docker 環境測得：

| 測試項目 | 結果 |
| --- | --- |
| 容器啟動 | Nginx + 3 個 API 容器均為 `healthy`；`nginx -t` 通過 |
| Reverse Proxy | `/api/info` 回傳 HTTP 200，包含 Forwarded Headers |
| Load Balancing | 18 次請求中 `api-1` 與 `api-2` 各處理 9 次 |
| Rate Limiting | 連續 12 次請求：4 次 HTTP 200、8 次 HTTP 429 |
| Proxy Timeout | 延遲 2 秒為 HTTP 200（總耗時 `2.002598s`）；延遲 5 秒為 HTTP 504 |
| Gzip / Cache | 確認 `Content-Encoding: gzip` 與 `Cache-Control: max-age=3600` |
| 錯誤頁與日誌 | 自訂 404、504 頁面正常；JSON Access Log 可由 `jq` 解析 |

以上屬於**功能驗證**，不是負載測試、吞吐量測試或高可用性驗證。

## 本機啟動

需求：Docker Engine 與 Docker Compose Plugin。

取得專案後，在專案根目錄執行：

```bash
# 驗證 Compose 設定
docker compose config

# 建置 API Image 並於背景啟動四個服務
docker compose up -d --build

# 確認容器健康狀態
docker compose ps

# 檢查 Nginx 設定語法
docker compose exec nginx nginx -t
```

開啟 **http://localhost:8080/**；若使用遠端 VM，則改用可連線的 VM IP 與 Port `8080`。

簡單驗證：

```bash
# Reverse Proxy
curl -sS http://localhost:8080/api/info

# 負載平衡（jq 僅用於取出 JSON 欄位）
for i in {1..6}; do
  curl -sS http://localhost:8080/lab/balance | jq -r '.instance'
done

# JSON Access Log
docker compose logs --tail=5 --no-log-prefix nginx

# 停止並清除本專案容器與網路
docker compose down
```

## 專案結構

```text
nginx-static-reverse-proxy/
├── compose.yaml              # 四個服務、啟動相依與 Healthcheck
├── nginx/
│   └── default.conf          # Nginx 路由及 HTTP 行為設定
├── api/
│   ├── Dockerfile            # TypeScript Build / Runtime 階段
│   ├── package.json
│   ├── tsconfig.json
│   └── src/app.ts             # Express 健康檢查與展示端點
├── web/
│   ├── index.html            # 功能展示首頁
│   ├── 404.html
│   ├── 50x.html
│   ├── assets/
│   ├── docs/
│   └── lab/                   # Gzip / Cache 測試資源
└── docs/
    └── testing.md            # 測試指令與實測紀錄
```

## 設計範圍

本專案是**本機／內網使用的 HTTP 基礎設施展示**，未包含 TLS、使用者認證、CI/CD、集中式監控或正式環境的高可用架構。`/api/info` 會回傳環境與請求資訊，因此不建議在未加存取限制的情況下直接對 Internet 公開。
