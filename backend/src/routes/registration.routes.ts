import { createHash, randomBytes } from "crypto";
import { Router } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword } from "../utils/password";
import { syncPrimaryGroupTrainer } from "../services/trainerScope";
import { syncGroupTasksToInterns } from "../services/groupTaskSync";
import { env } from "../config/env";

const router = Router();

const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken() {
  return randomBytes(32).toString("hex");
}

function inviteLink(token: string) {
  const base = env.FRONTEND_URL.replace(/\/$/, "");
  return `${base}/invite/${token}`;
}

/** Delete expired PENDING invite registrations (and their users). */
export async function cleanupExpiredPendingInterns() {
  const expired = await prisma.internProfile.findMany({
    where: {
      approvalStatus: "PENDING",
      expiresAt: { lt: new Date() },
    },
    select: { id: true, userId: true, inviteId: true },
  });
  if (!expired.length) return 0;

  await prisma.$transaction(async (tx) => {
    await tx.user.deleteMany({ where: { id: { in: expired.map((e) => e.userId) } } });
    // Do not decrease usedCount — invite stays one-time USED; count = how many were submitted
  });
  return expired.length;
}

async function getInviteByRawToken(token: string) {
  const tokenHash = hashToken(token);
  return prisma.registrationInvite.findUnique({
    where: { tokenHash },
    include: {
      college: { select: { id: true, name: true } },
      group: { select: { id: true, name: true, batchLabel: true } },
      boundUser: { select: { id: true, fullName: true, email: true } },
      createdBy: { select: { id: true, fullName: true, role: true } },
    },
  });
}

async function refreshInviteStatus(invite: {
  id: string;
  status: string;
  expiresAt: Date;
  maxRegistrations: number | null;
  usedCount: number;
}) {
  // One-time use + revoke always win
  if (invite.status === "REVOKED" || invite.status === "USED") return invite.status;
  if (invite.expiresAt < new Date()) {
    if (invite.status !== "EXPIRED") {
      await prisma.registrationInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    }
    return "EXPIRED";
  }
  return invite.status;
}

const internRowSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7).max(20),
  address: z.string().min(3),
  password: z.string().min(6),
});

// ——— Admin / HR ———

