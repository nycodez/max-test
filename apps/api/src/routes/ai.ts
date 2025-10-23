import { Router } from "express";
import { MongoClient, ObjectId } from "mongodb";
import { getGemini } from "../vertex";

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

    router.post("/chat", async (req, res, next) => {
        try {
            const { text, sessionId } = (req.body ?? {}) as { text?: string; sessionId?: string };
            if (!text) return res.status(400).json({ error: "Missing text" });

            // Phase-1: no-auth → dev ctx
            const ctx = (req as any).ctx || { tenantId: "tenant-A", user: { id: "dev-user" } };
            const db = (await getClient()).db(dbName);
            const sessions = db.collection<SessionDoc>("ai_sessions");

            const now = new Date().toISOString();
            const sid = sessionId || "default";
            const baseQuery = { tenantId: ctx.tenantId, userId: ctx.user.id, sessionId: sid };

            // --- STEP 1: Ensure session document exists (create once) ---
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
                                    "You are Max: a concise, witty, on-screen AI operator for a programmable CRM. " +
                                    "Keep answers short and actionable. If a visual helps (chart/image/video), append a final line " +
                                    'starting with VISUAL: then a JSON payload, e.g. VISUAL:{"type":"image","url":"https://..."}',
                                ts: now,
                            },
                        ],
                        createdAt: now,
                        updatedAt: now,
                    },
                },
                { upsert: true }
            );

            // --- STEP 2: Append user message and fetch updated conversation ---
            const result = await sessions.findOneAndUpdate(
                baseQuery,
                {
                    $push: { messages: { role: "user", text, ts: now } },
                    $set: { updatedAt: now },
                },
                { returnDocument: "after" as any, upsert: false }
            );

            // Handle both return shapes (driver may return doc directly or wrapped in { value })
            const convo: SessionDoc | null = (result as any)?.value ?? (result as any) ?? null;

            // Fallback: load manually if needed
            const activeConvo = convo || (await sessions.findOne(baseQuery));
            if (!activeConvo) throw new Error("Failed to load AI session after upsert");

            // Trim to last N messages for context
            const history = (activeConvo.messages ?? []).slice(-16);

            // --- STEP 3: Call Gemini with conversation history ---
            const contents = history.map((m) => ({
                role: m.role === "model" ? "model" : "user", // Vertex expects "user" | "model"
                parts: [{ text: m.text }],
            }));

            const model = getGemini();
            const resultGen = await model.generateContent({ contents });

            const replyText =
                resultGen.response?.candidates?.[0]?.content?.parts
                    ?.map((p: any) => p.text ?? "")
                    .join("")
                    .trim() || "Okay.";

            // --- STEP 4: Append model reply ---
            const ms = new Date().toISOString();
            await sessions.updateOne(baseQuery, {
                $push: { messages: { role: "model", text: replyText, ts: ms } },
                $set: { updatedAt: ms },
            });

            // --- STEP 5: Parse optional VISUAL directive ---
            let cleanReply = replyText;
            let visual: any = null;
            const idx = replyText.lastIndexOf("VISUAL:");
            if (idx >= 0) {
                const after = replyText.slice(idx + 7).trim();
                cleanReply = replyText.slice(0, idx).trim();
                const jsonMatch = after.match(/\{[\s\S]*\}$/);
                if (jsonMatch) {
                    try {
                        visual = JSON.parse(jsonMatch[0]);
                    } catch {
                        /* ignore parse errors */
                    }
                }
            }

            // --- STEP 6: Respond to client ---
            res.json({ replyText: cleanReply, visual });
        } catch (e) {
            next(e);
        }
    });

    return router;
}
