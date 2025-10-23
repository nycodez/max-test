import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { MongoClient } from "mongodb";
import aiRoutes from "./routes/ai";

// ---- TEMP DEV CONTEXT (no auth) ----
const DEV_CTX = {
    tenantId: "tenant-A",
    user: { id: "dev-user", role: "admin", caps: ["*"] },
};
// ------------------------------------

const PORT = process.env.PORT || 8080;
const DB = process.env.MONGO_DB || "crm";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";

const ajv = new Ajv({ allErrors: true }); addFormats(ajv);
// super-minimal schema so we can post a model
const validateModel = ajv.compile({
    type: "object",
    required: ["name", "collection", "fields"],
    properties: {
        name: { type: "string" },
        collection: { type: "string" },
        fields: { type: "array" },
        version: { type: "number" },
        active: { type: "boolean" }
    },
    additionalProperties: true
});

let client: MongoClient;
async function getClient() {
    if (!client) client = new MongoClient(MONGO_URI);
    if (!client.topology?.isConnected()) await client.connect();
    return client;
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Debug endpoint BEFORE anything else
app.get("/__debug/headers-open", (req, res) => res.json(req.headers));

// Inject dev ctx (no auth)
app.use((req, _res, next) => {
    const forced = (req.header('x-tenant-id') || 'tenant-A').trim();
    (req as any).ctx = { tenantId: forced, user: { id: 'dev-user', role: 'admin', caps: ['*'] } };
    next();
});

// ---- DESIGN: models ----
app.post("/design/models", async (req, res, next) => {
    try {
        const ctx = (req as any).ctx;
        const c = (await getClient()).db(DB).collection("models");

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
        await c.insertOne(doc);
        const events = (await getClient()).db(DB).collection('event_store');
        await events.insertOne({
            tenantId: ctx.tenantId,
            type: 'record.created',
            model: req.params.model || 'ModelDef',
            actor: ctx.user.id,
            after: doc,                // the inserted doc
            ts: new Date().toISOString(),
        });
        res.status(201).json({ ok: true });
    } catch (e) { next(e); }
});

app.get("/design/models/:name", async (req, res, next) => {
    try {
        const ctx = (req as any).ctx;
        const c = (await getClient()).db(DB).collection("models");
        const out = await c.findOne({ tenantId: ctx.tenantId, name: req.params.name, active: true });
        if (!out) return res.status(404).end();
        res.json(out);
    } catch (e) { next(e); }
});

// ---- DATA: create + query (uses model.collection) ----
app.post("/data/:model/create", async (req, res, next) => {
    try {
        const ctx = (req as any).ctx;
        const db = (await getClient()).db(DB);
        const models = db.collection("models");
        const def = await models.findOne({ tenantId: ctx.tenantId, name: req.params.model, active: true });
        if (!def) return res.status(404).send("Model not found");

        const col = db.collection(def.collection);
        const now = new Date().toISOString();
        const doc = {
            ...req.body,
            tenantId: ctx.tenantId,
            createdAt: now,
            updatedAt: now,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
        };
        const missing = (def.fields || [])
            .filter(f => f.required)
            .map(f => f.name)
            .filter(name => !(name in req.body));

        if (missing.length) return res.status(422).json({ error: "Missing required fields", fields: missing });
        await col.insertOne(doc);
        const events = (await getClient()).db(DB).collection('event_store');
        await events.insertOne({
            tenantId: ctx.tenantId,
            type: 'record.created',
            model: req.params.model || 'ModelDef',
            actor: ctx.user.id,
            after: doc,                // the inserted doc
            ts: new Date().toISOString(),
        });
        res.status(201).json({ ok: true });
    } catch (e) { next(e); }
});

app.post("/data/:model/query", async (req, res, next) => {
    try {
        const ctx = (req as any).ctx;
        const dbx = (await getClient()).db(DB);
        const models = dbx.collection("models");
        const def = await models.findOne({ tenantId: ctx.tenantId, name: req.params.model, active: true });
        if (!def) return res.status(404).send("Model not found");

        const col = dbx.collection(def.collection);
        const filter = req.body?.filter || {};
        const rows = await col.find({ tenantId: ctx.tenantId, ...filter }).limit(100).toArray();
        res.json({ rows });
    } catch (e) { next(e); }
});

app.get('/__health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/__meta/models', async (req, res) => {
    const ctx = (req as any).ctx;
    const c = (await getClient()).db(DB).collection('models');
    res.json(await c.find({ tenantId: ctx.tenantId }).project({ fields: 0 }).toArray());
});

app.get('/runtime/bootstrap', async (req, res) => {
    const ctx = (req as any).ctx;
    const dbx = (await getClient()).db(DB);
    const [models, forms, actions, components] = await Promise.all([
        dbx.collection('models').find({ tenantId: ctx.tenantId, active: true }).toArray(),
        dbx.collection('forms').find({ tenantId: ctx.tenantId, active: true }).toArray(),
        dbx.collection('actions').find({ tenantId: ctx.tenantId, active: true }).toArray(),
        dbx.collection('components').find({ tenantId: ctx.tenantId, active: true }).toArray(),
    ]);
    const versionHash = require('crypto').createHash('sha1')
        .update(JSON.stringify([models, forms, actions, components]))
        .digest('hex');
    res.set('ETag', versionHash).json({ versionHash, models, forms, actions, components });
});

app.use("/ai", aiRoutes(getClient, DB));

app.listen(PORT, () => console.log(`API (no-auth) on :${PORT}`));

// Error handler (show stack in dev)
app.use((err: any, _req: any, res: any, _next: any) => {
    console.error(err);
    res.status(400).json({ error: err.message || "Bad Request" });
});
