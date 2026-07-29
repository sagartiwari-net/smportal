import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, service: "smm-portal-api" });
});

export default router;
