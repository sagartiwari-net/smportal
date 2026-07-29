import type { Role } from "../generated/prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        email: string;
        fullName: string;
      };
    }
  }
}

export {};
