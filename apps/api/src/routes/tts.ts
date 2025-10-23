import { Router } from "express";

export default function ttsRoutes() {
    const router = Router();

    router.post("/eleven", async (req, res, next) => {
        try {
            const { text, voiceId, modelId, voice_settings } = (req.body ?? {}) as {
                text?: string;
                voiceId?: string;
                modelId?: string;
                voice_settings?: {
                    stability?: number;
                    similarity_boost?: number;
                    style?: number;
                    use_speaker_boost?: boolean;
                };
            };
            if (!text || !text.trim()) return res.status(400).json({ error: "Missing text" });

            const apiKey = process.env.ELEVEN_API_KEY;
            if (!apiKey) return res.status(500).json({ error: "Missing ELEVEN_API_KEY" });

            const vid = voiceId || process.env.ELEVEN_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel
            const model = modelId || process.env.ELEVEN_MODEL || "eleven_multilingual_v2";

            const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}?optimize_streaming_latency=2&output_format=mp3_44100_128`;

            const r = await fetch(url, {
                method: "POST",
                headers: {
                    "xi-api-key": apiKey,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg",
                },
                body: JSON.stringify({
                    text,
                    model_id: model,
                    voice_settings,
                }),
            });

            if (!r.ok || !r.body) {
                let details = "";
                try { details = await r.text(); } catch {}
                return res.status(502).json({
                    error: "ElevenLabs error",
                    upstreamStatus: r.status,
                    upstreamStatusText: r.statusText,
                    details,
                });
            }

            // Convert response to buffer
            const arrayBuffer = await r.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "no-store");
            res.send(buffer);
        } catch (e) {
            next(e);
        }
    });

    return router;
}