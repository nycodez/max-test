import { Router, type Request } from "express";
import { MongoClient } from "mongodb";
import type { ReqCtx } from "@crm/auth";
import {
    createCompany,
    createContact,
    createTask,
    ensureCrmIndexes,
    getOverview,
    listCompanies,
    listContacts,
    listTasks,
    type ContactStatus,
    type TaskPriority,
    type TaskStatus,
} from "../crm";

type AuthedRequest = Request & { ctx: ReqCtx };

function normalizeLimit(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(50, parsed));
}

function normalizeTaskStatus(value: unknown): TaskStatus | undefined {
    if (value === "open" || value === "in_progress" || value === "done") return value;
    return undefined;
}

function normalizeTaskPriority(value: unknown): TaskPriority | undefined {
    if (value === "low" || value === "medium" || value === "high") return value;
    return undefined;
}

function normalizeContactStatus(value: unknown): ContactStatus | undefined {
    if (value === "lead" || value === "active") return value;
    return undefined;
}

export default function crmRoutes(getClient: () => Promise<MongoClient>, dbName: string) {
    const router = Router();

    router.get("/overview", async (req, res, next) => {
        try {
            const ctx = (req as AuthedRequest).ctx;
            const db = (await getClient()).db(dbName);
            await ensureCrmIndexes(db);
            res.json(await getOverview(db, ctx));
        } catch (error) {
            next(error);
        }
    });

    router.get("/contacts", async (req, res, next) => {
        try {
            const ctx = (req as AuthedRequest).ctx;
            const db = (await getClient()).db(dbName);
            await ensureCrmIndexes(db);

            const rows = await listContacts(db, ctx, {
                query: typeof req.query.q === "string" ? req.query.q : undefined,
                limit: normalizeLimit(req.query.limit, 20),
            });

            res.json({ records: rows, total: rows.length });
        } catch (error) {
            next(error);
        }
    });

    router.post("/contacts", async (req, res, next) => {
        try {
            const ctx = (req as AuthedRequest).ctx;
            const name = String(req.body?.name || "").trim();
            if (!name) return res.status(422).json({ error: "name is required" });

            const db = (await getClient()).db(dbName);
            await ensureCrmIndexes(db);
            const record = await createContact(db, ctx, {
                name,
                email: typeof req.body?.email === "string" ? req.body.email : undefined,
                phone: typeof req.body?.phone === "string" ? req.body.phone : undefined,
                companyName: typeof req.body?.companyName === "string" ? req.body.companyName : undefined,
                status: normalizeContactStatus(req.body?.status),
                notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
            });

            res.status(201).json({ success: true, record });
        } catch (error) {
            next(error);
        }
    });

    router.get("/companies", async (req, res, next) => {
        try {
            const ctx = (req as AuthedRequest).ctx;
            const db = (await getClient()).db(dbName);
            await ensureCrmIndexes(db);

            const rows = await listCompanies(db, ctx, {
                query: typeof req.query.q === "string" ? req.query.q : undefined,
                limit: normalizeLimit(req.query.limit, 20),
            });

            res.json({ records: rows, total: rows.length });
        } catch (error) {
            next(error);
        }
    });

    router.post("/companies", async (req, res, next) => {
        try {
            const ctx = (req as AuthedRequest).ctx;
            const name = String(req.body?.name || "").trim();
            if (!name) return res.status(422).json({ error: "name is required" });

            const db = (await getClient()).db(dbName);
            await ensureCrmIndexes(db);
            const record = await createCompany(db, ctx, {
                name,
                website: typeof req.body?.website === "string" ? req.body.website : undefined,
                industry: typeof req.body?.industry === "string" ? req.body.industry : undefined,
                notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
            });

            res.status(201).json({ success: true, record });
        } catch (error) {
            next(error);
        }
    });

    router.get("/tasks", async (req, res, next) => {
        try {
            const ctx = (req as AuthedRequest).ctx;
            const db = (await getClient()).db(dbName);
            await ensureCrmIndexes(db);

            const rows = await listTasks(db, ctx, {
                status: normalizeTaskStatus(req.query.status),
                limit: normalizeLimit(req.query.limit, 20),
            });

            res.json({ records: rows, total: rows.length });
        } catch (error) {
            next(error);
        }
    });

    router.post("/tasks", async (req, res, next) => {
        try {
            const ctx = (req as AuthedRequest).ctx;
            const title = String(req.body?.title || "").trim();
            if (!title) return res.status(422).json({ error: "title is required" });

            const db = (await getClient()).db(dbName);
            await ensureCrmIndexes(db);
            const record = await createTask(db, ctx, {
                title,
                details: typeof req.body?.details === "string" ? req.body.details : undefined,
                dueDate: typeof req.body?.dueDate === "string" ? req.body.dueDate : undefined,
                status: normalizeTaskStatus(req.body?.status),
                priority: normalizeTaskPriority(req.body?.priority),
                contactName: typeof req.body?.contactName === "string" ? req.body.contactName : undefined,
                companyName: typeof req.body?.companyName === "string" ? req.body.companyName : undefined,
            });

            res.status(201).json({ success: true, record });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
