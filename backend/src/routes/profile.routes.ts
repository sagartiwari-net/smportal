import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword, verifyPassword } from "../utils/password";
import { getTrainerGroupIds } from "../services/trainerScope";

const router = Router();
router.use(requireAuth);

const profileFieldsSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

async function loadUserProfile(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      createdAt: true,
      internProfile: {
        include: {
          college: { select: { id: true, name: true } },
          memberships: {
            where: { isActive: true },
            include: { group: { select: { id: true, name: true, batchLabel: true } } },
          },
        },
      },
      trainerProfile: true,
      collegeProfile: { include: { college: { select: { id: true, name: true } } } },
    },
  });
}

router.get("/me", async (req, res) => {
  const profile = await loadUserProfile(req.user!.id);
  if (!profile) return res.status(404).json({ message: "User not found" });
  res.json({ profile });
});

router.patch("/password", async (req, res) => {
  const schema = z.object({
    oldPassword: z.string().min(1),
    newPassword: z.string().min(6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "oldPassword and newPassword (min 6) required" });

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ message: "User not found" });

  const ok = await verifyPassword(parsed.data.oldPassword, user.passwordHash);
  if (!ok) return res.status(400).json({ message: "Current password is incorrect" });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });

  res.json({ message: "Password updated" });
});

