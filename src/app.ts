import compression from "compression";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import env from "./configs/env";
import { openApiDocument } from "./docs/openapi";
import { firefliesWebhookHandler } from "./controllers/demo.controller";
import { morganMiddleware } from "./middlewares/morgan";
import { publicRateLimit } from "./middlewares/rateLimit";
import indexRoute from "./routes/index";
import AppError from "./utils/appError";
import logger from "./utils/logger";

const app = express();

// Behind nginx / a load balancer: use the real client address (rate limits, logs).
if (env.trustProxyHops > 0) app.set("trust proxy", env.trustProxyHops);
app.disable("x-powered-by");

// Notetaker webhook: needs the exact raw body to check its signature, so it is mounted before
// the JSON parser. Server-to-server (no CORS, no team key; the signature is the check).
app.post("/api/webhooks/fireflies", publicRateLimit, express.raw({ type: "*/*", limit: "100kb" }), firefliesWebhookHandler);

// MIDDLEWARE
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morganMiddleware());
app.use(
  cors({
    // Unlike be-admin-portal ("*"), only the configured frontend origins are allowed,
    // because write requests carry the shared team key.
    origin: env.corsOrigins.length ? env.corsOrigins : false,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders: ["Content-Type", "X-Team-Key", "X-Presenter-Name"],
    exposedHeaders: ["ETag"]
  })
);
app.use(helmet());
app.use(compression());

// API docs (Swagger UI, like be-admin-portal)
if (env.apiDocs) app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

// ROUTES
app.use("/api", indexRoute);

// Simple health endpoint (same shape as be-admin-portal)
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
});

app.all("*", (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(404, `Route ${req.originalUrl} not found`));
});

// GLOBAL ERROR HANDLER — same response shape as be-admin-portal: { status, statusCode, message }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((error: AppError & { type?: string }, req: Request, res: Response, _next: NextFunction) => {
  // Malformed JSON body from express.json()
  if (error.type === "entity.parse.failed") error = new AppError(400, "Request body is not valid JSON");

  const statusCode = error.statusCode || 500;
  const isExpected = error instanceof AppError && statusCode < 500;
  if (isExpected) logger.warn(`${req.method} ${req.originalUrl} -> ${statusCode} ${error.message}`);
  else logger.error(`${req.method} ${req.originalUrl} -> ${statusCode} ${error.stack || error.message}`);

  res.status(statusCode).json({
    status: error.status || "error",
    statusCode,
    // Never leak internal error details in production.
    message: isExpected || env.nodeEnv !== "production" ? error.message || "Internal Server Error" : "Internal Server Error"
  });
});

export default app;
