import { Router } from "express";
import { MongoClient, ObjectId } from "mongodb";
import { getGemini } from "../vertex";
import {generateImage} from "../vertexImage";

const router = Router();

type Msg = { role: "user" | "model" | "system"; text: string; ts: string };
type SessionDoc = {
    _id?: ObjectId;
    tenantId: string;
    userId: string;
    sessionId: string;         // e.g. persisted in localStorage on the UI
    messages: Msg[];
    createdAt: string;
    updatedAt: string;
};

const SYSTEM_PROMPT =
    "You are Max: a witty on-screen AI operator. If you can respond to the user's request in text than do so briefly." +
    "If media is asked for, then you can help to search youtube." +
    "You can also automatically create data models and documents when requested by the user.\n" +
    "Return visuals ONLY via a single line that starts with 'VISUAL:' followed by strict JSON.\n" +
    "- Image:   VISUAL:{\"type\":\"image\",\"prompt\":\"...\"}\n" +
    "- YouTube: VISUAL:{\"type\":\"youtube\",\"search\":\"...\"}\n" +
    "- Video:   VISUAL:{\"type\":\"video\",\"url\":\"https://...\"}\n" +
    "Return actions ONLY via a single line that starts with 'ACTION:' followed by strict JSON.\n" +
    "- Create Model: ACTION:{\"type\":\"create_model\",\"name\":\"...\",\"collection\":\"...\",\"fields\":[{\"name\":\"...\",\"type\":\"string\",\"required\":true}]}\n" +
    "- Create Document: ACTION:{\"type\":\"create_document\",\"model\":\"...\",\"data\":{\"field\":\"value\"}}\n" +
    "Do not include code fences. Never embed base64 yourself.";

function getSessionTitle(messages: Msg[]): string {
    const firstUser = messages.find((msg) => msg.role === "user" && msg.text?.trim());
    if (!firstUser) return "Untitled Chat";
    const trimmed = firstUser.text.trim().replace(/\s+/g, " ");
    return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed;
}

