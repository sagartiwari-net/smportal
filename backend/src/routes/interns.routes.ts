import { Router } from "express";
import { z } from "zod";
import { InternshipStatus } from "../generated/prisma/client";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { trainerCanAccessIntern } from "../services/trainerScope";
import { checkInternPlagiarism } from "../services/plagiarism";

const router = Router();
router.use(requireAuth);

async function assertInternAccess(role: string, userId: string, internId: string) {
  if (role === "TRAINER") {
    const ok = await trainerCanAccessIntern(userId, internId);
    if (!ok) return "Not your intern";
  }
  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId } });
    const intern = await prisma.internProfile.findUnique({ where: { id: internId }, select: { collegeId: true } });
    if (!intern || intern.collegeId !== profile?.collegeId) return "Not your college intern";
  }
  return null;
}

/** Plagiarism check — same GitHub repo or similar project text vs other interns on same task */
router.get("/:id/plagiarism", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const internId = req.params.id;
  const deny = await assertInternAccess(req.user!.role, req.user!.id, internId);
  if (deny) return res.status(403).json({ message: deny });

  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  let limit = Number.parseInt(String(req.query.limit ?? "20"), 10) || 20;
  if (![10, 20, 30].includes(limit)) limit = 20;

  const result = await checkInternPlagiarism(internId, page, limit);
  res.json(result);
});

/** Complete / reopen intern internship, or mark hired */
router.patch("/:id/status", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    internshipStatus: z.enum(["ACTIVE", "COMPLETED"]).optional(),
    isHired: z.boolean().optional(),
    hireNote: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  const intern = await prisma.internProfile.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { fullName: true } } },
  });
  if (!intern) return res.status(404).json({ message: "Intern not found" });

  if (req.user!.role === "TRAINER") {
    const ok = await trainerCanAccessIntern(req.user!.id, intern.id);
    if (!ok) return res.status(403).json({ message: "Not your intern" });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.internshipStatus === "COMPLETED") {
    data.internshipStatus = InternshipStatus.COMPLETED;
    data.completedAt = new Date();
    data.completedById = req.user!.id;
  }
  if (parsed.data.internshipStatus === "ACTIVE") {
    data.internshipStatus = InternshipStatus.ACTIVE;
    data.completedAt = null;
    data.completedById = null;
  }
  if (parsed.data.isHired === true) {
    data.isHired = true;
    data.hiredAt = new Date();
    data.hiredById = req.user!.id;
    if (parsed.data.hireNote !== undefined) data.hireNote = parsed.data.hireNote;
  }
  if (parsed.data.isHired === false) {
    data.isHired = false;
    data.hiredAt = null;
    data.hiredById = null;
    data.hireNote = null;
  }
  if (parsed.data.hireNote !== undefined && parsed.data.isHired !== false) {
    data.hireNote = parsed.data.hireNote;
  }

  const updated = await prisma.internProfile.update({
    where: { id: intern.id },
    data,
    include: {
      user: { select: { fullName: true, email: true } },
      college: { select: { name: true } },
      completedBy: { select: { fullName: true, role: true } },
      hiredBy: { select: { fullName: true, role: true } },
    },
  });

  res.json({ intern: updated });
});

export default router;
