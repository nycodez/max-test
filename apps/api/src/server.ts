import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { createHash } from "crypto";
import { MongoClient } from "mongodb";
import { getReqCtx, type ReqCtx } from "@crm/auth";
import aiRoutes from "./routes/ai";
import crmRoutes from "./routes/crm";
import ttsRoutes from "./routes/tts";

function loadEnvironment(): void {
    const workspaceEnvPath = path.resolve(__dirname, "../../../.env");
    const apiEnvPath = path.resolve(__dirname, "../.env");

    if (fs.existsSync(workspaceEnvPath)) {
        dotenv.config({ path: workspaceEnvPath, quiet: true });
    }

    const apiOverrideEnabled = (() => {
        const raw = String(process.env.API_ENV_OVERRIDE ?? "").trim().toLowerCase();
        return ["1", "true", "yes", "on", "enabled"].includes(raw);
    })();

    if (apiOverrideEnabled && fs.existsSync(apiEnvPath)) {
        dotenv.config({ path: apiEnvPath, override: true, quiet: true });
    }
}

loadEnvironment();

type AuthedRequest = Request & { ctx: ReqCtx };

const PORT = process.env.PORT || 8080;
const DB = process.env.MONGO_DB || "crm";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const JWT_SECRET = process.env.JWT_SECRET;
const ALLOW_DEV_AUTH = process.env.ALLOW_DEV_AUTH === "true" || process.env.NODE_ENV !== "production";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validateModel = ajv.compile({
    type: "object",
    required: ["name", "collection", "fields"],
    properties: {
        name: { type: "string" },
        collection: { type: "string" },
        fields: { type: "array" },
        version: { type: "number" },
        active: { type: "boolean" },
    },
    additionalProperties: true,
});

let client: MongoClient;
let connectPromise: Promise<MongoClient> | null = null;

async function getClient(): Promise<MongoClient> {
    if (!client) client = new MongoClient(MONGO_URI);
    if (!connectPromise) {
        connectPromise = client.connect().then(() => client);
    }
    return connectPromise;
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.get("/__health", (_req, res) => {
    res.json({
        ok: true,
        time: new Date().toISOString(),
        authMode: ALLOW_DEV_AUTH ? "jwt-or-dev" : "jwt-only",
    });
});

app.use((req: Request, _res: Response, next: NextFunction) => {
    try {
        (req as AuthedRequest).ctx = getReqCtx(req.header("authorization") ?? undefined, {
            jwtSecret: JWT_SECRET,
            allowDevAuth: ALLOW_DEV_AUTH,
            devTenantId: process.env.DEV_TENANT_ID,
            devUserId: process.env.DEV_USER_ID,
            devRole: "admin",
            devCaps: ["*"],
        });
        next();
    } catch (error) {
        next(error);
    }
});

app.post("/design/models", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ctx = (req as AuthedRequest).ctx;
        const collection = (await getClient()).db(DB).collection("models");
        const payload = req.body || {};
        if (!validateModel(payload)) return res.status(422).json({ errors: validateModel.errors });

        const now = new Date().toISOString();
        const doc = {
            ...payload,
            tenantId: ctx.tenantId,
            createdAt: now,
            updatedAt: now,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
            version: payload.version ?? 1,
            active: payload.active ?? true,
        };

        await collection.insertOne(doc);
        await (await getClient()).db(DB).collection("event_store").insertOne({
            tenantId: ctx.tenantId,
            type: "record.created",
            model: "ModelDef",
            actor: ctx.user.id,
            after: doc,
            ts: now,
        });

        res.status(201).json({ ok: true });
    } catch (error) {
        next(error);
    }
});

app.get("/design/models/:name", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ctx = (req as AuthedRequest).ctx;
        const collection = (await getClient()).db(DB).collection("models");
        const out = await collection.findOne({ tenantId: ctx.tenantId, name: req.params.name, active: true });
        if (!out) return res.status(404).end();
        res.json(out);
    } catch (error) {
        next(error);
    }
});

app.post("/data/:model/create", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ctx = (req as AuthedRequest).ctx;
        const db = (await getClient()).db(DB);
        const models = db.collection("models");
        const def = await models.findOne<{ collection: string; fields?: Array<{ name: string; required?: boolean }> }>({
            tenantId: ctx.tenantId,
            name: req.params.model,
            active: true,
        });

        if (!def) return res.status(404).send("Model not found");

        const missing = (def.fields || [])
            .filter((field) => field.required)
            .map((field) => field.name)
            .filter((fieldName) => !(fieldName in (req.body || {})));

        if (missing.length) return res.status(422).json({ error: "Missing required fields", fields: missing });

        const now = new Date().toISOString();
        const doc = {
            ...(req.body || {}),
            tenantId: ctx.tenantId,
            createdAt: now,
            updatedAt: now,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
        };

        await db.collection(def.collection).insertOne(doc);
        await db.collection("event_store").insertOne({
            tenantId: ctx.tenantId,
            type: "record.created",
            model: req.params.model,
            actor: ctx.user.id,
            after: doc,
            ts: now,
        });

        res.status(201).json({ ok: true });
    } catch (error) {
        next(error);
    }
});

app.post("/data/:model/query", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ctx = (req as AuthedRequest).ctx;
        const db = (await getClient()).db(DB);
        const models = db.collection("models");
        const def = await models.findOne<{ collection: string }>({
            tenantId: ctx.tenantId,
            name: req.params.model,
            active: true,
        });

        if (!def) return res.status(404).send("Model not found");

        const filter = req.body?.filter || {};
        const rows = await db.collection(def.collection).find({ tenantId: ctx.tenantId, ...filter }).limit(100).toArray();
        res.json({ rows });
    } catch (error) {
        next(error);
    }
});

app.get("/__meta/models", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ctx = (req as AuthedRequest).ctx;
        const rows = await (await getClient())
            .db(DB)
            .collection("models")
            .find({ tenantId: ctx.tenantId })
            .project({ fields: 0 })
            .toArray();

        res.json(rows);
    } catch (error) {
        next(error);
    }
});

app.get("/runtime/bootstrap", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ctx = (req as AuthedRequest).ctx;
        const db = (await getClient()).db(DB);
        const [models, forms, actions, components] = await Promise.all([
            db.collection("models").find({ tenantId: ctx.tenantId, active: true }).toArray(),
            db.collection("forms").find({ tenantId: ctx.tenantId, active: true }).toArray(),
            db.collection("actions").find({ tenantId: ctx.tenantId, active: true }).toArray(),
            db.collection("components").find({ tenantId: ctx.tenantId, active: true }).toArray(),
        ]);

        const versionHash = createHash("sha1")
            .update(JSON.stringify([models, forms, actions, components]))
            .digest("hex");

        res.set("ETag", versionHash).json({
            versionHash,
            tenantId: ctx.tenantId,
            models,
            forms,
            actions,
            components,
            features: {
                crmOverview: true,
                typedAiActions: true,
                voice: true,
            },
        });
    } catch (error) {
        next(error);
    }
});

app.use("/crm", crmRoutes(getClient, DB));
app.use("/ai", aiRoutes(getClient, DB));
app.use("/tts", ttsRoutes());

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    const message = err instanceof Error ? err.message : "Bad Request";
    const status = message === "Missing Authorization" || message === "Invalid token" || message === "JWT_SECRET is not configured"
        ? 401
        : 400;

    res.status(status).json({ error: message });
});

const server = app.listen(PORT, () => console.log(`API on :${PORT}`));
function shutdown() {
    server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
