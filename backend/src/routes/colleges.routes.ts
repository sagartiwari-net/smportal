import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { getTrainerGroupIds } from "../services/trainerScope";

const router = Router();

router.use(requireAuth);

router.get("/", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;

  if (role === "TRAINER") {
    const groupIds = await getTrainerGroupIds(req.user!.id);
    if (!groupIds.length) return res.json({ colleges: [] });
    const colleges = await prisma.college.findMany({
      where: {
        interns: {
          some: {
            memberships: { some: { isActive: true, groupId: { in: groupIds } } },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    return res.json({ colleges });
  }

  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId: req.user!.id } });
    const colleges = await prisma.college.findMany({
      where: { id: profile?.collegeId || "" },
      orderBy: { name: "asc" },
    });
    return res.json({ colleges });
  }

  const colleges = await prisma.college.findMany({ orderBy: { name: "asc" } });
  res.json({ colleges });
});

router.post("/", requireRole("ADMIN", "HR"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    code: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  try {
    const college = await prisma.college.create({
      data: { name: parsed.data.name.trim(), code: parsed.data.code?.trim() || null },
    });
    res.status(201).json({ college });
  } catch {
    res.status(409).json({ message: "College name/code already exists" });
  }
});

router.patch("/:id", requireRole("ADMIN", "HR"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    code: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  try {
    const college = await prisma.college.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.code !== undefined ? { code: parsed.data.code?.trim() || null } : {}),
      },
    });
    res.json({ college });
  } catch {
    res.status(404).json({ message: "College not found or name/code conflict" });
  }
});

router.delete("/:id", requireRole("ADMIN", "HR"), async (req, res) => {
  const linked = await prisma.internProfile.count({ where: { collegeId: req.params.id } });
  const linkedAccounts = await prisma.collegeProfile.count({ where: { collegeId: req.params.id } });
  if (linked > 0 || linkedAccounts > 0) {
    return res.status(400).json({
      message: "Cannot delete college with linked interns or college accounts. Reassign them first.",
    });
  }

  try {
    await prisma.college.delete({ where: { id: req.params.id } });
    res.json({ message: "College deleted" });
  } catch {
    res.status(404).json({ message: "College not found" });
  }
});

export default router;
