import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import healthRoutes from "./routes/health.routes";
import collegesRoutes from "./routes/colleges.routes";
import usersRoutes from "./routes/users.routes";
import groupsRoutes from "./routes/groups.routes";
import tasksRoutes from "./routes/tasks.routes";
import attendanceRoutes from "./routes/attendance.routes";
import analyticsRoutes from "./routes/analytics.routes";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.use("/api/health", healthRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/colleges", collegesRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/groups", groupsRoutes);
  app.use("/api/tasks", tasksRoutes);
  app.use("/api/attendance", attendanceRoutes);
  app.use("/api/analytics", analyticsRoutes);

  app.use((_req, res) => {
    res.status(404).json({ message: "Not found" });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  });

  return app;
}
