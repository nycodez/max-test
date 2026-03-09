import { getLocalInferenceStatus, tryLocalInferenceJson } from "./localInference";

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
    return getLocalInferenceStatus();
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

    const schema = {
        type: "object",
        additionalProperties: false,
        required: ["intent", "confidence", "entities", "alternatives"],
        properties: {
            intent: { type: "string", enum: [...SUPPORTED_INTENTS] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            entities: { type: "object", additionalProperties: true },
            alternatives: {
                type: "array",
                items: { type: "string", enum: [...SUPPORTED_INTENTS] },
                maxItems: 5,
            },
        },
    } satisfies Record<string, unknown>;

    const localResult = await tryLocalInferenceJson<Record<string, unknown>>({
        traceId: params.traceId,
        purpose: "local_router_plan",
        system: "You are an intent classifier for a CRM assistant. Return strict JSON only.",
        prompt: buildPrompt(params),
        schema,
        temperature: 0,
    });

    if (!localResult) {
        return null;
    }

    const plan = {
        intent: normalizeIntent(localResult.intent),
        confidence: normalizeConfidence(localResult.confidence),
        entities: normalizeEntities(localResult.entities),
        alternatives: normalizeAlternatives(localResult.alternatives),
    };
    traceLocalRouter(params.traceId, "request.success", {
        intent: plan.intent,
        confidence: plan.confidence,
        alternatives: plan.alternatives,
        source: "local_inference",
    });
    return plan;
}
