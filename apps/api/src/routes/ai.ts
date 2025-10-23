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
            const { text, sessionId } = req.body || {};
            if (!text) return res.status(400).json({ error: "Missing text" });

            const ctx = (req as any).ctx || { tenantId: "tenant-A", user: { id: "dev-user" } };
            const db = (await getClient()).db(dbName);
            const sessions = db.collection<SessionDoc>("ai_sessions");

            const now = new Date().toISOString();
            const sid = sessionId || "default";
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
                                    "Return visuals ONLY via a single line that starts with 'VISUAL:' followed by strict JSON.\n" +
                                    "- Image:   VISUAL:{\"type\":\"image\",\"prompt\":\"...\"}\n" +
                                    "- YouTube: VISUAL:{\"type\":\"youtube\",\"search\":\"...\"}\n" +
                                    "- Video:   VISUAL:{\"type\":\"video\",\"url\":\"https://...\"}\n" +
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

            // 6) Save model reply
            const ms = new Date().toISOString();
            await sessions.updateOne(baseQuery, {
                $push: { messages: { role: "model", text: cleanReply, ts: ms } },
                $set: { updatedAt: ms },
            });

            res.json({ replyText: cleanReply, visual });
        } catch (e) {
            next(e);
        }
    });

    return router;
}
