import "dotenv/config";
import path from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp } from "./server/app.js";
import type { AppDatabase } from "./server/database.js";

async function startServer(): Promise<void> {
  const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
  const port = Number(process.env.PORT) || 4000;
  const host = process.env.HOST?.trim() || "127.0.0.1";
  const app = createApp({ production });

  if (!production) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_request, response) => {
      response.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}`);
  });

  const shutdown = () => {
    const backgroundTimers = (app.locals.backgroundTimers ?? []) as Array<ReturnType<typeof setInterval>>;
    backgroundTimers.forEach(clearInterval);
    server.close(() => {
      (app.locals.database as AppDatabase).close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void startServer().catch((error) => {
  console.error("Failed to start server", error);
  process.exitCode = 1;
});
