/*
 * ==========================================================
 * Project 05 - Step 10
 * Nginx Advanced Feature Lab Backend
 * ==========================================================
 *
 * 這個 Express Service 提供：
 *
 *   GET /
 *   GET /health
 *   GET /api/info
 *
 * 以及 Step 10 Lab：
 *
 *   GET /lab/timeout
 *   GET /lab/rate
 *   GET /lab/balance
 *
 *
 * 注意：
 *
 * gzip / cache 是 Nginx Static File 功能，
 * 不需要 Express。
 *
 * timeout / rate limit / load balancing
 * 才會使用 Express。
 *
 * ==========================================================
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";

// ==========================================================
// Express Application
// ==========================================================

const app = express();

// ==========================================================
// Server Settings
// ==========================================================

const PORT = Number(process.env.PORT ?? 3000);

const HOST = "0.0.0.0";

// ----------------------------------------------------------
// INSTANCE_NAME
// ----------------------------------------------------------
//
// Step 10 會啟動三個 Express Container：
//
//   api
//   api1
//   api2
//
// 它們跑的是完全相同的程式碼。
//
// 唯一差異是 Compose 提供不同：
//
//   INSTANCE_NAME
//
// 例如：
//
//   api-main
//   api-1
//   api-2
//
// Load Balancing Lab 就可以藉此看出
// Request 最後被分配到哪一個 Instance。
//
const INSTANCE_NAME = process.env.INSTANCE_NAME ?? "unknown";

// ==========================================================
// Express Basic Settings
// ==========================================================

app.disable("x-powered-by");

// Reverse Proxy 前面固定有一層 Nginx。
app.set("trust proxy", 1);

app.use(express.json());

// ==========================================================
// GET /
// ==========================================================

app.get("/", (_req: Request, res: Response) => {
  res.json({
    service: "express-api",
    instance: INSTANCE_NAME,
    message: "Project 05 Step 10 Express API is running",
  });
});

// ==========================================================
// GET /health
// ==========================================================

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "express-api",
    instance: INSTANCE_NAME,
  });
});

// ==========================================================
// GET /api/info
// ==========================================================

app.get("/api/info", (req: Request, res: Response) => {
  res.json({
    service: "express-api",

    instance: INSTANCE_NAME,

    runtime: {
      nodeVersion: process.version,

      environment: process.env.NODE_ENV ?? "development",
    },

    request: {
      method: req.method,

      path: req.path,

      hostname: req.hostname,

      protocol: req.protocol,

      secure: req.secure,

      ip: req.ip,

      ips: req.ips,

      socketRemoteAddress: req.socket.remoteAddress ?? null,
    },

    headers: {
      host: req.get("host") ?? null,

      xRealIp: req.get("x-real-ip") ?? null,

      xForwardedHost: req.get("x-forwarded-host") ?? null,

      xForwardedFor: req.get("x-forwarded-for") ?? null,

      xForwardedProto: req.get("x-forwarded-proto") ?? null,
    },
  });
});

// ==========================================================
// Lab：Proxy Timeout
// ==========================================================
//
// Request：
//
//   GET /lab/timeout?seconds=2
//
// Express 故意等待 2 秒再回 Response。
//
//
// 例如：
//
//   seconds=2
//
// 如果 Nginx：
//
//   proxy_read_timeout 3s;
//
// 則通常能成功。
//
//
// seconds=5
//
// Express 5 秒沒有 Response，
// Nginx read timeout 先到，
// 就可能產生：
//
//   HTTP 504 Gateway Timeout
//
// ==========================================================

app.get("/lab/timeout", async (req: Request, res: Response) => {
  /*
   * Query String：
   *
   *   ?seconds=5
   *
   * Express：
   *
   *   req.query.seconds
   */

  const requestedSeconds = Number(req.query.seconds ?? 1);

  /*
   * 防止：
   *
   *   NaN
   *   負數
   *   等待幾百秒
   *
   * 影響 Lab。
   *
   * 限定：
   *
   *   0 ~ 10 秒
   */

  const seconds = Number.isFinite(requestedSeconds)
    ? Math.min(Math.max(requestedSeconds, 0), 10)
    : 1;

  /*
   * Promise + setTimeout
   *
   * 故意模擬：
   *
   *   慢資料庫
   *   慢 API
   *   慢外部 Service
   *
   * 不是實際 CPU 忙碌。
   */

  await new Promise<void>((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });

  res.json({
    lab: "timeout",
    instance: INSTANCE_NAME,
    waitedSeconds: seconds,
  });
});

// ==========================================================
// Lab：Rate Limit
// ==========================================================
//
// Express 這裡本身完全不做 Rate Limit。
//
// Rate Limiting 是 Nginx 做的。
//
// 如果 Request 能跑到這裡，
// 代表 Nginx 允許這個 Request 通過。
//
// ==========================================================

app.get("/lab/rate", (_req: Request, res: Response) => {
  res.json({
    lab: "rate-limit",
    instance: INSTANCE_NAME,
    message: "Request passed Nginx rate limit.",
  });
});

// ==========================================================
// Lab：Load Balancing
// ==========================================================
//
// api1 / api2 都有這個 Route。
//
// Nginx：
//
//   upstream lab_backend
//
// 會決定 Request 要送：
//
//   api1
//
// 或：
//
//   api2
//
// Response 裡的 instance
// 就可以看出最後是哪個 Container 回答。
//
// ==========================================================

app.get("/lab/balance", (_req: Request, res: Response) => {
  res.json({
    lab: "load-balancing",
    instance: INSTANCE_NAME,
    message: "Response from backend instance.",
  });
});

// ==========================================================
// 404
// ==========================================================

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Not Found",
    path: req.originalUrl,
    instance: INSTANCE_NAME,
  });
});

// ==========================================================
// Global Error Handler
// ==========================================================

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", error);

  res.status(500).json({
    error: "Internal Server Error",
    instance: INSTANCE_NAME,
  });
});

// ==========================================================
// Start HTTP Server
// ==========================================================

app.listen(PORT, HOST, () => {
  console.log(
    `Express API [${INSTANCE_NAME}] listening on http://${HOST}:${PORT}`,
  );
});
