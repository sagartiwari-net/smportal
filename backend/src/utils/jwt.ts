import jwt from "jsonwebtoken";
import type { Role } from "../generated/prisma/client";
import { env } from "../config/env";

export type JwtPayload = {
  userId: string;
  role: Role;
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