function writeSse(res: any, event: string, payload: unknown): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export default function aiRoutes(getClient: () => Promise<MongoClient>, dbName: string) {
    // apps/api/src/routes/ai.ts (temporarily)
    router.get("/ping", async (_req, res, next) => {
        try {
            const model = getGemini();  // ← was gemini()
            const r = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: "ping" }] }],
            });
            const text = r.response?.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("").trim() || null;
            res.json({ ok: true, text });
        } catch (e) { next(e); }
    });

    router.get("/threads", async (req, res, next) => {
        try {
            const ctx = (req as any).ctx || { tenantId: "tenant-A", user: { id: "dev-user" } };
            const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 20)));
            const offset = Math.max(0, Number(req.query.offset ?? 0));

            const db = (await getClient()).db(dbName);
            const sessions = db.collection<SessionDoc>("ai_sessions");

            const rows = await sessions
                .find({ tenantId: ctx.tenantId, userId: ctx.user.id })
                .sort({ updatedAt: -1 })
                .skip(offset)
                .limit(limit)
                .toArray();

            const threads = rows.map((session) => ({
                id: session.sessionId,
                title: getSessionTitle(session.messages || []),
                updatedAt: session.updatedAt,
            }));

            res.json({ threads });
        } catch (e) {
            next(e);
        }
    });

    router.get("/threads/:threadId/messages", async (req, res, next) => {
        try {
            const ctx = (req as any).ctx || { tenantId: "tenant-A", user: { id: "dev-user" } };
            const threadId = String(req.params.threadId || "").trim();
            if (!threadId) return res.status(400).json({ error: "Missing threadId" });

            const db = (await getClient()).db(dbName);
            const sessions = db.collection<SessionDoc>("ai_sessions");
            const row = await sessions.findOne({
                tenantId: ctx.tenantId,
                userId: ctx.user.id,
                sessionId: threadId,
            });

            if (!row) return res.json({ messages: [] });

            const messages = (row.messages || [])
                .filter((msg) => msg.role === "user" || msg.role === "model")
                .map((msg, index) => ({
                    id: `${threadId}-${index + 1}`,
                    role: msg.role === "model" ? "agent" : "user",
                    content: msg.text,
                    createdAt: msg.ts,
                }));

            res.json({ messages });
        } catch (e) {
            next(e);
        }
    });

    router.delete("/threads/:threadId", async (req, res, next) => {
        try {
            const ctx = (req as any).ctx || { tenantId: "tenant-A", user: { id: "dev-user" } };
            const threadId = String(req.params.threadId || "").trim();
            if (!threadId) return res.status(400).json({ error: "Missing threadId" });

            const db = (await getClient()).db(dbName);
            const sessions = db.collection<SessionDoc>("ai_sessions");
            await sessions.deleteOne({
                tenantId: ctx.tenantId,
                userId: ctx.user.id,
                sessionId: threadId,
            });

            res.json({ success: true });
        } catch (e) {
            next(e);
        }
    });

    router.post("/chat/stream", async (req, res, next) => {
        try {
            const { text, threadId } = req.body || {};
            if (!text || !String(text).trim()) {
                return res.status(400).json({ error: "Missing text" });
            }

            const ctx = (req as any).ctx || { tenantId: "tenant-A", user: { id: "dev-user" } };
            const db = (await getClient()).db(dbName);
            const sessions = db.collection<SessionDoc>("ai_sessions");

            const now = new Date().toISOString();
            const sid = String(threadId || "").trim() || new ObjectId().toHexString();
            const baseQuery = { tenantId: ctx.tenantId, userId: ctx.user.id, sessionId: sid };

            await sessions.updateOne(
                baseQuery,
                {
                    $setOnInsert: {
                        tenantId: ctx.tenantId,
                        userId: ctx.user.id,
                        sessionId: sid,
                        messages: [
                            {
                                role: "system",
                                text: SYSTEM_PROMPT,
                                ts: now,
                            },
                        ],
                        createdAt: now,
                        updatedAt: now,
                    },
                },
                { upsert: true }
            );

            const afterUser = await sessions.findOneAndUpdate(
                baseQuery,
                {
                    $push: { messages: { role: "user", text: String(text), ts: now } },
                    $set: { updatedAt: now },
                },
                { returnDocument: "after" as any }
            );

            const convo: SessionDoc | null = afterUser ?? null;
            if (!convo) return res.status(500).json({ error: "Failed to load session" });

            const title = getSessionTitle(convo.messages || []);
            const history = (convo.messages || []).slice(-16);
            const contents = history.map((m) => ({
                role: m.role === "model" ? "model" : "user",
                parts: [{ text: m.text }],
            }));

            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders?.();

            writeSse(res, "meta", { threadId: sid, threadTitle: title });

            const model = getGemini();
            const streamResult = await model.generateContentStream({ contents });

            let fullText = "";
            for await (const item of streamResult.stream) {
                const delta = (item?.candidates?.[0]?.content?.parts ?? [])
                    .map((part: any) => part?.text ?? "")
                    .join("");

                if (!delta) continue;

                fullText += delta;
                writeSse(res, "delta", {
                    threadId: sid,
                    threadTitle: title,
                    delta,
                    text: fullText,
                });
            }

            if (!fullText.trim()) {
                const finalResponse = await streamResult.response;
                fullText = (finalResponse?.candidates?.[0]?.content?.parts ?? [])
                    .map((part: any) => part?.text ?? "")
                    .join("")
                    .trim();
            }

            const finalText = fullText.trim() || "Okay.";
            const ts = new Date().toISOString();
            await sessions.updateOne(baseQuery, {
                $push: { messages: { role: "model", text: finalText, ts } },
                $set: { updatedAt: ts },
            });

            writeSse(res, "done", {
                threadId: sid,
                threadTitle: title,
                text: finalText,
            });
            res.end();
        } catch (e: any) {
            try {
                writeSse(res, "error", { message: e?.message || "Streaming failed" });
                res.end();
            } catch {
                next(e);
            }
        }
    });

    router.post("/chat", async (req, res, next) => {
        try {
            const { text, sessionId, threadId } = req.body || {};
            if (!text) return res.status(400).json({ error: "Missing text" });

            const ctx = (req as any).ctx || { tenantId: "tenant-A", user: { id: "dev-user" } };
            const db = (await getClient()).db(dbName);
            const sessions = db.collection<SessionDoc>("ai_sessions");

            const now = new Date().toISOString();
            const sid = String(threadId || sessionId || "").trim() || new ObjectId().toHexString();
            const baseQuery = { tenantId: ctx.tenantId, userId: ctx.user.id, sessionId: sid };

            // 1) Ensure session exists
            await sessions.updateOne(
                baseQuery,
                {
                    $setOnInsert: {
                        tenantId: ctx.tenantId,
                        userId: ctx.user.id,
                        sessionId: sid,
                        messages: [
                            {
                                role: "system",
                                text:
                                    "You are Max: a witty on-screen AI operator. If you can respond to the user's request in text than do so briefly." +
                                    "If media is asked for, then you can help to search youtube." +
                                    "You can also automatically create data models and documents when requested by the user.\n" +
                                    "Return visuals ONLY via a single line that starts with 'VISUAL:' followed by strict JSON.\n" +
                                    "- Image:   VISUAL:{\"type\":\"image\",\"prompt\":\"...\"}\n" +
                                    "- YouTube: VISUAL:{\"type\":\"youtube\",\"search\":\"...\"}\n" +
                                    "- Video:   VISUAL:{\"type\":\"video\",\"url\":\"https://...\"}\n" +
                                    "Return actions ONLY via a single line that starts with 'ACTION:' followed by strict JSON.\n" +
                                    "- Create Model: ACTION:{\"type\":\"create_model\",\"name\":\"...\",\"collection\":\"...\",\"fields\":[{\"name\":\"...\",\"type\":\"string\",\"required\":true}]}\n" +
                                    "- Create Document: ACTION:{\"type\":\"create_document\",\"model\":\"...\",\"data\":{\"field\":\"value\"}}\n" +
                                    "Do not include code fences. Never embed base64 yourself.",
                                ts: now,
                            },
                        ],
                        createdAt: now,
                        updatedAt: now,
                    },
                },
                { upsert: true }
            );

            // 2) Append user and fetch updated convo
            const afterUser = await sessions.findOneAndUpdate(
                baseQuery,
                { $push: { messages: { role: "user", text, ts: now } }, $set: { updatedAt: now } },
                { returnDocument: "after" as any }
            );

            const convo: SessionDoc | null = afterUser ?? null;
            if (!convo) return res.status(500).json({ error: "Failed to load session" });

            const history = (convo.messages ?? []).slice(-16);

            // 3) Build Gemini contents from history (no double-append)
            const contents = history.map((m) => ({
                role: m.role === "model" ? "model" : "user",
                parts: [{ text: m.text }],
            }));

            const model = getGemini();
            const result = await model.generateContent({ contents });

            const rawReply =
                (result.response?.candidates?.[0]?.content?.parts ?? [])
                    .map((p: any) => p.text ?? "")
                    .join("")
                    .trim() || "Okay.";

            // ---------- helpers ----------
            function parseYouTubeIdFromUrl(u: string): string | null {
                try {
                    const url = new URL(u);
                    console.log('url', url.toString());
                    const host = url.hostname.replace(/^www\./, "");
                    if (host === "youtu.be") {
                        const m = url.pathname.match(/^\/([^/?#]+)/);
                        return m ? m[1] : null;
                    }
                    if (host.endsWith("youtube.com")) {
                        const v = url.searchParams.get("v");
                        console.log('v')
                        if (v) return v;
                        let m = url.pathname.match(/\/embed\/([^/?#]+)/);
                        if (m) {
                            console.log('m[1]', m[1]);
                            return m[1];
                        }
                        m = url.pathname.match(/\/shorts\/([^/?#]+)/);
                        if (m) {
                            console.log('m[1]', m[1]);
                            return m[1];
                        }
                    }
                } catch {}
                return null;
            }

            // Scrape YT links (markdown + bare) and strip them from text
            function extractYouTubeFromText(raw: string): { cleaned: string; ids: string[] } {
                let text = raw;
                const ids: string[] = [];

                // [label](url)
                const mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
                text = text.replace(mdLinkRe, (_full, _label, url) => {
                    const id = parseYouTubeIdFromUrl(url);
                    if (id) ids.push(id);
                    return ""; // remove whole markdown link
                });

                // bare URLs
                const urlRe = /(https?:\/\/[^\s)]+)/g;
                text = text.replace(urlRe, (url) => {
                    const id = parseYouTubeIdFromUrl(url);
                    if (id) { ids.push(id); return ""; }
                    return url; // keep non-YouTube URLs
                });

                // tidy leftovers
                text = text
                    .replace(/\(\s*\)/g, "")
                    .replace(/\s{2,}/g, " ")
                    .replace(/\n{3,}/g, "\n\n")
                    .trim();

                return { cleaned: text, ids: Array.from(new Set(ids)) };
            }

            // tolerant VISUAL extractor (fallback)
            function extractVisual(raw: string) {
                const ix = raw.indexOf("VISUAL:");
                if (ix < 0) return { clean: raw.trim(), visual: null as any };
                const before = raw.slice(0, ix).trim();
                const a = raw
                    .slice(ix + 7)
                    .replace(/^[\s`]*\n?/, "")
                    .replace(/```json|```/g, "")
                    .trim();
                const m = a.match(/\{\s*[\s\S]*?\}/);
                if (!m) return { clean: before, visual: null as any };
                try { return { clean: before, visual: JSON.parse(m[0]) }; }
                catch { return { clean: before, visual: null as any }; }
            }

            // ACTION extractor for model/document creation
            function extractAction(raw: string) {
                const ix = raw.indexOf("ACTION:");
                if (ix < 0) return { clean: raw.trim(), action: null as any };
                const before = raw.slice(0, ix).trim();
                const a = raw
                    .slice(ix + 7)
                    .replace(/^[\s`]*\n?/, "")
                    .replace(/```json|```/g, "")
                    .trim();
                const m = a.match(/\{\s*[\s\S]*?\}/);
                if (!m) return { clean: before, action: null as any };
                try { return { clean: before, action: JSON.parse(m[0]) }; }
                catch { return { clean: before, action: null as any }; }
            }

            function normalizeVisual(v: any): any | null {
                if (!v || typeof v !== "object") return null;
                const t = String(v.type || "").toLowerCase().trim();
                if (t === "yt") v.type = "youtube"; else v.type = t;

                if (v.type === "image" && typeof v.prompt === "string" && v.prompt.trim()) {
                    return { type: "image", prompt: v.prompt.trim(), caption: v.caption ?? v.prompt.trim() };
                }
                if (v.type === "video" && typeof v.url === "string" && v.url.startsWith("http")) {
                    return { type: "video", url: v.url, caption: v.caption ?? "" };
                }
                if (v.type === "youtube") {
                    const id = v.id ?? (v.url ? parseYouTubeIdFromUrl(v.url) : null);
                    const search = v.search ?? v.query ?? v.q;
                    if (id) return { type: "youtube", id, caption: v.caption ?? "" };
                    if (typeof search === "string" && search.trim()) {
                        return { type: "youtube", search: search.trim(), caption: v.caption ?? search.trim() };
                    }
                }
                return null;
            }
            // ---------- end helpers ----------

            // A) First: scrape YouTube links out of the raw text so TTS won’t read them
            const yt = extractYouTubeFromText(rawReply);
            let cleanReply = yt.cleaned;
            let visual: any = yt.ids.length ? { type: "youtube", id: yt.ids[0], caption: "" } : null;

            // B) Optional fallback: handle explicit VISUAL:{...}
            if (!visual) {
                const { clean: c2, visual: v2 } = extractVisual(cleanReply);
                cleanReply = c2;
                visual = normalizeVisual(v2);
            }

            // C) Route visuals (image / youtube search / direct video)
            if (visual?.type === "image" && visual.prompt) {
                try {
                    const url = await generateImage(visual.prompt); // Imagen helper pinned to us-central1
                    visual = { type: "image", url, caption: visual.caption };
                } catch (err) {
                    console.error("Image generation failed:", err);
                    visual = null;
                }
            } else if (visual?.type === "youtube") {
                try {
                    if (visual.id) {
                        visual = { type: "youtube", id: visual.id, caption: visual.caption ?? "" };
                    } else if (visual.search) {
                        const { searchYouTube } = await import("../utils/youtubeSearch");
                        const vid = await searchYouTube(visual.search);
                        visual = vid ? { type: "youtube", id: vid, caption: visual.caption ?? visual.search } : null;
                    } else {
                        visual = null;
                    }
                } catch (err) {
                    console.error("YouTube search failed:", err);
                    visual = null;
                }
            } else if (visual?.type === "video" && visual.url) {
                visual = { type: "video", url: visual.url, caption: visual.caption ?? "" };
            }

            // D) Handle ACTION commands for model/document creation
            let actionResult: any = null;
            const { clean: cleanReplyAfterAction, action } = extractAction(cleanReply);
            cleanReply = cleanReplyAfterAction;

            if (action?.type === "create_model") {
                try {
                    const { name, collection, fields } = action;
                    if (name && collection && Array.isArray(fields)) {
                        const modelDoc = {
                            name,
                            collection,
                            fields,
                            tenantId: ctx.tenantId,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            createdBy: ctx.user.id,
                            updatedBy: ctx.user.id,
                            version: 1,
                            active: true,
                        };
                        
                        const models = (await getClient()).db(dbName).collection("models");
                        await models.insertOne(modelDoc);
                        
                        const events = (await getClient()).db(dbName).collection('event_store');
                        await events.insertOne({
                            tenantId: ctx.tenantId,
                            type: 'record.created',
                            model: 'ModelDef',
                            actor: ctx.user.id,
                            after: modelDoc,
                            ts: new Date().toISOString(),
                        });
                        
                        actionResult = { type: "model_created", name, collection };
                        cleanReply += ` ✓ Created model "${name}" with collection "${collection}".`;
                    }
                } catch (err) {
                    console.error("Model creation failed:", err);
                    cleanReply += " ❌ Failed to create model.";
                }
            } else if (action?.type === "create_document") {
                try {
                    const { model: modelName, data } = action;
                    if (modelName && data && typeof data === "object") {
                        const models = (await getClient()).db(dbName).collection("models");
                        const modelDef = await models.findOne({ tenantId: ctx.tenantId, name: modelName, active: true });
                        
                        if (modelDef) {
                            const col = (await getClient()).db(dbName).collection(modelDef.collection);
                            const doc = {
                                ...data,
                                tenantId: ctx.tenantId,
                                createdAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString(),
                                createdBy: ctx.user.id,
                                updatedBy: ctx.user.id,
                            };
                            
                            await col.insertOne(doc);
                            
                            const events = (await getClient()).db(dbName).collection('event_store');
                            await events.insertOne({
                                tenantId: ctx.tenantId,
                                type: 'record.created',
                                model: modelName,
                                actor: ctx.user.id,
                                after: doc,
                                ts: new Date().toISOString(),
                            });
                            
                            actionResult = { type: "document_created", model: modelName, data };
                            cleanReply += ` ✓ Created document in "${modelName}".`;
                        } else {
                            cleanReply += ` ❌ Model "${modelName}" not found.`;
                        }
                    }
                } catch (err) {
                    console.error("Document creation failed:", err);
                    cleanReply += " ❌ Failed to create document.";
                }
            }

            // 6) Save model reply
            const ms = new Date().toISOString();
            await sessions.updateOne(baseQuery, {
                $push: { messages: { role: "model", text: cleanReply, ts: ms } },
                $set: { updatedAt: ms },
            });

            const threadTitle = getSessionTitle(convo.messages ?? []);
            res.json({ replyText: cleanReply, threadId: sid, threadTitle, visual, action: actionResult });
        } catch (e) {
            next(e);
        }
    });

    return router;
}
