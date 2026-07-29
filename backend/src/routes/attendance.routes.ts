import { Router } from "express";
import { z } from "zod";
import { AttendanceStatus } from "../generated/prisma/client";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

function dayDate(input: string) {
  const d = new Date(input);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

router.get("/", async (req, res) => {
  const role = req.user!.role;
  const statusFilter = req.query.status as string | undefined;

  if (role === "INTERN") {
    const profile = await prisma.internProfile.findUnique({ where: { userId: req.user!.id } });
    const records = await prisma.attendance.findMany({
      where: {
        internId: profile?.id || "",
        ...(statusFilter && Object.values(AttendanceStatus).includes(statusFilter as AttendanceStatus)
          ? { status: statusFilter as AttendanceStatus }
          : {}),
      },
      orderBy: { date: "desc" },
    });
    return res.json({ records });
  }

  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId: req.user!.id } });
    const records = await prisma.attendance.findMany({
      where: { intern: { collegeId: profile?.collegeId || "" } },
      include: { intern: { include: { user: { select: { fullName: true, email: true } } } } },
      orderBy: { date: "desc" },
    });
    return res.json({ records });
  }

  // HR / TRAINER
  const groupId = req.query.groupId as string | undefined;
  const records = await prisma.attendance.findMany({
    where: groupId
      ? { intern: { memberships: { some: { groupId, isActive: true } } } }
      : role === "TRAINER"
        ? { intern: { memberships: { some: { isActive: true, group: { trainerId: req.user!.id } } } } }
        : {},
    include: { intern: { include: { user: { select: { fullName: true, email: true } }, college: true } } },
    orderBy: { date: "desc" },
    take: 500,
  });
  res.json({ records });
});

router.post("/mark", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    date: z.string(),
    entries: z.array(
      z.object({
        internId: z.string(),
        status: z.enum(["PRESENT", "ABSENT", "LEAVE", "WEEK_OFF"]),
        note: z.string().optional(),
      }),
    ).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  const date = dayDate(parsed.data.date);

  await prisma.$transaction(
    parsed.data.entries.map((e) =>
      prisma.attendance.upsert({
        where: { internId_date: { internId: e.internId, date } },
        update: {
          status: e.status as AttendanceStatus,
          note: e.note || null,
          markedById: req.user!.id,
        },
        create: {
          internId: e.internId,
          date,
          status: e.status as AttendanceStatus,
          note: e.note || null,
          markedById: req.user!.id,
        },
      }),
    ),
  );

  res.json({ message: "Attendance saved", count: parsed.data.entries.length });
});

router.get("/summary/:internId", async (req, res) => {
  const records = await prisma.attendance.findMany({ where: { internId: req.params.internId } });
  const present = records.filter((r) => r.status === "PRESENT").length;
  const absent = records.filter((r) => r.status === "ABSENT").length;
  const leave = records.filter((r) => r.status === "LEAVE").length;
  const weekOff = records.filter((r) => r.status === "WEEK_OFF").length;
  const counted = present + absent + leave;
  const attendanceRate = counted === 0 ? 0 : Math.round((present / counted) * 100);
  res.json({ present, absent, leave, weekOff, attendanceRate, total: records.length });
});

export default router;
