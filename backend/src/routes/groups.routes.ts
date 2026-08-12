import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { syncAllActiveMembers, syncGroupTasksToInterns } from "../services/groupTaskSync";
import { getTrainerGroupIds, syncPrimaryGroupTrainer, trainerOwnsGroup } from "../services/trainerScope";

const router = Router();
router.use(requireAuth);

async function getInternProfileId(userId: string) {
  const p = await prisma.internProfile.findUnique({ where: { userId } });
  return p?.id;
}

/** Add/reactivate membership without removing the intern from other groups. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureActiveMembership(tx: any, groupId: string, internId: string) {
  const existing = await tx.groupMember.findFirst({
    where: { groupId, internId },
    orderBy: { joinedAt: "desc" },
  });
  if (existing) {
    if (!existing.isActive) {
      await tx.groupMember.update({
        where: { id: existing.id },
        data: { isActive: true, leftAt: null },
      });
    }
    return;
  }
  await tx.groupMember.create({ data: { groupId, internId } });
}

router.get("/", requireRole("ADMIN", "HR", "TRAINER", "INTERN", "COLLEGE"), async (req, res) => {
  const role = req.user!.role;

  if (role === "TRAINER") {
    const myIds = await getTrainerGroupIds(req.user!.id);
    const groups = await prisma.trainingGroup.findMany({
      where: {
        id: { in: myIds },
        isActive: true,
        // Hide empty leftover groups from demos / mis-assigns
        members: { some: { isActive: true, intern: { approvalStatus: "APPROVED" } } },
      },
      include: {
        trainer: { select: { id: true, fullName: true, email: true } },
        trainers: { include: { trainer: { select: { id: true, fullName: true, email: true } } } },
        members: {
          where: { isActive: true, intern: { approvalStatus: "APPROVED" } },
          include: { intern: { include: { user: { select: { id: true, fullName: true, email: true } }, college: true } } },
        },
        _count: { select: { members: { where: { isActive: true, intern: { approvalStatus: "APPROVED" } } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ groups });
  }

  if (role === "INTERN") {
    const internId = await getInternProfileId(req.user!.id);
    const memberships = await prisma.groupMember.findMany({
      where: { internId: internId || "", isActive: true },
      include: {
        group: {
          include: {
            trainer: { select: { id: true, fullName: true } },
            _count: { select: { members: { where: { isActive: true } } } },
          },
        },
      },
    });
    return res.json({ groups: memberships.map((m) => m.group) });
  }

  if (role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId: req.user!.id } });
    if (!profile) return res.json({ groups: [] });
    const groups = await prisma.trainingGroup.findMany({
      where: {
        isActive: true,
        members: {
          some: {
            isActive: true,
            intern: { collegeId: profile.collegeId, approvalStatus: "APPROVED" },
          },
        },
      },
      include: {
        trainer: { select: { id: true, fullName: true } },
        members: {
          where: {
            isActive: true,
            intern: { collegeId: profile.collegeId, approvalStatus: "APPROVED" },
          },
          include: { intern: { include: { user: { select: { id: true, fullName: true, email: true } } } } },
        },
      },
      orderBy: { name: "asc" },
    });
    return res.json({ groups });
  }

  const groups = await prisma.trainingGroup.findMany({
    where: { isActive: true },
    include: {
      trainer: { select: { id: true, fullName: true, email: true } },
      trainers: { include: { trainer: { select: { id: true, fullName: true, email: true } } } },
      members: {
        where: { isActive: true, intern: { approvalStatus: "APPROVED" } },
        include: { intern: { include: { user: { select: { id: true, fullName: true, email: true } }, college: true } } },
      },
      _count: { select: { members: { where: { isActive: true, intern: { approvalStatus: "APPROVED" } } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ groups });
});

/** Interns available to add to a group, college-wise (excludes current group members) */
router.get("/available-interns", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const excludeGroupId =
    typeof req.query.excludeGroupId === "string" && req.query.excludeGroupId
      ? req.query.excludeGroupId
      : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  let scopeWhere: Record<string, unknown> = {};
  if (req.user!.role === "TRAINER") {
    const groupIds = await getTrainerGroupIds(req.user!.id);
    const linked = groupIds.length
      ? await prisma.groupMember.findMany({
          where: { isActive: true, groupId: { in: groupIds } },
          select: { internId: true },
        })
      : [];
    const ids = [...new Set(linked.map((m) => m.internId))];
    // Own-group interns + interns not in any active group yet
    scopeWhere = {
      OR: [{ id: { in: ids.length ? ids : ["__none__"] } }, { memberships: { none: { isActive: true } } }],
    };
  }

  const profiles = await prisma.internProfile.findMany({
    where: {
      approvalStatus: "APPROVED",
      ...scopeWhere,
      user: {
        isActive: true,
        role: "INTERN",
        ...(q
          ? {
              OR: [{ fullName: { contains: q } }, { email: { contains: q } }],
            }
          : {}),
      },
      ...(excludeGroupId
        ? { memberships: { none: { groupId: excludeGroupId, isActive: true } } }
        : {}),
    },
    select: {
      id: true,
      collegeId: true,
      college: { select: { id: true, name: true } },
      user: { select: { fullName: true, email: true } },
      memberships: {
        where: { isActive: true },
        select: { group: { select: { id: true, name: true } } },
      },
    },
    orderBy: { user: { fullName: "asc" } },
  });

  // For ADMIN/HR create-group: also include ungrouped + all colleges
  // Trainer already filtered

  type InternRow = {
    internId: string;
    fullName: string;
    email: string;
    otherGroups: { id: string; name: string }[];
  };

  const byCollege = new Map<string, { id: string; name: string; interns: InternRow[] }>();
  const noCollege: InternRow[] = [];

  for (const p of profiles) {
    const otherGroups = p.memberships
      .map((m) => m.group)
      .filter((g) => !excludeGroupId || g.id !== excludeGroupId);
    const row: InternRow = {
      internId: p.id,
      fullName: p.user.fullName,
      email: p.user.email,
      otherGroups,
    };
    if (p.college?.id) {
      let bucket = byCollege.get(p.college.id);
      if (!bucket) {
        bucket = { id: p.college.id, name: p.college.name, interns: [] };
        byCollege.set(p.college.id, bucket);
      }
      bucket.interns.push(row);
    } else {
      noCollege.push(row);
    }
  }

  const colleges = [...byCollege.values()].sort((a, b) => a.name.localeCompare(b.name));
  res.json({
    colleges,
    noCollege,
    total: profiles.length,
  });
});

