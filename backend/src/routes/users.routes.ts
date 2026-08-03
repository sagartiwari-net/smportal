import { Router } from "express";
import { z } from "zod";
import { Role } from "../generated/prisma/client";
import { prisma } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword } from "../utils/password";
import { getTrainerGroupIds } from "../services/trainerScope";

const router = Router();
router.use(requireAuth);

const MANAGE_ROLES = ["ADMIN", "HR"] as const;

function canCreateRole(actor: Role, target: Role): boolean {
  if (actor === "ADMIN") return true;
  if (actor === "HR") return target === "HR" || target === "TRAINER" || target === "INTERN" || target === "COLLEGE";
  return false;
}

function canModifyUser(actor: Role, target: Role): boolean {
  if (actor === "ADMIN") return true;
  if (actor === "HR") return target === "TRAINER" || target === "INTERN" || target === "COLLEGE" || target === "HR";
  return false;
}

function canDeleteUser(actor: Role, target: Role): boolean {
  if (actor === "ADMIN") return true;
  if (actor === "HR") return target === "TRAINER" || target === "INTERN" || target === "COLLEGE";
  return false;
}

router.get("/", requireRole("ADMIN", "HR", "TRAINER"), async (req, res) => {
  const role = req.query.role as string | undefined;
  if (req.user!.role === "HR" && role === "ADMIN") {
    return res.status(403).json({ message: "Forbidden" });
  }

  // Trainer: only interns in their assigned groups
  if (req.user!.role === "TRAINER") {
    const groupIds = await getTrainerGroupIds(req.user!.id);
    if (!groupIds.length) return res.json({ users: [] });
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: Role.INTERN,
        internProfile: {
          approvalStatus: "APPROVED",
          memberships: { some: { isActive: true, groupId: { in: groupIds } } },
        },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
        internProfile: { include: { college: true } },
        trainerProfile: true,
        collegeProfile: { include: { college: true } },
      },
      orderBy: { fullName: "asc" },
    });
    return res.json({ users });
  }

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(role && Object.values(Role).includes(role as Role)
        ? { role: role as Role }
        : req.user!.role === "HR"
          ? { role: { not: Role.ADMIN } }
          : {}),
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      createdAt: true,
      internProfile: { include: { college: true } },
      trainerProfile: true,
      collegeProfile: { include: { college: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ users });
});

router.post("/", requireRole(...MANAGE_ROLES), async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    fullName: z.string().min(2),
    password: z.string().min(6),
    role: z.enum(["ADMIN", "HR", "TRAINER", "INTERN", "COLLEGE"]),
    phone: z.string().optional(),
    collegeId: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  }

  const { email, fullName, password, role, phone, collegeId } = parsed.data;
  const actor = req.user!.role;

  if (!canCreateRole(actor, role as Role)) {
    return res.status(403).json({ message: "You cannot create this role" });
  }

  if ((role === "INTERN" || role === "COLLEGE") && !collegeId) {
    if (role === "COLLEGE") {
      return res.status(400).json({ message: "collegeId required for COLLEGE" });
    }
    // INTERN may be direct company hire without college
  }

  const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (exists) return res.status(409).json({ message: "Email already registered" });

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: email.toLowerCase().trim(),
        fullName: fullName.trim(),
        passwordHash,
        role: role as Role,
      },
    });

    if (role === "INTERN") {
      await tx.internProfile.create({
        data: {
          userId: created.id,
          phone: phone || null,
          collegeId: collegeId || null,
          approvalStatus: "APPROVED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
          isHired: !collegeId,
          hiredAt: !collegeId ? new Date() : null,
          hiredById: !collegeId ? req.user!.id : null,
          hireNote: !collegeId ? "Created without college (direct)" : null,
        },
      });
    } else if (role === "TRAINER") {
      await tx.trainerProfile.create({ data: { userId: created.id, phone: phone || null } });
    } else if (role === "COLLEGE") {
      await tx.collegeProfile.create({
        data: { userId: created.id, collegeId: collegeId!, phone: phone || null },
      });
    }

    return created;
  });

  res.status(201).json({
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
  });
});

router.patch("/:id", requireRole(...MANAGE_ROLES), async (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    collegeId: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });

  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { internProfile: true, trainerProfile: true, collegeProfile: true },
  });
  if (!target) return res.status(404).json({ message: "User not found" });

  if (!canModifyUser(req.user!.role, target.role)) {
    return res.status(403).json({ message: "You cannot edit this user" });
  }

  if (
    target.role === "INTERN" &&
    target.internProfile?.internshipStatus === "COMPLETED" &&
    req.user!.role !== "ADMIN" &&
    req.user!.role !== "HR"
  ) {
    return res.status(403).json({
      message: "Completed internship details can only be changed by Admin or HR",
    });
  }

  const data: { fullName?: string; email?: string; passwordHash?: string } = {};
  if (parsed.data.fullName) data.fullName = parsed.data.fullName.trim();
  if (parsed.data.email) data.email = parsed.data.email.toLowerCase().trim();
  if (parsed.data.password) data.passwordHash = await hashPassword(parsed.data.password);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data });

      if (target.role === "INTERN" && target.internProfile) {
        await tx.internProfile.update({
          where: { userId: target.id },
          data: {
            ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
            ...(parsed.data.address !== undefined ? { address: parsed.data.address } : {}),
            ...(parsed.data.collegeId !== undefined ? { collegeId: parsed.data.collegeId } : {}),
          },
        });
      }
      if (target.role === "TRAINER" && target.trainerProfile && parsed.data.phone !== undefined) {
        await tx.trainerProfile.update({
          where: { userId: target.id },
          data: { phone: parsed.data.phone },
        });
      }
      if (target.role === "COLLEGE" && target.collegeProfile) {
        await tx.collegeProfile.update({
          where: { userId: target.id },
          data: {
            ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
            ...(parsed.data.collegeId ? { collegeId: parsed.data.collegeId } : {}),
          },
        });
      }
    });
  } catch {
    return res.status(409).json({ message: "Email may already be in use" });
  }

  const user = await prisma.user.findUnique({
    where: { id: target.id },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      internProfile: { include: { college: true } },
      trainerProfile: true,
      collegeProfile: { include: { college: true } },
    },
  });

  res.json({ user });
});

router.delete("/:id", requireRole(...MANAGE_ROLES), async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ message: "User not found" });

  if (target.id === req.user!.id) {
    return res.status(400).json({ message: "You cannot delete your own account" });
  }

  if (!canDeleteUser(req.user!.role, target.role)) {
    return res.status(403).json({ message: "You cannot delete this user" });
  }

  // Soft delete — keeps history; login blocked via isActive
  await prisma.user.update({
    where: { id: target.id },
    data: { isActive: false },
  });

  res.json({ message: "User deleted" });
});

export default router;
