// packages/auth/src/index.ts
import jwt from "jsonwebtoken";

export interface UserCtx { id: string; role?: string; caps?: string[] }
export interface ReqCtx { tenantId: string; user: UserCtx }

export function getReqCtx(authHeader?: string): ReqCtx {
    if (!authHeader || typeof authHeader !== "string") {
        throw new Error("Missing Authorization");
    }
    // Accept either "Bearer <token>" or just "<token>"
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    const raw = m ? m[1] : authHeader.trim();

    const payload = jwt.decode(raw) as any || {};
    if (!payload.tid || !payload.sub) throw new Error("Invalid token");

    return {
        tenantId: payload.tid,
        user: { id: payload.sub, role: payload.role, caps: payload.caps ?? [] },
    };
}