router.get("/invites", requireAuth, requireRole("ADMIN", "HR"), async (_req, res) => {
  await cleanupExpiredPendingInterns();
  const invites = await prisma.registrationInvite.findMany({
    include: {
      college: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      boundUser: { select: { id: true, fullName: true, email: true } },
      createdBy: { select: { id: true, fullName: true, role: true } },
      _count: { select: { interns: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const withPending = await Promise.all(
    invites.map(async (inv) => {
      let status = inv.status;
      if (status === "ACTIVE" && inv.usedCount > 0) {
        await prisma.registrationInvite.update({ where: { id: inv.id }, data: { status: "USED" } });
        status = "USED";
      } else {
        status = await refreshInviteStatus(inv);
      }
      const pendingCount = await prisma.internProfile.count({
        where: { inviteId: inv.id, approvalStatus: "PENDING" },
      });
      return { ...inv, status, pendingCount, linkHint: "(token only shown once at create)" };
    }),
  );

  res.json({ invites: withPending });
});

router.post("/invites", requireAuth, requireRole("ADMIN", "HR"), async (req, res) => {
  const schema = z.object({
    collegeId: z.string().min(1),
    boundUserId: z.string().optional().nullable(),
    maxRegistrations: z.number().int().positive().nullable().optional(),
    expiresInDays: z.number().int().min(1).max(30).default(7),
    note: z.string().max(500).optional().nullable(),
    // group: existing OR new
    groupId: z.string().optional(),
    newGroup: z
      .object({
        name: z.string().min(2),
        batchLabel: z.string().optional(),
        trainerId: z.string().optional().nullable(),
      })
      .optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  }
  const data = parsed.data;
  if (!data.groupId && !data.newGroup) {
    return res.status(400).json({ message: "Select an existing group or provide newGroup" });
  }

  const college = await prisma.college.findUnique({ where: { id: data.collegeId } });
  if (!college) return res.status(404).json({ message: "College not found" });

  if (data.boundUserId) {
    const bound = await prisma.user.findUnique({
      where: { id: data.boundUserId },
      include: { collegeProfile: true },
    });
    if (!bound || bound.role !== "COLLEGE" || bound.collegeProfile?.collegeId !== data.collegeId) {
      return res.status(400).json({ message: "boundUserId must be a COLLEGE account for this college" });
    }
  }

  const rawToken = makeToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000);

  const invite = await prisma.$transaction(async (tx) => {
    let groupId = data.groupId || "";
    if (data.newGroup) {
      const trainerId = data.newGroup.trainerId || null;
      const group = await tx.trainingGroup.create({
        data: {
          name: data.newGroup.name.trim(),
          batchLabel: data.newGroup.batchLabel?.trim() || null,
          trainerId,
        },
      });
      groupId = group.id;
      if (trainerId) {
        await tx.groupTrainer.upsert({
          where: { groupId_trainerId: { groupId, trainerId } },
          create: { groupId, trainerId },
          update: {},
        });
      }
    } else {
      const g = await tx.trainingGroup.findUnique({ where: { id: groupId } });
      if (!g || !g.isActive) throw new Error("GROUP_NOT_FOUND");
    }

    return tx.registrationInvite.create({
      data: {
        tokenHash,
        collegeId: data.collegeId,
        groupId,
        createdById: req.user!.id,
        boundUserId: data.boundUserId || null,
        maxRegistrations: data.maxRegistrations ?? null,
        expiresAt,
        note: data.note || null,
      },
      include: {
        college: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        boundUser: { select: { id: true, fullName: true, email: true } },
      },
    });
  }).catch((e) => {
    if (e instanceof Error && e.message === "GROUP_NOT_FOUND") return null;
    throw e;
  });

  if (!invite) return res.status(404).json({ message: "Group not found" });

  if (data.newGroup?.trainerId) {
    await syncPrimaryGroupTrainer(invite.groupId);
  }

  res.status(201).json({
    invite,
    token: rawToken,
    link: inviteLink(rawToken),
  });
});

router.post("/invites/:id/revoke", requireAuth, requireRole("ADMIN", "HR"), async (req, res) => {
  const invite = await prisma.registrationInvite.findUnique({ where: { id: req.params.id } });
  if (!invite) return res.status(404).json({ message: "Invite not found" });
  const updated = await prisma.registrationInvite.update({
    where: { id: invite.id },
    data: { status: "REVOKED" },
  });
  res.json({ invite: updated });
});

router.get("/pending", requireAuth, requireRole("ADMIN", "HR"), async (_req, res) => {
  await cleanupExpiredPendingInterns();
  const interns = await prisma.internProfile.findMany({
    where: { approvalStatus: "PENDING" },
    include: {
      user: { select: { id: true, fullName: true, email: true, createdAt: true, isActive: true } },
      college: { select: { id: true, name: true } },
      invite: {
        select: {
          id: true,
          usedCount: true,
          group: { select: { id: true, name: true } },
          boundUser: { select: { id: true, fullName: true, email: true } },
        },
      },
      registeredBy: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { joinedAt: "desc" },
  });
  res.json({
    interns: interns.map((i) => ({
      ...i,
      inviteId: i.inviteId,
    })),
  });
});

router.post("/approve", requireAuth, requireRole("ADMIN", "HR"), async (req, res) => {
  const schema = z.object({
    internIds: z.array(z.string()).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "internIds required" });

  const pending = await prisma.internProfile.findMany({
    where: { id: { in: parsed.data.internIds }, approvalStatus: "PENDING" },
    include: { invite: true },
  });
  if (!pending.length) return res.status(404).json({ message: "No pending interns found" });

  await prisma.$transaction(async (tx) => {
    for (const intern of pending) {
      await tx.internProfile.update({
        where: { id: intern.id },
        data: {
          approvalStatus: "APPROVED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
          expiresAt: null,
        },
      });
      await tx.user.update({ where: { id: intern.userId }, data: { isActive: true } });

      const groupId = intern.invite?.groupId;
      if (groupId) {
        const existing = await tx.groupMember.findFirst({
          where: { internId: intern.id, groupId },
        });
        if (existing) {
          await tx.groupMember.update({
            where: { id: existing.id },
            data: { isActive: true, leftAt: null },
          });
        } else {
          await tx.groupMember.create({
            data: { internId: intern.id, groupId, isActive: true },
          });
        }
      }
    }
  });

  // Auto-assign existing group tasks to newly approved interns
  const byGroup = new Map<string, string[]>();
  for (const intern of pending) {
    const gid = intern.invite?.groupId;
    if (!gid) continue;
    const list = byGroup.get(gid) || [];
    list.push(intern.id);
    byGroup.set(gid, list);
  }
  for (const [gid, ids] of byGroup) {
    await syncGroupTasksToInterns(gid, ids);
  }

  res.json({ approved: pending.length });
});

router.post("/reject", requireAuth, requireRole("ADMIN", "HR"), async (req, res) => {
  const schema = z.object({
    internIds: z.array(z.string()).min(1),
    note: z.string().max(500).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "internIds required" });

  const pending = await prisma.internProfile.findMany({
    where: { id: { in: parsed.data.internIds }, approvalStatus: "PENDING" },
    select: { id: true, userId: true, inviteId: true },
  });
  if (!pending.length) return res.status(404).json({ message: "No pending interns found" });

  await prisma.$transaction(async (tx) => {
    await tx.user.deleteMany({ where: { id: { in: pending.map((p) => p.userId) } } });
    // Keep invite USED + usedCount intact (one-time link; partial reject OK)
  });

  const remainingByInvite = new Map<string, number>();
  for (const p of pending) {
    if (!p.inviteId) continue;
    remainingByInvite.set(p.inviteId, 0);
  }
  for (const inviteId of remainingByInvite.keys()) {
    const left = await prisma.internProfile.count({
      where: { inviteId, approvalStatus: "PENDING" },
    });
    remainingByInvite.set(inviteId, left);
  }

  res.json({
    rejected: pending.length,
    remainingPendingByInvite: Object.fromEntries(remainingByInvite),
  });
});

/** Direct company hire — no college required; immediately active in a group */
router.post("/direct-hire", requireAuth, requireRole("ADMIN", "HR"), async (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    password: z.string().min(6),
    groupId: z.string().optional(),
    newGroup: z
      .object({
        name: z.string().min(2),
        batchLabel: z.string().optional(),
        trainerId: z.string().optional().nullable(),
      })
      .optional(),
    hireNote: z.string().max(500).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  }
  const data = parsed.data;
  if (!data.groupId && !data.newGroup) {
    return res.status(400).json({ message: "Select groupId or newGroup" });
  }

  const email = data.email.toLowerCase().trim();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ message: "Email already registered" });

  const passwordHash = await hashPassword(data.password);

  const result = await prisma.$transaction(async (tx) => {
    let groupId = data.groupId || "";
    if (data.newGroup) {
      const trainerId = data.newGroup.trainerId || null;
      const group = await tx.trainingGroup.create({
        data: {
          name: data.newGroup.name.trim(),
          batchLabel: data.newGroup.batchLabel?.trim() || null,
          trainerId,
        },
      });
      groupId = group.id;
      if (trainerId) {
        await tx.groupTrainer.create({ data: { groupId, trainerId } });
      }
    }

    const user = await tx.user.create({
      data: {
        email,
        fullName: data.fullName.trim(),
        passwordHash,
        role: "INTERN",
        isActive: true,
      },
    });

    const intern = await tx.internProfile.create({
      data: {
        userId: user.id,
        phone: data.phone || null,
        address: data.address || null,
        collegeId: null,
        approvalStatus: "APPROVED",
        approvedById: req.user!.id,
        approvedAt: new Date(),
        isHired: true,
        hiredAt: new Date(),
        hiredById: req.user!.id,
        hireNote: data.hireNote || "Direct company hire",
        registeredById: req.user!.id,
      },
    });

    await tx.groupMember.create({
      data: { internId: intern.id, groupId, isActive: true },
    });

    return { user, intern, groupId };
  });

  if (data.newGroup?.trainerId) await syncPrimaryGroupTrainer(result.groupId);

  await syncGroupTasksToInterns(result.groupId, [result.intern.id]);

  res.status(201).json({
    intern: {
      id: result.intern.id,
      fullName: result.user.fullName,
      email: result.user.email,
      groupId: result.groupId,
    },
  });
});

// ——— College teacher invite usage ———

router.get("/invite/:token", requireAuth, requireRole("COLLEGE", "ADMIN", "HR"), async (req, res) => {
  await cleanupExpiredPendingInterns();
  const invite = await getInviteByRawToken(req.params.token);
  if (!invite) return res.status(404).json({ message: "Invalid invite link" });

  // One-time link: if a batch was already submitted (pending or historically used), lock it
  if (invite.status === "ACTIVE") {
    const anySubmitted = await prisma.internProfile.count({
      where: { inviteId: invite.id },
    });
    const pendingCount = await prisma.internProfile.count({
      where: { inviteId: invite.id, approvalStatus: "PENDING" },
    });
    // pending OR any prior usedCount means this link was already consumed once
    if (pendingCount > 0 || invite.usedCount > 0 || anySubmitted > 0) {
      await prisma.registrationInvite.update({
        where: { id: invite.id },
        data: { status: "USED" },
      });
      invite.status = "USED";
    }
  }

  const status = await refreshInviteStatus(invite);

  if (req.user!.role === "COLLEGE") {
    const profile = await prisma.collegeProfile.findUnique({ where: { userId: req.user!.id } });
    if (!profile || profile.collegeId !== invite.collegeId) {
      return res.status(403).json({ message: "This invite is for a different college" });
    }
    if (invite.boundUserId && invite.boundUserId !== req.user!.id) {
      return res.status(403).json({ message: "This invite is bound to another college account" });
    }
  }

  const pendingCount = await prisma.internProfile.count({
    where: { inviteId: invite.id, approvalStatus: "PENDING" },
  });
  // One-time link: maxRegistrations = max students in the single submission batch
  const batchCap = invite.maxRegistrations;
  const remaining = invite.status === "ACTIVE" && invite.usedCount === 0 ? batchCap : 0;

  const canSubmit =
    status === "ACTIVE" && invite.usedCount === 0 && pendingCount === 0;

  let blockReason: string | null = null;
  if (status === "USED" || invite.usedCount > 0) {
    blockReason =
      pendingCount > 0
        ? "This invite link was already used. Submission is waiting for Admin/HR approval — ask for a new link if needed."
        : "This invite link was already used once and is no longer valid. Ask Admin/HR for a new link.";
  } else if (status === "REVOKED") {
    blockReason = "This invite link was revoked by Admin/HR.";
  } else if (status === "EXPIRED") {
    blockReason = "This invite link has expired. Ask Admin/HR for a new link.";
  } else if (pendingCount > 0) {
    blockReason =
      "Previous submission is waiting for Admin/HR approval. You cannot submit again until it is approved or rejected.";
  }

  res.json({
    invite: {
      id: invite.id,
      status,
      college: invite.college,
      group: invite.group,
      boundUser: invite.boundUser,
      maxRegistrations: invite.maxRegistrations,
      usedCount: invite.usedCount,
      remaining,
      batchLimit: batchCap,
      oneTime: true,
      expiresAt: invite.expiresAt,
      note: invite.note,
      pendingCount,
      canSubmit,
      blockReason,
    },
  });
});

router.get("/template.xlsx", requireAuth, requireRole("COLLEGE", "ADMIN", "HR"), async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Interns");
  sheet.columns = [
    { header: "fullName", width: 24 },
    { header: "email", width: 28 },
    { header: "phone", width: 16 },
    { header: "address", width: 36 },
    { header: "password", width: 16 },
  ];
  sheet.addRow({
    fullName: "Aarav Sharma",
    email: "aarav.example@college.edu",
    phone: "9876543210",
    address: "12 MG Road, Delhi",
    password: "ChangeMe123",
  });
  sheet.getRow(1).font = { bold: true };
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="intern-registration-template.xlsx"');
  res.send(buffer);
});

router.post("/invite/:token/parse-excel", requireAuth, requireRole("COLLEGE", "ADMIN", "HR"), async (req, res) => {
  const schema = z.object({ fileBase64: z.string().min(20) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "fileBase64 required" });

  const invite = await getInviteByRawToken(req.params.token);
  if (!invite) return res.status(404).json({ message: "Invalid invite link" });
  if ((await refreshInviteStatus(invite)) !== "ACTIVE") {
    return res.status(410).json({ message: "Invite not active" });
  }

  const buf = Buffer.from(parsed.data.fileBase64.replace(/^data:.*base64,/, ""), "base64");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  if (!sheet) return res.status(400).json({ message: "Empty workbook" });

  const rows: { fullName: string; email: string; phone: string; address: string; password: string }[] = [];
  const errors: { row: number; message: string }[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const fullName = String(row.getCell(1).text || "").trim();
    const email = String(row.getCell(2).text || "").trim();
    const phone = String(row.getCell(3).text || "").trim();
    const address = String(row.getCell(4).text || "").trim();
    const password = String(row.getCell(5).text || "").trim();
    if (!fullName && !email && !phone && !address && !password) return;
    const check = internRowSchema.safeParse({ fullName, email, phone, address, password });
    if (!check.success) {
      errors.push({ row: rowNumber, message: check.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    rows.push(check.data);
  });

  res.json({ rows, errors });
});

router.post("/invite/:token/submit", requireAuth, requireRole("COLLEGE"), async (req, res) => {
  await cleanupExpiredPendingInterns();

  const schema = z.object({
    interns: z.array(internRowSchema).min(1).max(200),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid intern list", errors: parsed.error.flatten() });
  }

  const invite = await getInviteByRawToken(req.params.token);
  if (!invite) return res.status(404).json({ message: "Invalid invite link" });
  if ((await refreshInviteStatus(invite)) !== "ACTIVE") {
    return res.status(410).json({ message: "Invite not active" });
  }

  const profile = await prisma.collegeProfile.findUnique({ where: { userId: req.user!.id } });
  if (!profile || profile.collegeId !== invite.collegeId) {
    return res.status(403).json({ message: "This invite is for a different college" });
  }
  if (invite.boundUserId && invite.boundUserId !== req.user!.id) {
    return res.status(403).json({ message: "This invite is bound to another college account" });
  }

  // One-time: never allow a second submission on the same link
  if (invite.status === "USED" || invite.usedCount > 0) {
    return res.status(409).json({
      message: "This invite link was already used. Ask Admin/HR to generate a new link.",
    });
  }

  const pendingCount = await prisma.internProfile.count({
    where: { inviteId: invite.id, approvalStatus: "PENDING" },
  });
  if (pendingCount > 0) {
    return res.status(409).json({
      message: "This invite link was already used and is waiting for approval.",
    });
  }

  const batch = parsed.data.interns;
  if (invite.maxRegistrations != null && batch.length > invite.maxRegistrations) {
    return res.status(400).json({
      message: `This link allows at most ${invite.maxRegistrations} intern(s) in one submission (got ${batch.length}).`,
    });
  }

  const emails = batch.map((i) => i.email.toLowerCase().trim());
  if (new Set(emails).size !== emails.length) {
    return res.status(400).json({ message: "Duplicate emails in the submission list" });
  }
  const existing = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });
  if (existing.length) {
    return res.status(409).json({
      message: "Some emails already registered",
      emails: existing.map((e) => e.email),
    });
  }

  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

  // Race-safe: claim the invite atomically (only one concurrent submit wins)
  const claimed = await prisma.registrationInvite.updateMany({
    where: { id: invite.id, status: "ACTIVE", usedCount: 0 },
    data: { status: "USED", usedCount: batch.length },
  });
  if (claimed.count !== 1) {
    return res.status(409).json({
      message: "This invite link was already used. Ask Admin/HR to generate a new link.",
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const row of batch) {
        const passwordHash = await hashPassword(row.password);
        const user = await tx.user.create({
          data: {
            email: row.email.toLowerCase().trim(),
            fullName: row.fullName.trim(),
            passwordHash,
            role: "INTERN",
            isActive: false,
          },
        });
        await tx.internProfile.create({
          data: {
            userId: user.id,
            phone: row.phone.trim(),
            address: row.address.trim(),
            collegeId: invite.collegeId,
            approvalStatus: "PENDING",
            inviteId: invite.id,
            registeredById: req.user!.id,
            expiresAt,
          },
        });
      }
    });
  } catch (e) {
    // Roll invite back if user creation failed after claim
    await prisma.registrationInvite.update({
      where: { id: invite.id },
      data: { status: "ACTIVE", usedCount: 0 },
    });
    throw e;
  }

  res.status(201).json({
    submitted: batch.length,
    message:
      "Submitted for Admin/HR approval. This invite link is now used (one-time) and cannot be submitted again.",
    group: invite.group,
  });
});

/** College teacher: status of their invite submissions */
router.get("/my-submissions", requireAuth, requireRole("COLLEGE"), async (req, res) => {
  await cleanupExpiredPendingInterns();

  const submitted = await prisma.internProfile.findMany({
    where: { registeredById: req.user!.id, inviteId: { not: null } },
    include: {
      user: { select: { fullName: true, email: true, isActive: true } },
      invite: {
        include: {
          group: { select: { id: true, name: true } },
          college: { select: { name: true } },
        },
      },
    },
    orderBy: { joinedAt: "desc" },
  });

  const byInvite = new Map<
    string,
    {
      inviteId: string;
      status: string;
      group: { id: string; name: string } | null;
      college: { name: string } | null;
      submittedAt: Date;
      totalSubmitted: number;
      interns: typeof submitted;
    }
  >();

  for (const row of submitted) {
    const inviteId = row.inviteId!;
    let bucket = byInvite.get(inviteId);
    if (!bucket) {
      bucket = {
        inviteId,
        status: row.invite?.status || "USED",
        group: row.invite?.group || null,
        college: row.invite?.college || null,
        submittedAt: row.joinedAt,
        totalSubmitted: row.invite?.usedCount ?? 0,
        interns: [],
      };
      byInvite.set(inviteId, bucket);
    }
    bucket.interns.push(row);
  }

  const batches = [...byInvite.values()].map((inv) => {
    const pending = inv.interns.filter((i) => i.approvalStatus === "PENDING");
    const approved = inv.interns.filter((i) => i.approvalStatus === "APPROVED");
    return {
      inviteId: inv.inviteId,
      status: inv.status,
      group: inv.group,
      college: inv.college,
      submittedAt: inv.submittedAt,
      totalSubmitted: inv.totalSubmitted || inv.interns.length,
      pendingCount: pending.length,
      approvedCount: approved.length,
      rejectedOrRemoved: Math.max(0, (inv.totalSubmitted || inv.interns.length) - inv.interns.length),
      interns: inv.interns.map((i) => ({
        id: i.id,
        fullName: i.user.fullName,
        email: i.user.email,
        approvalStatus: i.approvalStatus,
        expiresAt: i.expiresAt,
      })),
    };
  });

  res.json({ batches });
});

export default router;
