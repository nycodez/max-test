// packages/auth/src/index.ts
import jwt from "jsonwebtoken";

export interface UserCtx { id: string; role?: string; caps?: string[] }
export interface ReqCtx { tenantId: string; user: UserCtx }

export interface GetReqCtxOptions {
    jwtSecret?: string;
    allowDevAuth?: boolean;
    devTenantId?: string;
    devUserId?: string;
    devRole?: string;
    devCaps?: string[];
}

type TokenPayload = jwt.JwtPayload & {
    tid?: string;
    sub?: string;
    role?: string;
    caps?: string[];
};

function buildDevCtx(options: GetReqCtxOptions): ReqCtx {
    return {
        tenantId: options.devTenantId ?? "demo-tenant",
        user: {
            id: options.devUserId ?? "demo-user",
            role: options.devRole ?? "admin",
            caps: options.devCaps ?? ["*"],
        },
    };
}

export function getReqCtx(authHeader?: string, options: GetReqCtxOptions = {}): ReqCtx {
    const rawHeader = typeof authHeader === "string" ? authHeader.trim() : "";
    const match = rawHeader.match(/^Bearer\s+(.+)$/i);
    const rawToken = (match ? match[1] : rawHeader).trim();

    if (!rawToken) {
        if (options.allowDevAuth) return buildDevCtx(options);
        throw new Error("Missing Authorization");
    }

    if (options.allowDevAuth && rawToken === "dev") {
        return buildDevCtx(options);
    }

    if (!options.jwtSecret) {
        throw new Error("JWT_SECRET is not configured");
    }

    const payload = jwt.verify(rawToken, options.jwtSecret) as TokenPayload;
    if (!payload.tid || !payload.sub) {
        throw new Error("Invalid token");
    }

    return {
        tenantId: payload.tid,
        user: {
            id: payload.sub,
            role: payload.role,
            caps: payload.caps ?? [],
        },
    };
}
