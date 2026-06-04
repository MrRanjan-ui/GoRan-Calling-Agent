import express from "express";
import path from "path";
import { createServer as createHttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";

import { PORT, connectDb } from "./config.js";
import { seedDefaultPersonas } from "./defaults/personas.js";
import { logger } from "./utils.js";

// Route modules
import personaRoutes from "./routes/personas.js";
import knowledgeBaseRoutes from "./routes/knowledgeBases.js";
import authRoutes from "./routes/auth.js";
import telephonyRoutes from "./routes/telephony.js";
import analyticsRoutes from "./routes/analytics.js";
import healthRoutes from "./routes/health.js";

// WebSocket handlers
import { handleBrowserWebSocket } from "./handlers/browserWs.js";
import { handleTelephonyWebSocket } from "./handlers/telephonyWs.js";

// ─── Express Setup ──────────────────────────────────────────────
const app = express();
const httpServer = createHttpServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve call recordings folder statically
app.use("/recordings", express.static(path.join(process.cwd(), "recordings")));

// ─── Mount Route Modules ────────────────────────────────────────
app.use("/api/personas", personaRoutes);
app.use("/api/knowledge-bases", knowledgeBaseRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", telephonyRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/health", healthRoutes);

// ─── WebSocket Servers ──────────────────────────────────────────
const wssBrowser = new WebSocketServer({ noServer: true });
const wssTelephony = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/api/live") {
    wssBrowser.handleUpgrade(request, socket, head, (ws) => {
      wssBrowser.emit("connection", ws, request);
    });
  } else if (url.pathname === "/api/twilio/live" || url.pathname === "/api/sip/live") {
    wssTelephony.handleUpgrade(request, socket, head, (ws) => {
      wssTelephony.emit("connection", ws, request);
    });
  } else if (process.env.NODE_ENV !== "production") {
    // Let Vite HMR pass through in dev mode
  } else {
    socket.destroy();
  }
});

wssBrowser.on("connection", (ws: WebSocket) => {
  handleBrowserWebSocket(ws);
});

wssTelephony.on("connection", (ws: WebSocket, request) => {
  handleTelephonyWebSocket(ws, request);
});

// ─── Bootstrap ──────────────────────────────────────────────────
async function initializeServer() {
  try {
    logger.info("Initializing database connection...");
    await connectDb();
    logger.info("Seeding default personas...");
    await seedDefaultPersonas();
  } catch (err) {
    logger.error("Failed to connect or seed database during bootstrap:", err);
  }

  if (process.env.NODE_ENV !== "production") {
    logger.info("Mounting Vite middleware in development mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    logger.info("Serving compiled production assets...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*splat", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const portNum = Number(PORT);
  httpServer.listen(portNum, "0.0.0.0", () => {
    logger.info(`Server successfully running on http://localhost:${portNum}`);
  });
}

initializeServer().catch((error) => {
  console.error("Fatal server bootstrap error:", error);
});
