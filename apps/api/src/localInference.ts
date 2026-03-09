type JsonSchema = Record<string, unknown>;

type LocalInferenceRequest = {
    traceId?: string;
    purpose: string;
    system?: string;
    prompt: string;
    schema: JsonSchema;
    temperature?: number;
    timeoutMs?: number;
};

type LocalInferenceStatus = {
    enabled: boolean;
    reason?: string;
};

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

function traceLogsEnabled(): boolean {
    const raw = String(process.env.AI_TRACE_LOGS ?? "true").trim().toLowerCase();
    return !["0", "false", "off", "no", "disabled"].includes(raw);
}

function traceLocalInference(traceId: string | undefined, stage: string, payload?: Record<string, unknown>): void {
    if (!traceLogsEnabled()) return;
    const prefix = traceId ? `[local-inference][${traceId}]` : "[local-inference]";
    const data = payload ? ` ${JSON.stringify(payload)}` : "";
    console.log(`${prefix} ${stage}${data}`);
}

function extractJsonObject(raw: string): string | null {
    const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    const start = trimmed.indexOf("{");
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < trimmed.length; index += 1) {
        const char = trimmed[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === "\"") {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (char === "{") depth += 1;
        if (char === "}") {
            depth -= 1;
            if (depth === 0) return trimmed.slice(start, index + 1);
        }
    }

    return null;
}

function getLocalInferenceConfig() {
    return {
        enabled: envFlag("LOCAL_ROUTER_ENABLED", false),
        url: env("LOCAL_ROUTER_URL", "http://wtf.local:11434"),
        model: env("LOCAL_ROUTER_MODEL", "qwen3.5:2b"),
        timeoutMs: Math.max(500, Number(env("LOCAL_ROUTER_TIMEOUT_MS", "12000")) || 12000),
    };
}

export function getLocalInferenceStatus(): LocalInferenceStatus {
    const config = getLocalInferenceConfig();
    if (!config.enabled) return { enabled: false, reason: "LOCAL_ROUTER_ENABLED=false" };
    if (!config.url) return { enabled: false, reason: "LOCAL_ROUTER_URL is not set" };
    if (!config.model) return { enabled: false, reason: "LOCAL_ROUTER_MODEL is not set" };
    return { enabled: true };
}

export async function tryLocalInferenceJson<T>(params: LocalInferenceRequest): Promise<T | null> {
    const status = getLocalInferenceStatus();
    if (!status.enabled) {
        traceLocalInference(params.traceId, "skip.disabled", { reason: status.reason ?? "unknown" });
        return null;
    }

    const config = getLocalInferenceConfig();
    if (!config.url || !config.model) {
        traceLocalInference(params.traceId, "skip.invalid_config", {
            hasUrl: Boolean(config.url),
            hasModel: Boolean(config.model),
        });
        return null;
    }

    const startedAt = Date.now();
    const timeoutMs = Math.max(500, params.timeoutMs ?? config.timeoutMs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        traceLocalInference(params.traceId, "request.start", {
            purpose: params.purpose,
            model: config.model,
            url: config.url,
            timeoutMs,
        });

        const response = await fetch(`${config.url.replace(/\/+$/, "")}/api/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: config.model,
                stream: false,
                format: "json",
                prompt: [
                    params.system?.trim() || "Return strict JSON only.",
                    "Return exactly one JSON object matching this schema.",
                    JSON.stringify(params.schema),
                    params.prompt,
                ].filter(Boolean).join("\n\n"),
                options: {
                    temperature: params.temperature ?? 0,
                },
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            traceLocalInference(params.traceId, "request.http_error", {
                purpose: params.purpose,
                status: response.status,
                statusText: response.statusText,
                durationMs: Date.now() - startedAt,
            });
            return null;
        }

        const payload = await response.json() as { response?: string; thinking?: string };
        const responseText = String(payload.response || "").trim();
        const thinkingText = String(payload.thinking || "").trim();
        const rawText = responseText || thinkingText;

        if (!rawText) {
            traceLocalInference(params.traceId, "request.empty_response", {
                purpose: params.purpose,
                durationMs: Date.now() - startedAt,
            });
            return null;
        }

        const jsonText = extractJsonObject(rawText) || rawText;
        const parsed = JSON.parse(jsonText) as T;

        traceLocalInference(params.traceId, "request.success", {
            purpose: params.purpose,
            source: responseText ? "response" : "thinking",
            durationMs: Date.now() - startedAt,
        });
        return parsed;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        traceLocalInference(params.traceId, "request.error", {
            purpose: params.purpose,
            message,
            durationMs: Date.now() - startedAt,
        });
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}