/** Lightweight college/group tree with counts (no student rows) */
router.get("/student-tree", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const actor = req.user!;

  let allowedGroupIds: string[] | null = null;
  let collegeIdScope: string | null = null;

  if (actor.role === "TRAINER") {
    allowedGroupIds = await getTrainerGroupIds(actor.id);
    if (!allowedGroupIds.length) {
      return res.json({ mode: "group", groups: [], totals: { active: 0, completed: 0 } });
    }
  } else if (actor.role === "COLLEGE") {
    const cp = await prisma.collegeProfile.findUnique({ where: { userId: actor.id } });
    if (!cp) return res.json({ mode: "group", groups: [], totals: { active: 0, completed: 0 } });
    collegeIdScope = cp.collegeId;
  }

  const memberWhere = {
    isActive: true,
    intern: {
      approvalStatus: "APPROVED" as const,
      ...(collegeIdScope ? { collegeId: collegeIdScope } : {}),
    },
  };

  const memberships = await prisma.groupMember.findMany({
    where: {
      ...memberWhere,
      ...(allowedGroupIds ? { groupId: { in: allowedGroupIds } } : {}),
    },
    select: {
      groupId: true,
      intern: {
        select: {
          internshipStatus: true,
          collegeId: true,
          college: { select: { id: true, name: true } },
        },
      },
      group: { select: { id: true, name: true, batchLabel: true, isActive: true } },
    },
  });

  // Also count approved interns with no active group membership (scoped)
  const ungroupedWhere: Record<string, unknown> = {
    approvalStatus: "APPROVED",
    memberships: { none: { isActive: true } },
    ...(collegeIdScope ? { collegeId: collegeIdScope } : {}),
    ...(allowedGroupIds
      ? {
          // trainer: ungrouped outside their groups shouldn't show — skip ungrouped for trainer
        }
      : {}),
  };

  const ungroupedInterns =
    actor.role === "TRAINER"
      ? []
      : await prisma.internProfile.findMany({
          where: ungroupedWhere as never,
          select: {
            internshipStatus: true,
            collegeId: true,
            college: { select: { id: true, name: true } },
          },
        });

  type GroupBucket = {
    id: string;
    name: string;
    batchLabel: string | null;
    activeCount: number;
    completedCount: number;
  };
  type CollegeBucket = {
    id: string;
    name: string;
    activeCount: number;
    completedCount: number;
    groups: Map<string, GroupBucket>;
    ungroupedActive: number;
    ungroupedCompleted: number;
  };

  const totals = { active: 0, completed: 0 };

  if (actor.role === "ADMIN" || actor.role === "HR") {
    const colleges = new Map<string, CollegeBucket>();
    const ensureCollege = (id: string, name: string) => {
      let c = colleges.get(id);
      if (!c) {
        c = {
          id,
          name,
          activeCount: 0,
          completedCount: 0,
          groups: new Map(),
          ungroupedActive: 0,
          ungroupedCompleted: 0,
        };
        colleges.set(id, c);
      }
      return c;
    };

    for (const m of memberships) {
      const st = m.intern.internshipStatus;
      const cid = m.intern.collegeId || "__none__";
      const cname = m.intern.college?.name || "Direct hire (no college)";
      const college = ensureCollege(cid, cname);
      let g = college.groups.get(m.groupId);
      if (!g) {
        g = {
          id: m.group.id,
          name: m.group.name,
          batchLabel: m.group.batchLabel,
          activeCount: 0,
          completedCount: 0,
        };
        college.groups.set(m.groupId, g);
      }
      if (st === "COMPLETED") {
        g.completedCount++;
        college.completedCount++;
        totals.completed++;
      } else {
        g.activeCount++;
        college.activeCount++;
        totals.active++;
      }
    }

    for (const u of ungroupedInterns) {
      const cid = u.collegeId || "__none__";
      const cname = u.college?.name || "Direct hire (no college)";
      const college = ensureCollege(cid, cname);
      if (u.internshipStatus === "COMPLETED") {
        college.ungroupedCompleted++;
        college.completedCount++;
        totals.completed++;
      } else {
        college.ungroupedActive++;
        college.activeCount++;
        totals.active++;
      }
    }

    return res.json({
      mode: "college-group",
      totals,
      colleges: [...colleges.values()]
        .map((c) => ({
          id: c.id,
          name: c.name,
          activeCount: c.activeCount,
          completedCount: c.completedCount,
          ungroupedActive: c.ungroupedActive,
          ungroupedCompleted: c.ungroupedCompleted,
          groups: [...c.groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  // Trainer / College — group-wise
  const groups = new Map<string, GroupBucket>();
  for (const m of memberships) {
    let g = groups.get(m.groupId);
    if (!g) {
      g = {
        id: m.group.id,
        name: m.group.name,
        batchLabel: m.group.batchLabel,
        activeCount: 0,
        completedCount: 0,
      };
      groups.set(m.groupId, g);
    }
    if (m.intern.internshipStatus === "COMPLETED") {
      g.completedCount++;
      totals.completed++;
    } else {
      g.activeCount++;
      totals.active++;
    }
  }

  let ungroupedActive = 0;
  let ungroupedCompleted = 0;
  if (actor.role === "COLLEGE") {
    for (const u of ungroupedInterns) {
      if (u.internshipStatus === "COMPLETED") {
        ungroupedCompleted++;
        totals.completed++;
      } else {
        ungroupedActive++;
        totals.active++;
      }
    }
  }

  res.json({
    mode: "group",
    totals,
    ungroupedActive,
    ungroupedCompleted,
    groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
  });
});

/** Paginated intern list — filter by group / college / status */
router.get("/interns", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const actor = req.user!;
  const q = String(req.query.q || "").trim();
  const groupId = String(req.query.groupId || "").trim() || null;
  const collegeIdRaw = String(req.query.collegeId || "").trim() || null;
  const ungrouped = String(req.query.ungrouped || "") === "1";
  const statusFilter = String(req.query.status || "ACTIVE").toUpperCase();
  const internshipStatus =
    statusFilter === "COMPLETED" ? ("COMPLETED" as const) : ("ACTIVE" as const);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 15));

  let collegeIdScope: string | null = null;
  let allowedGroupIds: string[] | null = null;

  if (actor.role === "COLLEGE") {
    const cp = await prisma.collegeProfile.findUnique({ where: { userId: actor.id } });
    if (!cp) return res.json({ interns: [], total: 0, page, pageSize, totalPages: 0 });
    collegeIdScope = cp.collegeId;
  } else if (actor.role === "TRAINER") {
    allowedGroupIds = await getTrainerGroupIds(actor.id);
    if (!allowedGroupIds.length) {
      return res.json({ interns: [], total: 0, page, pageSize, totalPages: 0 });
    }
    if (groupId && !allowedGroupIds.includes(groupId)) {
      return res.status(403).json({ message: "Group not in your scope" });
    }
  }

  const collegeId =
    collegeIdRaw === "__none__" ? null : collegeIdRaw;
  const filterNoCollege = collegeIdRaw === "__none__";

  const profileWhere: Record<string, unknown> = {
    approvalStatus: "APPROVED",
    internshipStatus,
  };

  if (collegeIdScope) profileWhere.collegeId = collegeIdScope;
  else if (filterNoCollege) profileWhere.collegeId = null;
  else if (collegeId) profileWhere.collegeId = collegeId;

  if (ungrouped) {
    profileWhere.memberships = { none: { isActive: true } };
  } else if (groupId) {
    profileWhere.memberships = { some: { isActive: true, groupId } };
  } else if (allowedGroupIds) {
    profileWhere.memberships = { some: { isActive: true, groupId: { in: allowedGroupIds } } };
  }

  const userWhere: Record<string, unknown> = {
    role: "INTERN",
    isActive: true,
    internProfile: profileWhere,
  };

  if (q) {
    userWhere.OR = [
      { fullName: { contains: q } },
      { email: { contains: q } },
    ];
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where: userWhere as never }),
    prisma.user.findMany({
      where: userWhere as never,
      select: {
        id: true,
        fullName: true,
        email: true,
        internProfile: {
          select: {
            id: true,
            phone: true,
            address: true,
            internshipStatus: true,
            college: { select: { id: true, name: true } },
            memberships: {
              where: { isActive: true },
              select: { group: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: { fullName: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  res.json({
    total,
    page,
    pageSize,
    totalPages,
    interns: users.map((u) => ({
      userId: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.internProfile?.phone ?? null,
      address: u.internProfile?.address ?? null,
      internshipStatus: u.internProfile?.internshipStatus ?? "ACTIVE",
      college: u.internProfile?.college ?? null,
      groups: u.internProfile?.memberships.map((m) => m.group) ?? [],
      locked:
        u.internProfile?.internshipStatus === "COMPLETED" &&
        actor.role !== "ADMIN" &&
        actor.role !== "HR",
    })),
  });
});

async function assertCanEditIntern(
  actorId: string,
  actorRole: string,
  targetUserId: string,
): Promise<{ ok: true; target: NonNullable<Awaited<ReturnType<typeof loadUserProfile>>> } | { ok: false; status: number; message: string }> {
  const target = await loadUserProfile(targetUserId);
  if (!target || target.role !== "INTERN" || !target.internProfile) {
    return { ok: false, status: 404, message: "Intern not found" };
  }
  if (target.internProfile.approvalStatus !== "APPROVED") {
    return { ok: false, status: 400, message: "Only approved interns can be edited here" };
  }

  const completed = target.internProfile.internshipStatus === "COMPLETED";
  if (completed && actorRole !== "ADMIN" && actorRole !== "HR") {
    return {
      ok: false,
      status: 403,
      message: "Completed internship details can only be changed by Admin or HR",
    };
  }

  if (actorRole === "ADMIN" || actorRole === "HR") {
    return { ok: true, target };
  }

  if (actorRole === "TRAINER") {
    const groupIds = await getTrainerGroupIds(actorId);
    const inGroup = target.internProfile.memberships.some((m) => groupIds.includes(m.group.id));
    if (!inGroup) return { ok: false, status: 403, message: "Intern is not in your groups" };
    return { ok: true, target };
  }

  if (actorRole === "COLLEGE") {
    const cp = await prisma.collegeProfile.findUnique({ where: { userId: actorId } });
    if (!cp || target.internProfile.collegeId !== cp.collegeId) {
      return { ok: false, status: 403, message: "Intern is not from your college" };
    }
    return { ok: true, target };
  }

  return { ok: false, status: 403, message: "Forbidden" };
}

async function applyInternProfileChanges(
  targetUserId: string,
  changes: {
    fullName?: string;
    email?: string;
    phone?: string | null;
    address?: string | null;
  },
) {
  await prisma.$transaction(async (tx) => {
    const userData: { fullName?: string; email?: string } = {};
    if (changes.fullName !== undefined) userData.fullName = changes.fullName.trim();
    if (changes.email !== undefined) userData.email = changes.email.toLowerCase().trim();
    if (Object.keys(userData).length) {
      await tx.user.update({ where: { id: targetUserId }, data: userData });
    }
    const profileData: { phone?: string | null; address?: string | null } = {};
    if (changes.phone !== undefined) profileData.phone = changes.phone;
    if (changes.address !== undefined) profileData.address = changes.address;
    if (Object.keys(profileData).length) {
      await tx.internProfile.update({ where: { userId: targetUserId }, data: profileData });
    }
  });
}

/**
 * Edit intern profile.
 * COLLEGE → creates pending ProfileChangeRequest (needs Admin/HR/Trainer approval).
 * ADMIN / HR / TRAINER → apply immediately (completed lock for trainer).
 */
router.patch("/interns/:userId", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const parsed = profileFieldsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  const access = await assertCanEditIntern(req.user!.id, req.user!.role, req.params.userId);
  if (!access.ok) return res.status(access.status).json({ message: access.message });

  const { target } = access;
  const data = parsed.data;
  const hasChange =
    (data.fullName !== undefined && data.fullName.trim() !== target.fullName) ||
    (data.email !== undefined && data.email.toLowerCase().trim() !== target.email) ||
    (data.phone !== undefined && (data.phone || null) !== (target.internProfile?.phone || null)) ||
    (data.address !== undefined && (data.address || null) !== (target.internProfile?.address || null));

  if (!hasChange) return res.status(400).json({ message: "No changes detected" });

  if (req.user!.role === "COLLEGE") {
    const existing = await prisma.profileChangeRequest.findFirst({
      where: { targetUserId: target.id, status: "PENDING" },
    });
    if (existing) {
      return res.status(409).json({
        message: "A pending change request already exists for this student. Wait for approval.",
      });
    }

    const request = await prisma.profileChangeRequest.create({
      data: {
        targetUserId: target.id,
        requestedById: req.user!.id,
        status: "PENDING",
        proposedFullName: data.fullName?.trim() ?? target.fullName,
        proposedEmail: data.email?.toLowerCase().trim() ?? target.email,
        proposedPhone: data.phone !== undefined ? data.phone : target.internProfile?.phone ?? null,
        proposedAddress: data.address !== undefined ? data.address : target.internProfile?.address ?? null,
        previousFullName: target.fullName,
        previousEmail: target.email,
        previousPhone: target.internProfile?.phone ?? null,
        previousAddress: target.internProfile?.address ?? null,
        note: data.note || null,
      },
    });

    return res.status(201).json({
      mode: "request",
      message: "Change request sent for Admin/HR/Trainer approval",
      request,
    });
  }

  try {
    await applyInternProfileChanges(target.id, {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      address: data.address,
    });
  } catch {
    return res.status(409).json({ message: "Email may already be in use" });
  }

  // Audit trail for direct staff edits
  await prisma.profileChangeRequest.create({
    data: {
      targetUserId: target.id,
      requestedById: req.user!.id,
      status: "APPROVED",
      proposedFullName: data.fullName?.trim() ?? null,
      proposedEmail: data.email?.toLowerCase().trim() ?? null,
      proposedPhone: data.phone !== undefined ? data.phone : null,
      proposedAddress: data.address !== undefined ? data.address : null,
      previousFullName: target.fullName,
      previousEmail: target.email,
      previousPhone: target.internProfile?.phone ?? null,
      previousAddress: target.internProfile?.address ?? null,
      reviewedById: req.user!.id,
      reviewedAt: new Date(),
      note: data.note || "Direct edit by staff",
    },
  });

  const updated = await loadUserProfile(target.id);
  res.json({ mode: "direct", message: "Profile updated", profile: updated });
});

router.get("/change-requests", requireRole("ADMIN", "HR", "TRAINER", "COLLEGE"), async (req, res) => {
  const status = req.query.status as string | undefined;
  const actor = req.user!;

  const where: Record<string, unknown> = {};
  if (status && ["PENDING", "APPROVED", "REJECTED"].includes(status)) {
    where.status = status;
  }

  if (actor.role === "COLLEGE") {
    where.requestedById = actor.id;
  } else if (actor.role === "TRAINER") {
    const groupIds = await getTrainerGroupIds(actor.id);
    if (!groupIds.length) return res.json({ requests: [] });
    where.targetUser = {
      internProfile: {
        memberships: { some: { isActive: true, groupId: { in: groupIds } } },
      },
    };
  }

  const requests = await prisma.profileChangeRequest.findMany({
    where: where as never,
    include: {
      targetUser: {
        select: {
          id: true,
          fullName: true,
          email: true,
          internProfile: {
            select: {
              college: { select: { name: true } },
              internshipStatus: true,
            },
          },
        },
      },
      requestedBy: { select: { id: true, fullName: true, email: true, role: true } },
      reviewedBy: { select: { id: true, fullName: true, email: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  res.json({ requests });
});

router.post(
  "/change-requests/:id/approve",
  requireRole("ADMIN", "HR", "TRAINER"),
  async (req, res) => {
    const request = await prisma.profileChangeRequest.findUnique({
      where: { id: req.params.id },
      include: {
        targetUser: { include: { internProfile: { include: { memberships: true } } } },
      },
    });
    if (!request || request.status !== "PENDING") {
      return res.status(404).json({ message: "Pending request not found" });
    }

    const access = await assertCanEditIntern(req.user!.id, req.user!.role, request.targetUserId);
    if (!access.ok) return res.status(access.status).json({ message: access.message });

    try {
      await applyInternProfileChanges(request.targetUserId, {
        fullName: request.proposedFullName || undefined,
        email: request.proposedEmail || undefined,
        phone: request.proposedPhone,
        address: request.proposedAddress,
      });
    } catch {
      return res.status(409).json({ message: "Could not apply changes (email conflict?)" });
    }

    const updated = await prisma.profileChangeRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
      },
    });

    res.json({ message: "Change approved and applied", request: updated });
  },
);

router.post(
  "/change-requests/:id/reject",
  requireRole("ADMIN", "HR", "TRAINER"),
  async (req, res) => {
    const schema = z.object({ note: z.string().max(500).optional() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

    const request = await prisma.profileChangeRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.status !== "PENDING") {
      return res.status(404).json({ message: "Pending request not found" });
    }

    const access = await assertCanEditIntern(req.user!.id, req.user!.role, request.targetUserId);
    if (!access.ok) return res.status(access.status).json({ message: access.message });

    const updated = await prisma.profileChangeRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
        note: parsed.data.note || request.note,
      },
    });

    res.json({ message: "Change request rejected", request: updated });
  },
);

export default router;
