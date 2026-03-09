export const SUPPORTED_INTENTS = [
    "greeting",
    "capabilities",
    "llm_info",
    "property_scope",
    "create_contact",
    "create_company",
    "create_task",
    "list_contacts",
    "list_companies",
    "list_tasks",
    "unknown",
] as const;

export type LocalIntent = typeof SUPPORTED_INTENTS[number];

export type LocalRouterPlan = {
    intent: LocalIntent;
    confidence: number;
    entities: Record<string, unknown>;
    alternatives: LocalIntent[];
};

export type LocalRouterStatus = {
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

function normalizeIntent(value: unknown): LocalIntent {
    const intent = String(value || "").trim().toLowerCase();
    return (SUPPORTED_INTENTS as readonly string[]).includes(intent) ? (intent as LocalIntent) : "unknown";
}

function normalizeConfidence(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
}

function normalizeEntities(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function normalizeAlternatives(value: unknown): LocalIntent[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((candidate) => normalizeIntent(candidate))
        .filter((candidate, index, all) => candidate !== "unknown" && all.indexOf(candidate) === index)
        .slice(0, 5);
}

function getRouterConfig() {
    return {
        enabled: envFlag("LOCAL_ROUTER_ENABLED", false),
        url: env("LOCAL_ROUTER_URL", "http://wtf.local:11434"),
        model: env("LOCAL_ROUTER_MODEL", "qwen3.5:2b"),
        timeoutMs: Math.max(500, Number(env("LOCAL_ROUTER_TIMEOUT_MS", "12000")) || 12000),
    };
}

function traceLogsEnabled(): boolean {
    const raw = String(process.env.AI_TRACE_LOGS ?? "true").trim().toLowerCase();
    return !["0", "false", "off", "no", "disabled"].includes(raw);
}

function traceLocalRouter(traceId: string | undefined, stage: string, payload?: Record<string, unknown>): void {
    if (!traceLogsEnabled()) return;
    const prefix = traceId ? `[local-router][${traceId}]` : "[local-router]";
    const data = payload ? ` ${JSON.stringify(payload)}` : "";
    console.log(`${prefix} ${stage}${data}`);
}

export function getLocalRouterStatus(): LocalRouterStatus {
    const config = getRouterConfig();
    if (!config.enabled) return { enabled: false, reason: "LOCAL_ROUTER_ENABLED=false" };
    if (!config.url) return { enabled: false, reason: "LOCAL_ROUTER_URL is not set" };
    if (!config.model) return { enabled: false, reason: "LOCAL_ROUTER_MODEL is not set" };
    return { enabled: true };
}

function buildPrompt(params: {
    text: string;
    recentConversation: Array<{ role: "user" | "model"; text: string }>;
    overview: unknown;
}): string {
    const schema = {
        intent: "one of: " + SUPPORTED_INTENTS.join(" | "),
        confidence: "number 0..1",
        entities: {
            name: "string",
            title: "string",
            query: "string",
            status: "open|in_progress|done",
            email: "string",
            phone: "string",
            companyName: "string",
            details: "string",
            priority: "low|medium|high",
        },
        alternatives: "array of up to 3 intent values",
    };

    const compactRecentConversation = params.recentConversation
        .slice(-4)
        .map((message) => ({
            role: message.role,
            text: message.text.replace(/\s+/g, " ").trim().slice(0, 220),
        }));

    const compactOverview = (() => {
        if (!params.overview || typeof params.overview !== "object") return {};
        const source = params.overview as Record<string, unknown>;
        const counts = source.counts && typeof source.counts === "object" ? source.counts : {};
        return { counts };
    })();

    return [
        "You are an intent classifier for a CRM assistant. Return strict JSON only, no prose.",
        "Allowed intents:",
        SUPPORTED_INTENTS.join(", "),
        "Intent definitions:",
        "- greeting: simple hello/hi/no task requested",
        "- capabilities: asks what assistant can do",
        "- llm_info: asks which model/llm is being used",
        "- property_scope: asks about properties/budgets/forecasts (currently unsupported in this MVP)",
        "- create_contact/create_company/create_task: create a CRM record",
        "- list_contacts/list_companies/list_tasks: retrieve records",
        "- unknown: unclear or mixed intent",
        "Confusing pair guidance:",
        "- property_scope: requests about budget/forecast/property analytics",
        "- create_task: operational follow-up task requests",
        "Examples:",
        "{\"intent\":\"create_company\",\"confidence\":0.91,\"entities\":{\"name\":\"Acme Logistics\"},\"alternatives\":[\"create_contact\",\"list_companies\"]}",
        "{\"intent\":\"property_scope\",\"confidence\":0.87,\"entities\":{\"query\":\"budget forecast\"},\"alternatives\":[\"capabilities\",\"list_tasks\"]}",
        "{\"intent\":\"list_contacts\",\"confidence\":0.84,\"entities\":{\"query\":\"jamie\"},\"alternatives\":[\"create_contact\",\"list_companies\"]}",
        "{\"intent\":\"greeting\",\"confidence\":0.93,\"entities\":{},\"alternatives\":[\"capabilities\"]}",
        "Output schema:",
        JSON.stringify(schema),
        "CRM overview:",
        JSON.stringify(compactOverview),
        "Recent conversation:",
        JSON.stringify(compactRecentConversation),
        "User request:",
        params.text,
    ].join("\n");
}

export async function tryLocalRouterPlan(params: {
    traceId?: string;
    text: string;
    recentConversation: Array<{ role: "user" | "model"; text: string }>;
    overview: unknown;
}): Promise<LocalRouterPlan | null> {
    const status = getLocalRouterStatus();
    if (!status.enabled) {
        traceLocalRouter(params.traceId, "skip.disabled", { reason: status.reason ?? "unknown" });
        return null;
    }

    const config = getRouterConfig();
    if (!config.url || !config.model) {
        traceLocalRouter(params.traceId, "skip.invalid_config", {
            hasUrl: Boolean(config.url),
            hasModel: Boolean(config.model),
        });
        return null;
    }

    const startedAt = Date.now();
    traceLocalRouter(params.traceId, "request.start", {
        model: config.model,
        url: config.url,
        timeoutMs: config.timeoutMs,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
        const response = await fetch(`${config.url.replace(/\/+$/, "")}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: config.model,
                prompt: buildPrompt(params),
                stream: false,
                format: "json",
                options: {
                    temperature: 0,
                },
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            traceLocalRouter(params.traceId, "request.http_error", {
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
            traceLocalRouter(params.traceId, "request.empty_response", {
                durationMs: Date.now() - startedAt,
            });
            return null;
        }

        const jsonText = extractJsonObject(rawText) || rawText;
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        const plan = {
            intent: normalizeIntent(parsed.intent),
            confidence: normalizeConfidence(parsed.confidence),
            entities: normalizeEntities(parsed.entities),
            alternatives: normalizeAlternatives(parsed.alternatives),
        };
        traceLocalRouter(params.traceId, "request.success", {
            intent: plan.intent,
            confidence: plan.confidence,
            alternatives: plan.alternatives,
            source: responseText ? "response" : "thinking",
            durationMs: Date.now() - startedAt,
        });
        return plan;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        traceLocalRouter(params.traceId, "request.error", {
            message,
            durationMs: Date.now() - startedAt,
        });
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}
