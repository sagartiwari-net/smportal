import { Router } from "express";
import { z } from "zod";
import { TaskStatus } from "../generated/prisma/client";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { computeDayAndTask, displayLabel, toDayDate } from "../services/dayTask";

const router = Router();
router.use(requireAuth);

async function internProfileId(userId: string) {
  const p = await prisma.internProfile.findUnique({ where: { userId } });
  return p?.id;
}

function withLabels<T extends { dayNumber: number; taskNumber: number; task: { title: string } }>(
  assignments: T[],
) {
  return assignments.map((a) => ({
    ...a,
    displayLabel: displayLabel(a.dayNumber, a.taskNumber, a.task.title),
  }));
}

async function resolveInternIds(groupId?: string, internIds?: string[]) {
  let target: string[] = internIds || [];
  if (groupId) {
    const members = await prisma.groupMember.findMany({
      where: { groupId, isActive: true },
      select: { internId: true },
    });
    target = [...new Set([...target, ...members.map((m) => m.internId)])];
  }
  return target;
}

async function assignTaskToInterns(taskId: string, title: string, forDate: Date, internIds: string[]) {
  const created = [];
  const skipped: string[] = [];
  for (const internId of internIds) {
    const exists = await prisma.taskAssignment.findUnique({
      where: { taskId_internId: { taskId, internId } },
    });
    if (exists) {
      skipped.push(internId);
      continue;
    }
    const { dayNumber, taskNumber } = await computeDayAndTask(internId, forDate);
    const row = await prisma.taskAssignment.create({
      data: {
        taskId,
        internId,
        status: TaskStatus.ASSIGNED,
        forDate,
        dayNumber,
        taskNumber,
      },
    });
    created.push({
      ...row,
      displayLabel: displayLabel(dayNumber, taskNumber, title),
    });
  }
  return { created, skipped };
}

router.get("/", async (req, res) => {
  const role = req.user!.role;
  const includeBase = {
    task: { include: { createdBy: { select: { fullName: true } }, group: true } },
    submission: {
      include: {
        feedbacks: {
          orderBy: { createdAt: "desc" as const },
          include: { reviewer: { select: { fullName: true } } },
        },
      },
    },
  };

  if (role === "INTERN") {
    const iid = await internProfileId(req.user!.id);
    const assignments = await prisma.taskAssignment.findMany({
      where: { internId: iid || "" },
      include: includeBase,
      orderBy: [{ forDate: "desc" }, { taskNumber: "asc" }],
    });
    return res.json({ assignments: withLabels(assignments) });
  }

  const staffInclude = {
    task: true,
    intern: { include: { user: { select: { fullName: true, email: true } }, college: true } },
    submission: { include: { feedbacks: { orderBy: { createdAt: "desc" as const } } } },
  };

  if (role === "TRAINER") {
    const assignments = await prisma.taskAssignment.findMany({
      where: {
        OR: [
          { task: { createdById: req.user!.id } },
          { task: { group: { trainerId: req.user!.id } } },
        ],
      },
      include: staffInclude,
      orderBy: [{ forDate: "desc" }, { updatedAt: "desc" }],
    });
    return res.json({ assignments: withLabels(assignments) });
  }

  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId: req.user!.id } });
    const assignments = await prisma.taskAssignment.findMany({
      where: { intern: { collegeId: profile?.collegeId || "" } },
      include: {
        task: true,
        intern: { include: { user: { select: { fullName: true, email: true } } } },
        submission: true,
      },
      orderBy: [{ forDate: "desc" }, { updatedAt: "desc" }],
    });
    return res.json({ assignments: withLabels(assignments) });
  }

  const assignments = await prisma.taskAssignment.findMany({
    include: staffInclude,
    orderBy: [{ forDate: "desc" }, { updatedAt: "desc" }],
  });
  res.json({ assignments: withLabels(assignments) });
});

/** Saved task templates (reuse across batches / start dates) */
router.get("/library", requireRole("ADMIN", "HR", "TRAINER"), async (_req, res) => {
  const tasks = await prisma.task.findMany({
    where: { isLibrary: true },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { assignments: true } },
      createdBy: { select: { fullName: true } },
    },
  });
  res.json({ tasks });
});

router.post("/library", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    title: z.string().min(2),
    description: z.string().min(5),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Title and description required" });

  const task = await prisma.task.create({
    data: {
      title: parsed.data.title.trim(),
      description: parsed.data.description,
      isLibrary: true,
      createdById: req.user!.id,
    },
  });
  res.status(201).json({ task });
});

/** Assign a library (or any) task to group/interns for a date */
router.post("/:taskId/assign", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    forDate: z.string().min(8),
    groupId: z.string().optional(),
    internIds: z.array(z.string()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "forDate required" });

  const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (!task) return res.status(404).json({ message: "Task not found" });

  const targetInternIds = await resolveInternIds(parsed.data.groupId, parsed.data.internIds);
  if (targetInternIds.length === 0) {
    return res.status(400).json({ message: "Select a group and/or interns" });
  }

  const forDate = toDayDate(parsed.data.forDate);
  const { created, skipped } = await assignTaskToInterns(task.id, task.title, forDate, targetInternIds);

  res.status(201).json({
    task,
    assignments: created,
    assignedCount: created.length,
    skippedCount: skipped.length,
  });
});

/**
 * Create + assign in one step, OR pass libraryTaskId to assign existing saved task.
 * Body: { title?, description?, libraryTaskId?, forDate, groupId?, internIds? }
 */
