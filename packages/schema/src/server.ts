import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { getReqCtx } from "@crm/auth";
import { getClient, tcol, insertOne, findOne, findMany, updateOne } from "@crm/core-db";
import { ModelDefSchema } from "@crm/schema";

const PORT = process.env.PORT || 8080;
const DB = process.env.MONGO_DB || "crm";

const ajv = new Ajv({ allErrors: true, removeAdditional: false }); addFormats(ajv);
const validateModel = ajv.compile(ModelDefSchema);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// tenant context middleware
app.use((req, _res, next) => {
    try { (req as any).ctx = getReqCtx(req.headers.authorization as string); next(); }
    catch (e) { next(e); }
});

// —— Design API (Phase 1: models only to keep tight) ——
app.post("/design/models", async (req, res, next) => {
    try {
        const ctx = (req as any).ctx;
        const client = await getClient(process.env.MONGO_URI!);
        const col = tcol(DB, "models", ctx, client);

        const payload = req.body;
        if ("tenantId" in payload) return res.status(400).send("Do not provide tenantId");
        if (!validateModel(payload)) return res.status(422).json({ errors: validateModel.errors });

        const doc = { ...payload, active: true, version: (payload.version ?? 1) };
        await insertOne(col, ctx, doc);
        res.status(201).json({ ok: true });
    } catch (e) { next(e); }
});

app.get("/design/models/:name", async (req, res, next) => {
    try {
        const ctx = (req as any).ctx;
        const client = await getClient(process.env.MONGO_URI!);
        const col = tcol(DB, "models", ctx, client);
        const out = await findOne(col, ctx, { name: req.params.name, active: true });
        if (!out) return res.status(404).end();
        res.json(out);
    } catch (e) { next(e); }
});

// —— Data API (very small: create + query) ——
app.post("/data/:model/create", async (req, res, next) => {
    try {
        const ctx = (req as any).ctx;
        const client = await getClient(process.env.MONGO_URI!);
        const models = tcol(DB, "models", ctx, client);
        const def = await findOne(models, ctx, { name: req.params.model, active: true });
        if (!def) return res.status(404).send("Model not found");

        // naive required check Phase 1
        const missing = (def.fields || []).filter(f => f.required && !(f.name in req.body)).map(f => f.name);
        if (missing.length) return res.status(422).json({ error: "Missing required", fields: missing });

        const col = tcol(DB, def.collection, ctx, client);
        await insertOne(col, ctx, req.body);
        res.status(201).json({ ok: true });
    } catch (e) { next(e); }
});

app.post("/data/:model/query", async (req, res, next) => {
    try {
        const ctx = (req as any).ctx;
        const client = await getClient(process.env.MONGO_URI!);
        const models = tcol(DB, "models", ctx, client);
        const def = await findOne(models, ctx, { name: req.params.model, active: true });
        if (!def) return res.status(404).send("Model not found");
        const col = tcol(DB, def.collection, ctx, client);
        const rows = await findMany(col, ctx, req.body?.filter || {}, { limit: 100 });
        res.json({ rows });
    } catch (e) { next(e); }
});

app.use((err: any, _req: any, res: any, _next: any) => {
    console.error(err);
    res.status(400).json({ error: err.message || "Bad Request" });
});

app.listen(PORT, () => console.log(`API on :${PORT}`));