async function assertUniqueGroupName(name: string, excludeId?: string) {
  const trimmed = name.trim();
  const existing = await prisma.trainingGroup.findFirst({
    where: {
      name: trimmed,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return !existing;
}

router.post("/", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    batchLabel: z.string().optional(),
    trainerId: z.string().optional(),
    trainerIds: z.array(z.string()).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    internIds: z.array(z.string()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  const unique = await assertUniqueGroupName(parsed.data.name);
  if (!unique) {
    return res.status(409).json({ message: "Group name already exists — choose a unique name" });
  }

  const trainerId =
    req.user!.role === "TRAINER" ? req.user!.id : parsed.data.trainerId || null;

  const group = await prisma.$transaction(async (tx) => {
    const g = await tx.trainingGroup.create({
      data: {
        name: parsed.data.name.trim(),
        batchLabel: parsed.data.batchLabel || null,
        trainerId,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      },
    });

    if (trainerId) {
      await tx.groupTrainer.upsert({
        where: { groupId_trainerId: { groupId: g.id, trainerId } },
        update: {},
        create: { groupId: g.id, trainerId },
      });
    }
    const extras = (parsed.data.trainerIds || []).filter((id) => id && id !== trainerId);
    for (const tid of extras) {
      if (req.user!.role === "TRAINER") continue;
      await tx.groupTrainer.upsert({
        where: { groupId_trainerId: { groupId: g.id, trainerId: tid } },
        update: {},
        create: { groupId: g.id, trainerId: tid },
      });
    }

    const internIds = parsed.data.internIds || [];
    for (const internId of internIds) {
      await ensureActiveMembership(tx, g.id, internId);
    }
    return g;
  });

  if ((parsed.data.internIds || []).length) {
    await syncGroupTasksToInterns(group.id, parsed.data.internIds || []);
  }

  const full = await prisma.trainingGroup.findUnique({
    where: { id: group.id },
    include: {
      trainer: { select: { id: true, fullName: true } },
      trainers: { include: { trainer: { select: { id: true, fullName: true } } } },
      members: { where: { isActive: true }, include: { intern: { include: { user: true, college: true } } } },
    },
  });
  res.status(201).json({ group: full });
});

router.post("/:id/members", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({ internIds: z.array(z.string()).min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "internIds required" });

  const group = await prisma.trainingGroup.findUnique({ where: { id: req.params.id } });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (req.user!.role === "TRAINER" && !(await trainerOwnsGroup(req.user!.id, group.id))) {
    return res.status(403).json({ message: "Not your group" });
  }

  await prisma.$transaction(async (tx) => {
    for (const internId of parsed.data.internIds) {
      await ensureActiveMembership(tx, group.id, internId);
    }
  });

  // Copy existing group tasks onto newly added members only
  const sync = await syncGroupTasksToInterns(group.id, parsed.data.internIds);

  res.json({
    message: "Members added",
    tasksAssigned: sync.assigned,
    submissionsSynced: sync.synced,
    groupTasksFound: sync.taskCount,
  });
});

/** Backfill: assign this group's existing tasks to all active members (idempotent). */
router.post("/:id/sync-tasks", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const group = await prisma.trainingGroup.findUnique({ where: { id: req.params.id } });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (req.user!.role === "TRAINER" && !(await trainerOwnsGroup(req.user!.id, group.id))) {
    return res.status(403).json({ message: "Not your group" });
  }

  const sync = await syncAllActiveMembers(group.id);
  res.json({
    message: "Group tasks synced to members",
    tasksAssigned: sync.assigned,
    submissionsSynced: sync.synced,
    groupTasksFound: sync.taskCount,
  });
});

router.delete("/:id/members/:internId", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const group = await prisma.trainingGroup.findUnique({ where: { id: req.params.id } });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (req.user!.role === "TRAINER" && !(await trainerOwnsGroup(req.user!.id, group.id))) {
    return res.status(403).json({ message: "Not your group" });
  }

  await prisma.groupMember.updateMany({
    where: { groupId: group.id, internId: req.params.internId, isActive: true },
    data: { isActive: false, leftAt: new Date() },
  });
  res.json({ message: "Member removed" });
});