router.post("/", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    title: z.string().min(2).optional(),
    description: z.string().min(5).optional(),
    libraryTaskId: z.string().optional(),
    forDate: z.string().min(8),
    dueDate: z.string().optional(),
    groupId: z.string().optional(),
    internIds: z.array(z.string()).optional(),
    alsoSaveToLibrary: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload — forDate required" });

  const targetInternIds = await resolveInternIds(parsed.data.groupId, parsed.data.internIds);
  if (targetInternIds.length === 0) {
    return res.status(400).json({ message: "Select a group and/or interns" });
  }

  const forDate = toDayDate(parsed.data.forDate);

  let task;
  if (parsed.data.libraryTaskId) {
    task = await prisma.task.findUnique({ where: { id: parsed.data.libraryTaskId } });
    if (!task) return res.status(404).json({ message: "Library task not found" });
  } else {
    if (!parsed.data.title || !parsed.data.description) {
      return res.status(400).json({ message: "title and description required (or pick libraryTaskId)" });
    }
    task = await prisma.task.create({
      data: {
        title: parsed.data.title.trim(),
        description: parsed.data.description,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : forDate,
        groupId: parsed.data.groupId || null,
        isLibrary: !!parsed.data.alsoSaveToLibrary,
        createdById: req.user!.id,
      },
    });
  }

  const { created, skipped } = await assignTaskToInterns(task.id, task.title, forDate, targetInternIds);

  res.status(201).json({
    task,
    assignments: created,
    assignedCount: created.length,
    skippedCount: skipped.length,
  });
});

router.patch("/:taskId", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    title: z.string().min(2).optional(),
    description: z.string().min(5).optional(),
    dueDate: z.string().nullable().optional(),
    isLibrary: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  try {
    const task = await prisma.task.update({
      where: { id: req.params.taskId },
      data: {
        ...(parsed.data.title ? { title: parsed.data.title.trim() } : {}),
        ...(parsed.data.description ? { description: parsed.data.description } : {}),
        ...(parsed.data.dueDate !== undefined
          ? { dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null }
          : {}),
        ...(parsed.data.isLibrary !== undefined ? { isLibrary: parsed.data.isLibrary } : {}),
      },
    });
    res.json({ task });
  } catch {
    res.status(404).json({ message: "Task not found" });
  }
});

router.delete("/:taskId", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  try {
    await prisma.task.delete({ where: { id: req.params.taskId } });
    res.json({ message: "Task deleted" });
  } catch {
    res.status(404).json({ message: "Task not found" });
  }
});

router.delete("/assignments/:id", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  try {
    await prisma.taskAssignment.delete({ where: { id: req.params.id } });
    res.json({ message: "Assignment removed" });
  } catch {
    res.status(404).json({ message: "Assignment not found" });
  }
});

router.post("/assignments/:id/submit", requireRole("INTERN"), async (req, res) => {
  const schema = z.object({
    projectDetails: z.string().trim().min(5, "Write at least a short project summary (5+ characters)"),
    githubUrl: z.string().url("Enter a valid GitHub URL (https://...)"),
    liveUrl: z.union([z.string().url(), z.literal("")]).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    const first =
      parsed.error.flatten().fieldErrors.projectDetails?.[0] ||
      parsed.error.flatten().fieldErrors.githubUrl?.[0] ||
      parsed.error.flatten().fieldErrors.liveUrl?.[0] ||
      "Invalid submission";
    return res.status(400).json({ message: first, errors: parsed.error.flatten() });
  }

  const iid = await internProfileId(req.user!.id);
  const assignment = await prisma.taskAssignment.findUnique({ where: { id: req.params.id } });
  if (!assignment || assignment.internId !== iid) {
    return res.status(404).json({ message: "Assignment not found" });
  }
  if (assignment.status === TaskStatus.DONE) {
    return res.status(400).json({ message: "Already marked done" });
  }

  const submission = await prisma.$transaction(async (tx) => {
    const sub = await tx.submission.upsert({
      where: { assignmentId: assignment.id },
      update: {
        projectDetails: parsed.data.projectDetails,
        githubUrl: parsed.data.githubUrl,
        liveUrl: parsed.data.liveUrl || null,
        submittedAt: new Date(),
      },
      create: {
        assignmentId: assignment.id,
        projectDetails: parsed.data.projectDetails,
        githubUrl: parsed.data.githubUrl,
        liveUrl: parsed.data.liveUrl || null,
      },
    });
    await tx.taskAssignment.update({
      where: { id: assignment.id },
      data: { status: TaskStatus.SUBMITTED },
    });
    return sub;
  });

  res.json({ submission, status: TaskStatus.SUBMITTED });
});

router.post("/assignments/:id/review", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    comment: z.string().min(2),
    status: z.enum(["DONE", "NEEDS_IMPROVEMENT"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid review" });

  const assignment = await prisma.taskAssignment.findUnique({
    where: { id: req.params.id },
    include: { submission: true },
  });
  if (!assignment?.submission) {
    return res.status(400).json({ message: "No submission to review" });
  }

  const newStatus = parsed.data.status as TaskStatus;

  await prisma.$transaction(async (tx) => {
    await tx.feedback.create({
      data: {
        submissionId: assignment.submission!.id,
        reviewerId: req.user!.id,
        comment: parsed.data.comment,
        newStatus,
      },
    });
    await tx.taskAssignment.update({
      where: { id: assignment.id },
      data: { status: newStatus },
    });
  });

  res.json({ message: "Reviewed", status: newStatus });
});

export default router;
