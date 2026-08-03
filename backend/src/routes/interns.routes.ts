import { Router } from "express";
import { z } from "zod";
import { InternshipStatus } from "../generated/prisma/client";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { trainerCanAccessIntern, trainerOwnsGroup } from "../services/trainerScope";

const router = Router();
router.use(requireAuth);

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