router.patch("/:id/complete", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    internshipStatus: z.enum(["ACTIVE", "COMPLETED"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "internshipStatus required" });

  const group = await prisma.trainingGroup.findUnique({ where: { id: req.params.id } });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (req.user!.role === "TRAINER" && !(await trainerOwnsGroup(req.user!.id, group.id))) {
    return res.status(403).json({ message: "Not your group" });
  }

  const updated = await prisma.trainingGroup.update({
    where: { id: group.id },
    data:
      parsed.data.internshipStatus === "COMPLETED"
        ? {
            internshipStatus: "COMPLETED",
            completedAt: new Date(),
            completedById: req.user!.id,
          }
        : {
            internshipStatus: "ACTIVE",
            completedAt: null,
            completedById: null,
          },
    include: {
      trainer: { select: { id: true, fullName: true } },
      completedBy: { select: { fullName: true, role: true } },
      members: {
        where: { isActive: true },
        include: { intern: { include: { user: true, college: true } } },
      },
    },
  });

  // When completing group, optionally mark all active members completed
  if (parsed.data.internshipStatus === "COMPLETED") {
    await prisma.internProfile.updateMany({
      where: {
        memberships: { some: { groupId: group.id, isActive: true } },
        internshipStatus: "ACTIVE",
      },
      data: {
        internshipStatus: "COMPLETED",
        completedAt: new Date(),
        completedById: req.user!.id,
      },
    });
  }

  res.json({ group: updated });
});

router.patch("/:id", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    batchLabel: z.string().nullable().optional(),
    trainerId: z.string().nullable().optional(),
    trainerIds: z.array(z.string()).optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  const group = await prisma.trainingGroup.findUnique({ where: { id: req.params.id } });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (req.user!.role === "TRAINER" && !(await trainerOwnsGroup(req.user!.id, group.id))) {
    return res.status(403).json({ message: "Not your group" });
  }

  if (parsed.data.name) {
    const unique = await assertUniqueGroupName(parsed.data.name, group.id);
    if (!unique) {
      return res.status(409).json({ message: "Group name already exists — choose a unique name" });
    }
  }

  const updated = await prisma.trainingGroup.update({
    where: { id: group.id },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.batchLabel !== undefined ? { batchLabel: parsed.data.batchLabel } : {}),
      ...(parsed.data.trainerId !== undefined && req.user!.role !== "TRAINER"
        ? { trainerId: parsed.data.trainerId }
        : {}),
      ...(parsed.data.startDate !== undefined
        ? { startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null }
        : {}),
      ...(parsed.data.endDate !== undefined
        ? { endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null }
        : {}),
    },
  });

  if (parsed.data.trainerId !== undefined && req.user!.role !== "TRAINER") {
    await syncPrimaryGroupTrainer(updated.id, parsed.data.trainerId);
  }
  if (parsed.data.trainerIds && (req.user!.role === "ADMIN" || req.user!.role === "HR")) {
    for (const tid of parsed.data.trainerIds) {
      await prisma.groupTrainer.upsert({
        where: { groupId_trainerId: { groupId: updated.id, trainerId: tid } },
        update: {},
        create: { groupId: updated.id, trainerId: tid },
      });
    }
  }

  const full = await prisma.trainingGroup.findUnique({
    where: { id: updated.id },
    include: {
      trainer: { select: { id: true, fullName: true } },
      trainers: { include: { trainer: { select: { id: true, fullName: true } } } },
      members: {
        where: { isActive: true },
        include: { intern: { include: { user: true, college: true } } },
      },
    },
  });

  res.json({ group: full });
});

router.delete("/:id", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const group = await prisma.trainingGroup.findUnique({ where: { id: req.params.id } });
  if (!group) return res.status(404).json({ message: "Group not found" });
  if (req.user!.role === "TRAINER" && !(await trainerOwnsGroup(req.user!.id, group.id))) {
    return res.status(403).json({ message: "Not your group" });
  }

  await prisma.$transaction([
    prisma.groupMember.updateMany({
      where: { groupId: group.id, isActive: true },
      data: { isActive: false, leftAt: new Date() },
    }),
    prisma.trainingGroup.update({
      where: { id: group.id },
      data: { isActive: false },
    }),
  ]);
  res.json({ message: "Group archived" });
});

export default router;
