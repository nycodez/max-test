import { VertexAI } from "@google-cloud/vertexai";

type VertexStatus = {
    enabled: boolean;
    reason?: string;
};

let lastUnavailableReason: string | null = null;
let lastUnavailableAt = 0;
let warnedUnavailable = false;

function traceLogsEnabled(): boolean {
    const raw = String(process.env.AI_TRACE_LOGS ?? "true").trim().toLowerCase();
    return !["0", "false", "off", "no", "disabled"].includes(raw);
}

function traceVertex(traceId: string | undefined, stage: string, payload?: Record<string, unknown>): void {
    if (!traceLogsEnabled()) return;
    const prefix = traceId ? `[vertex][${traceId}]` : "[vertex]";
    const data = payload ? ` ${JSON.stringify(payload)}` : "";
    console.log(`${prefix} ${stage}${data}`);
}

function logUnavailable(reason: string) {
    if (warnedUnavailable && lastUnavailableReason === reason) return;
    warnedUnavailable = true;
    lastUnavailableReason = reason;
    lastUnavailableAt = Date.now();

    // Keep noisy auth/network warnings opt-in. Trace logs still capture detailed failures.
    if (envFlag("VERTEX_LOG_UNAVAILABLE", false)) {
        console.warn(`[vertex] disabled, falling back to heuristics: ${reason}`);
    }
}

function env(name: string, fallback?: string): string | undefined {
    const value = process.env[name] ?? fallback;
    return value?.trim() ? value : undefined;
}

function envFlag(name: string, fallback: boolean): boolean {
    const raw = env(name);
    if (!raw) return fallback;

    const normalized = raw.replace(/^['"]|['"]$/g, "").trim().toLowerCase();
    if (["false", "0", "off", "no", "disabled"].includes(normalized)) return false;
    if (["true", "1", "on", "yes", "enabled"].includes(normalized)) return true;
    return fallback;
}

function isVertexEnabled(): boolean {
    return envFlag("VERTEX_ENABLED", true);
}

function unavailableCooldownMs(): number {
    const parsed = Number(env("VERTEX_RETRY_COOLDOWN_MS", "15000"));
    if (!Number.isFinite(parsed)) return 15000;
    return Math.max(1000, parsed);
}

function inCooldownWindow(): boolean {
    if (!lastUnavailableReason || !lastUnavailableAt) return false;
    return Date.now() - lastUnavailableAt < unavailableCooldownMs();
}

function getVertexConfig(): VertexStatus & {
    project?: string;
    location?: string;
    modelName?: string;
} {
    if (!isVertexEnabled()) {
        return { enabled: false, reason: "VERTEX_ENABLED=false" };
    }

    const project = env("VERTEX_PROJECT");
    if (!project) {
        return { enabled: false, reason: "VERTEX_PROJECT is not set" };
    }

    return {
        enabled: true,
        project,
        location: env("VERTEX_LOCATION", "us-central1"),
        modelName: env("VERTEX_MODEL", "gemini-2.5-flash"),
    };
}

export function getVertexStatus(): VertexStatus {
    const config = getVertexConfig();
    if (!config.enabled) {
        return { enabled: false, reason: config.reason };
    }

    if (inCooldownWindow()) {
        return { enabled: false, reason: lastUnavailableReason ?? "Vertex temporarily unavailable" };
    }

    return { enabled: true };
}

export async function tryGenerateGeminiText(prompt: string, traceId?: string): Promise<string | null> {
    const config = getVertexConfig();
    if (!config.enabled || !config.project || !config.location || !config.modelName) {
        if (config.reason && config.reason !== "VERTEX_ENABLED=false") {
            logUnavailable(config.reason);
        }
        traceVertex(traceId, "skip.unavailable", { reason: config.reason ?? "invalid_config" });
        return null;
    }

    if (inCooldownWindow()) {
        traceVertex(traceId, "skip.cooldown", {
            reason: lastUnavailableReason ?? "cooldown",
            retryInMs: Math.max(0, unavailableCooldownMs() - (Date.now() - lastUnavailableAt)),
        });
        return null;
    }

    try {
        const startedAt = Date.now();
        traceVertex(traceId, "request.start", {
            project: config.project,
            location: config.location,
            model: config.modelName,
            promptChars: prompt.length,
        });
        const vertexAI = new VertexAI({ project: config.project, location: config.location });
        const model = vertexAI.getGenerativeModel({
            model: config.modelName,
            generationConfig: { maxOutputTokens: 1024, temperature: 0.6, topP: 0.9 },
        });

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        lastUnavailableReason = null;
        lastUnavailableAt = 0;
        warnedUnavailable = false;
        const text = result.response?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() || null;
        traceVertex(traceId, "request.success", {
            outputChars: text?.length ?? 0,
            durationMs: Date.now() - startedAt,
        });
        return text;
    } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown Vertex error";
        logUnavailable(reason);
        traceVertex(traceId, "request.error", { reason });
        return null;
    }
}
