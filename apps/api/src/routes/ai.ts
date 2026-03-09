import { Router, type Request } from "express";
import { Db, MongoClient, ObjectId } from "mongodb";
import type { ReqCtx } from "@crm/auth";
import {
    ensureCrmIndexes,
    executeAssistantAction,
    getOverview,
    type AssistantAction,
    type AssistantActionResult,
    type CrmOverview,
    type TaskPriority,
    type TaskStatus,
} from "../crm";
import {
    getAgentAbilitiesSummary,
    getAgentToolsConfig,
    getEnabledToolsForPrompt,
    matchAgentToolByText,
    type AgentToolAccess,
} from "../agentTools";
import { getLocalRouterStatus, tryLocalRouterPlan, type LocalIntent, type LocalRouterPlan } from "../localRouter";
import { getVertexStatus, tryGenerateGeminiText } from "../vertex";

const router = Router();

type Msg = { role: "user" | "model"; text: string; ts: string };
type SessionDoc = {
    _id?: ObjectId;
    tenantId: string;
    userId: string;
    sessionId: string;
    messages: Msg[];
    createdAt: string;
    updatedAt: string;
};

type AssistantPlan = {
    replyText: string;
    action: AssistantAction;
};

type ChatTurnResult = {
    threadId: string;
    threadTitle: string;
    replyText: string;
    action: AssistantAction;
    result: AssistantActionResult;
    overview: CrmOverview;
    visual: null;
};

type AuthedRequest = Request & { ctx: ReqCtx };

function traceLogsEnabled(): boolean {
    const raw = String(process.env.AI_TRACE_LOGS ?? "true").trim().toLowerCase();
    return !["0", "false", "off", "no", "disabled"].includes(raw);
}

function traceLog(traceId: string, stage: string, payload?: Record<string, unknown>): void {
    if (!traceLogsEnabled()) return;
    const data = payload ? ` ${JSON.stringify(payload)}` : "";
    console.log(`[ai][${traceId}] ${stage}${data}`);
}

function traceError(traceId: string, stage: string, error: unknown): void {
    if (!traceLogsEnabled()) return;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ai][${traceId}] ${stage} ${message}`);
}

function newTraceId(): string {
    return new ObjectId().toHexString().slice(-10);
}

function previewText(text: string, maxLength = 120): string {
    const compact = text.replace(/\s+/g, " ").trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength)}...`;
}

function summarizeAction(action: AssistantAction): string {
    switch (action.type) {
        case "create_contact":
            return `create_contact:${action.name}`;
        case "create_company":
            return `create_company:${action.name}`;
        case "create_task":
            return `create_task:${action.title}`;
        case "list_contacts":
            return "list_contacts";
        case "list_companies":
            return "list_companies";
        case "list_tasks":
            return "list_tasks";
        case "none":
            return "none";
    }
}

function summarizeResult(result: AssistantActionResult): string {
    switch (result.type) {
        case "contact_created":
            return `contact_created:${result.record.id}`;
        case "company_created":
            return `company_created:${result.record.id}`;
        case "task_created":
            return `task_created:${result.record.id}`;
        case "contacts_list":
            return `contacts_list:${result.total}`;
        case "companies_list":
            return `companies_list:${result.total}`;
        case "tasks_list":
            return `tasks_list:${result.total}`;
        case "none":
            return "none";
    }
}

function writeSse(res: { write: (chunk: string) => void }, event: string, payload: unknown): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function getSessionTitle(messages: Msg[]): string {
    const firstUser = messages.find((msg) => msg.role === "user" && msg.text.trim());
    if (!firstUser) return "Untitled thread";
    const compact = firstUser.text.trim().replace(/\s+/g, " ");
    return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
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
            if (depth === 0) {
                return trimmed.slice(start, index + 1);
            }
        }
    }

    return null;
}

function normalizeTaskStatus(value: unknown): TaskStatus | undefined {
    if (value === "open" || value === "in_progress" || value === "done") return value;
    return undefined;
}

function normalizeTaskPriority(value: unknown): TaskPriority | undefined {
    if (value === "low" || value === "medium" || value === "high") return value;
    return undefined;
}

function localRouterMinConfidence(): number {
    const parsed = Number(process.env.LOCAL_ROUTER_MIN_CONFIDENCE || "0.62");
    if (!Number.isFinite(parsed)) return 0.62;
    return Math.max(0, Math.min(1, parsed));
}

function entityText(entities: Record<string, unknown>, key: string): string | undefined {
    const value = entities[key];
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized || undefined;
}

function intentSuggestion(intent: LocalIntent): string {
    switch (intent) {
        case "create_company":
            return "Create company named Acme Logistics";
        case "create_contact":
            return "Create contact named Jamie Rivera";
        case "create_task":
            return "Create task follow up with Acme this week";
        case "list_companies":
            return "Show latest companies";
        case "list_contacts":
            return "Show latest contacts";
        case "list_tasks":
            return "Show open tasks";
        case "capabilities":
            return "What can you do?";
        case "property_scope":
            return "What can you do with properties?";
        case "llm_info":
            return "Which LLM are you using?";
        case "greeting":
            return "Hi";
        case "unknown":
            return "Show latest contacts";
    }
}

function capabilitiesSummaryText(): string {
    const summary = getAgentAbilitiesSummary(getAgentToolsConfig());
    return summary || "create and list contacts, companies, and tasks";
}

function capabilitiesReplyText(): string {
    return `I can ${capabilitiesSummaryText()}.`;
}

function lowConfidenceReply(plan: LocalRouterPlan): string {
    const suggestions = [plan.intent, ...plan.alternatives]
        .filter((intent, index, all) => intent !== "unknown" && all.indexOf(intent) === index)
        .slice(0, 3)
        .map((intent) => intentSuggestion(intent));

    if (!suggestions.length) {
        return "I might be reading that wrong. Can you rephrase it? You can also try: show latest contacts.";
    }

    return `I might be reading that wrong. Did you mean one of these? ${suggestions.map((item, index) => `${index + 1}) ${item}`).join("  ")}`;
}

function normalizeAction(input: unknown): AssistantAction {
    if (!input || typeof input !== "object") return { type: "none" };
    const source = input as Record<string, unknown>;
    const type = typeof source.type === "string" ? source.type.trim() : "";

    switch (type) {
        case "create_contact": {
            const name = String(source.name || "").trim();
            if (!name) return { type: "none" };
            return {
                type,
                name,
                email: typeof source.email === "string" ? source.email.trim() : undefined,
                phone: typeof source.phone === "string" ? source.phone.trim() : undefined,
                companyName: typeof source.companyName === "string" ? source.companyName.trim() : undefined,
                notes: typeof source.notes === "string" ? source.notes.trim() : undefined,
            };
        }
        case "create_company": {
            const name = String(source.name || "").trim();
            if (!name) return { type: "none" };
            return {
                type,
                name,
                website: typeof source.website === "string" ? source.website.trim() : undefined,
                industry: typeof source.industry === "string" ? source.industry.trim() : undefined,
                notes: typeof source.notes === "string" ? source.notes.trim() : undefined,
            };
        }
        case "create_task": {
            const title = String(source.title || "").trim();
            if (!title) return { type: "none" };
            return {
                type,
                title,
                details: typeof source.details === "string" ? source.details.trim() : undefined,
                dueDate: typeof source.dueDate === "string" ? source.dueDate.trim() : undefined,
                priority: normalizeTaskPriority(source.priority),
                contactName: typeof source.contactName === "string" ? source.contactName.trim() : undefined,
                companyName: typeof source.companyName === "string" ? source.companyName.trim() : undefined,
            };
        }
        case "list_contacts":
            return {
                type,
                query: typeof source.query === "string" ? source.query.trim() : undefined,
                limit: typeof source.limit === "number" ? Math.max(1, Math.min(20, source.limit)) : undefined,
            };
        case "list_companies":
            return {
                type,
                query: typeof source.query === "string" ? source.query.trim() : undefined,
                limit: typeof source.limit === "number" ? Math.max(1, Math.min(20, source.limit)) : undefined,
            };
        case "list_tasks":
            return {
                type,
                status: normalizeTaskStatus(source.status),
                limit: typeof source.limit === "number" ? Math.max(1, Math.min(20, source.limit)) : undefined,
            };
        default:
            return { type: "none" };
    }
}

function buildFallbackReply(action: AssistantAction): string {
    switch (action.type) {
        case "create_contact":
            return `I created ${action.name} as a new contact.`;
        case "create_company":
            return `I created ${action.name} as a company record.`;
        case "create_task":
            return `I created the task "${action.title}".`;
        case "list_contacts":
            return action.query ? `Here are the contacts matching "${action.query}".` : "Here are the latest contacts.";
        case "list_companies":
            return action.query ? `Here are the companies matching "${action.query}".` : "Here are the latest companies.";
        case "list_tasks":
            return action.status ? `Here are the ${action.status.replace("_", " ")} tasks.` : "Here are the latest tasks.";
        case "none":
            return `${capabilitiesReplyText()} Tell me what you want to do, and I will guide you.`;
    }
}

function isGreeting(text: string): boolean {
    const normalized = text
        .trim()
        .toLowerCase()
        .replace(/[!?.,]/g, " ")
        .replace(/\s+/g, " ");

    if (!normalized) return false;

    if (/^(hi|hello|hey|yo|sup|hiya|howdy)(\s+(there|max|assistant|bot))?$/.test(normalized)) {
        return true;
    }

    if (/^good (morning|afternoon|evening)(\s+(there|max|assistant|bot))?$/.test(normalized)) {
        return true;
    }

    return false;
}

function looksLikeCapabilitiesEcho(text: string): boolean {
    const compact = text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const legacyCapabilitiesEcho = compact.includes("i can create contacts")
        && compact.includes("companies")
        && compact.includes("tasks")
        && compact.includes("list")
        && compact.includes("latest records");

    const fallbackEcho = compact.includes("i am here with you")
        && compact.includes("did not fully catch")
        && compact.includes("you can ask me to create or list contacts")
        && compact.includes("companies")
        && compact.includes("tasks");

    const conversationalEcho = compact.includes("you can ask me to create or list contacts")
        && compact.includes("companies")
        && compact.includes("tasks");

    return legacyCapabilitiesEcho || fallbackEcho || conversationalEcho;
}

function smallTalkReply(text: string): string | null {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return null;

    if (/(how are you|how's it going|hows it going|how are things|what's up|whats up)/.test(normalized)) {
        return "Doing well, thanks. I can chat briefly, and I can also create or list contacts, companies, and tasks. What would you like next?";
    }

    if (/\b(thanks|thank you|thx|appreciate it)\b/.test(normalized)) {
        return "Anytime. Want me to pull the latest contacts, companies, or tasks?";
    }

    if (/^(ok|okay|cool|nice|great|awesome|sounds good|got it)[!. ]*$/.test(normalized)) {
        return "Perfect. When you are ready, tell me what you want me to create or list.";
    }

    if (/(who are you|what are you)/.test(normalized)) {
        return "I am Max, your CRM operator assistant. I can chat and help with contacts, companies, and tasks.";
    }

    return null;
}

function normalizeForCompare(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isEchoOfRecentAssistant(text: string, history: Msg[]): boolean {
    const incoming = normalizeForCompare(text);
    if (!incoming || incoming.split(" ").length < 5) return false;

    const recentAssistant = history
        .slice(-6)
        .filter((message) => message.role === "model")
        .map((message) => normalizeForCompare(message.text))
        .filter(Boolean);

    if (!recentAssistant.length) return false;

    for (const candidate of recentAssistant) {
        if (incoming === candidate) return true;
        if (incoming.includes(candidate) || candidate.includes(incoming)) return true;

        const incomingTokens = new Set(incoming.split(" "));
        const candidateTokens = candidate.split(" ");
        const overlap = candidateTokens.filter((token) => incomingTokens.has(token)).length;
        const ratio = overlap / Math.max(candidateTokens.length, 1);
        if (ratio >= 0.85 && Math.abs(candidateTokens.length - incomingTokens.size) <= 6) {
            return true;
        }
    }

    return false;
}

function isCrmIntentLikely(text: string): boolean {
    const lower = text.toLowerCase();
    return /(create|add|new|show|list|find|search|update|delete|remove|open).*(contact|lead|company|account|task|follow-?up|todo)/i.test(lower)
        || /\b(contacts|companies|tasks|crm)\b/i.test(lower);
}

function isDeterministicCrmCommand(text: string): boolean {
    const lower = text.trim().toLowerCase();
    if (!lower) return false;

    return /^(create|add|new|show|list|find|search)\b/.test(lower)
        && /\b(contact|lead|company|account|task|follow-?up|todo|contacts|companies|tasks)\b/.test(lower);
}

function isDeterministicMetaQuestion(text: string): boolean {
    const lower = text.trim().toLowerCase();
    if (!lower) return false;
    return /what can you do|capabilities|which llm|what model are you|what model|properties|property|help me/.test(lower);
}

function isLikelyGeneralQuestion(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return false;
    if (isCrmIntentLikely(normalized)) return false;

    if (/^(who|what|when|where|why|how|can you|could you|do you|is|are|will|would)\b/.test(normalized)) {
        return true;
    }

    return /\b(time|date|weather|news|explain|tell me|difference between)\b/.test(normalized);
}

function buildGeneralPrompt(text: string, recentConversation: Array<{ role: "user" | "model"; text: string }>): string {
    return [
        "You are Max, a concise and friendly assistant in a CRM app.",
        "Answer the user naturally in 1-2 short sentences.",
        "Do not invent app capabilities.",
        "If the question is outside CRM, answer it directly when possible.",
        "No JSON. No markdown list. Plain text only.",
        "Recent conversation:",
        JSON.stringify(recentConversation),
        "User question:",
        text,
    ].join("\n");
}

function cleanGeneralReply(raw: string): string {
    const cleaned = raw
        .replace(/^```[\w-]*\s*/g, "")
        .replace(/```$/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleaned) {
        return "I am not fully sure, but I can still help. Ask me again in one short sentence.";
    }

    return cleaned.length > 280 ? `${cleaned.slice(0, 280)}...` : cleaned;
}

function austinTimeReply(text: string): string | null {
    const lower = text.toLowerCase();
    if (!/(what(?:'s| is)? the time|current time|time in)/i.test(lower)) return null;
    if (!/\baustin|texas|tx\b/i.test(lower)) return null;

    const now = new Date();
    const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(now);

    return `In Austin, Texas (Central Time), it is ${formatted}.`;
}

function extractWeatherPlace(text: string): string | null {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return null;

    const locationMatch = normalized.match(/\b(?:in|for|at)\s+([A-Za-z0-9.' -]+)$/i);
    const place = locationMatch?.[1]?.trim();
    if (place) return place.replace(/[?.!,]+$/g, "").trim();

    if (/\baustin\b/i.test(normalized) && /\b(texas|tx)\b/i.test(normalized)) {
        return "Austin, Texas";
    }
    if (/\baustin\b/i.test(normalized)) return "Austin, Texas";

    return null;
}

function weatherCodeText(code: number): string {
    if ([0].includes(code)) return "clear";
    if ([1, 2].includes(code)) return "partly cloudy";
    if ([3].includes(code)) return "overcast";
    if ([45, 48].includes(code)) return "foggy";
    if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
    if ([95, 96, 99].includes(code)) return "thunderstorms";
    return "mixed conditions";
}

async function fetchLiveWeatherReply(place: string): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
        const geocode = async (query: string) => {
            const geoResponse = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`,
                { signal: controller.signal },
            );
            if (!geoResponse.ok) return null;
            const geoData = await geoResponse.json() as {
                results?: Array<{
                    name: string;
                    admin1?: string;
                    country?: string;
                    country_code?: string;
                    latitude: number;
                    longitude: number;
                    timezone?: string;
                }>;
            };
            return geoData.results?.[0] ?? null;
        };

        const trimmed = place.trim().replace(/\s+/g, " ");
        const fallbackCityOnly = trimmed.replace(/\b(?:texas|tx)\b/ig, "").replace(/\s+/g, " ").trim();
        const candidates = Array.from(new Set([
            trimmed,
            fallbackCityOnly,
            trimmed.replace(/\s+/g, ", "),
            "Austin",
        ].filter((candidate) => candidate && candidate.length > 1)));

        let hit: {
            name: string;
            admin1?: string;
            country?: string;
            country_code?: string;
            latitude: number;
            longitude: number;
            timezone?: string;
        } | null = null;

        for (const candidate of candidates) {
            // eslint-disable-next-line no-await-in-loop
            hit = await geocode(candidate);
            if (hit) break;
        }

        if (!hit) return null;

        const forecastResponse = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}`
            + "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m"
            + "&temperature_unit=fahrenheit&wind_speed_unit=mph"
            + `&timezone=${encodeURIComponent(hit.timezone || "auto")}`,
            { signal: controller.signal },
        );
        if (!forecastResponse.ok) return null;

        const forecastData = await forecastResponse.json() as {
            current?: {
                temperature_2m?: number;
                apparent_temperature?: number;
                weather_code?: number;
                wind_speed_10m?: number;
            };
        };

        const current = forecastData.current;
        if (!current) return null;

        const location = [hit.name, hit.admin1, hit.country || hit.country_code].filter(Boolean).join(", ");
        const temp = Number.isFinite(current.temperature_2m) ? Math.round(current.temperature_2m as number) : null;
        const feels = Number.isFinite(current.apparent_temperature) ? Math.round(current.apparent_temperature as number) : null;
        const wind = Number.isFinite(current.wind_speed_10m) ? Math.round(current.wind_speed_10m as number) : null;
        const weather = Number.isFinite(current.weather_code) ? weatherCodeText(current.weather_code as number) : "mixed conditions";

        const tempText = temp !== null ? `${temp}F` : "n/a";
        const feelsText = feels !== null ? `${feels}F` : "n/a";
        const windText = wind !== null ? `${wind} mph` : "n/a";

        return `Current weather in ${location}: ${tempText}, feels like ${feelsText}, ${weather}, wind ${windText}.`;
    } catch {
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

function tryFormatTimeForZone(timeZone: string, label: string): string | null {
    try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat("en-US", {
            timeZone,
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
        }).format(now);
        return `In ${label}, it is ${formatted}.`;
    } catch {
        return null;
    }
}

function configuredTimeReply(text: string, access: AgentToolAccess): string {
    const normalized = normalizeForCompare(text);
    const timezoneMap = access.cityTimezones || {};
    const keys = Object.keys(timezoneMap).sort((left, right) => right.length - left.length);

    for (const key of keys) {
        if (!normalized.includes(key)) continue;
        const timezone = timezoneMap[key];
        const label = key.split(" ").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
        const reply = tryFormatTimeForZone(timezone, label);
        if (reply) return reply;
    }

    const fallbackReply = tryFormatTimeForZone(
        access.defaultTimezone || "America/Chicago",
        access.defaultLocationLabel || "Austin, Texas",
    );
    if (fallbackReply) return fallbackReply;

    return "I could not resolve a timezone from that request.";
}

async function planFromConfiguredTool(traceId: string, text: string): Promise<AssistantPlan | null> {
    const config = getAgentToolsConfig();
    const tool = matchAgentToolByText(text, config);
    if (!tool) return null;

    traceLog(traceId, "plan.config_tool.match", {
        toolId: tool.id,
        method: tool.access.method,
    });

    switch (tool.access.method) {
        case "local.weather_open_meteo": {
            const place = extractWeatherPlace(text) || tool.access.defaultLocation || "Austin, Texas";
            const replyText = await fetchLiveWeatherReply(place);
            if (!replyText) {
                traceLog(traceId, "plan.config_tool.weather_unavailable", { place });
                return {
                    replyText: `I could not fetch live weather for ${place} right now.`,
                    action: { type: "none" },
                };
            }
            return {
                replyText,
                action: { type: "none" },
            };
        }
        case "local.time_lookup":
            return {
                replyText: configuredTimeReply(text, tool.access),
                action: { type: "none" },
            };
        case "crm.list_contacts":
            return {
                replyText: "I pulled the latest contacts.",
                action: { type: "list_contacts" },
            };
        case "crm.list_companies":
            return {
                replyText: "I pulled the latest companies.",
                action: { type: "list_companies" },
            };
        case "crm.list_tasks":
            return {
                replyText: "I pulled the latest tasks.",
                action: { type: "list_tasks" },
            };
        case "crm.create_contact": {
            const name = parseCreateContactName(text);
            if (!name) {
                return {
                    replyText: "Sure, what contact name should I use?",
                    action: { type: "none" },
                };
            }
            return {
                replyText: `I created ${name} as a contact.`,
                action: { type: "create_contact", name },
            };
        }
        case "crm.create_company": {
            const name = parseCreateCompanyName(text);
            if (!name) {
                return {
                    replyText: "Sure, what company name should I use?",
                    action: { type: "none" },
                };
            }
            return {
                replyText: `I created ${name} as a company.`,
                action: { type: "create_company", name },
            };
        }
        case "crm.create_task": {
            const title = parseCreateTaskTitle(text);
            if (!title) {
                return {
                    replyText: "Sure, what should the task title be?",
                    action: { type: "none" },
                };
            }
            return {
                replyText: `I created the task "${title}".`,
                action: { type: "create_task", title },
            };
        }
    }
}

function extractTail(text: string, anchor: RegExp): string | null {
    const match = text.match(anchor);
    const value = match?.[1]?.trim();
    if (!value) return null;
    return value
        .replace(/\s+(with|at|in|for)\s+.*$/i, "")
        .replace(/^["'`]+|["'`]+$/g, "")
        .trim() || null;
}

function parseCreateCompanyName(text: string): string | null {
    return extractTail(text, /(?:create|add|new)\s+(?:a\s+)?(?:company|account)(?:\s+(?:named|called))?\s+(.+)$/i);
}

function parseCreateContactName(text: string): string | null {
    return extractTail(text, /(?:create|add|new)\s+(?:a\s+)?(?:contact|lead)(?:\s+(?:named|called))?\s+(.+)$/i);
}

function parseCreateTaskTitle(text: string): string | null {
    return extractTail(text, /(?:create|add|new)\s+(?:a\s+)?(?:task|follow-?up|todo)(?:\s+(?:to|named|called))?\s+(.+)$/i);
}

function planFromIntent(intent: LocalIntent, entities: Record<string, unknown>, text: string, vertexEnabled: boolean): AssistantPlan | null {
    switch (intent) {
        case "greeting": {
            const timeReply = austinTimeReply(text);
            if (timeReply) {
                return {
                    replyText: timeReply,
                    action: { type: "none" },
                };
            }

            if (isLikelyGeneralQuestion(text)) {
                return null;
            }

            return {
                replyText: `Hey there. ${capabilitiesReplyText()} Want to start with latest companies?`,
                action: { type: "none" },
            };
        }
        case "capabilities":
            return {
                replyText: `${capabilitiesReplyText()} I can also keep a short conversation while we work.`,
                action: { type: "none" },
            };
        case "llm_info":
            return {
                replyText: vertexEnabled
                    ? "I am using Gemini through Vertex for planning, plus typed CRM actions."
                    : "Vertex is currently disabled, so I am running local routing/heuristics and typed CRM actions.",
                action: { type: "none" },
            };
        case "property_scope":
            return {
                replyText: "Property, budget, and forecast workflows are not wired in this MVP yet. Right now I handle contacts, companies, and tasks.",
                action: { type: "none" },
            };
        case "create_company": {
            const name = entityText(entities, "name") || parseCreateCompanyName(text);
            if (!name) {
                return {
                    replyText: "Sure, what company name should I use? Example: create company named Acme Logistics.",
                    action: { type: "none" },
                };
            }

            return {
                replyText: `I created ${name} as a company.`,
                action: {
                    type: "create_company",
                    name,
                    website: entityText(entities, "website"),
                    industry: entityText(entities, "industry"),
                    notes: entityText(entities, "notes"),
                },
            };
        }
        case "create_contact": {
            const name = entityText(entities, "name") || parseCreateContactName(text);
            if (!name) {
                return {
                    replyText: "Sure, what contact name should I use? Example: create contact named Jamie Rivera.",
                    action: { type: "none" },
                };
            }

            return {
                replyText: `I created ${name} as a contact.`,
                action: {
                    type: "create_contact",
                    name,
                    email: entityText(entities, "email"),
                    phone: entityText(entities, "phone"),
                    companyName: entityText(entities, "companyName"),
                    notes: entityText(entities, "notes"),
                },
            };
        }
        case "create_task": {
            const title = entityText(entities, "title") || parseCreateTaskTitle(text);
            if (!title) {
                return {
                    replyText: "Sure, what should the task title be? Example: create task follow up with Acme this week.",
                    action: { type: "none" },
                };
            }

            const priority = normalizeTaskPriority(entities.priority) || "medium";
            return {
                replyText: `I created the task "${title}".`,
                action: {
                    type: "create_task",
                    title,
                    details: entityText(entities, "details"),
                    dueDate: entityText(entities, "dueDate"),
                    priority,
                    contactName: entityText(entities, "contactName"),
                    companyName: entityText(entities, "companyName"),
                },
            };
        }
        case "list_contacts":
            return {
                replyText: "I pulled the latest contacts.",
                action: { type: "list_contacts", query: entityText(entities, "query") },
            };
        case "list_companies":
            return {
                replyText: "I pulled the latest companies.",
                action: { type: "list_companies", query: entityText(entities, "query") },
            };
        case "list_tasks":
            return {
                replyText: "I pulled the latest tasks.",
                action: { type: "list_tasks", status: normalizeTaskStatus(entities.status) },
            };
        case "unknown":
            return null;
    }
}

function heuristicPlan(text: string, vertexEnabled: boolean): AssistantPlan {
    const normalized = text.trim();
    const lower = normalized.toLowerCase();
    const emailMatch = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const phoneMatch = normalized.match(/(?:\+\d{1,3}\s*)?(?:\(?\d{3}\)?[\s.-]*)?\d{3}[\s.-]*\d{4}/);
    const websiteMatch = normalized.match(/https?:\/\/[^\s]+|www\.[^\s]+/i);

    if (looksLikeCapabilitiesEcho(normalized)) {
        return {
            replyText: "No problem, that sounds like my summary echoed back. Tell me one thing you want me to do next.",
            action: { type: "none" },
        };
    }

    if (isGreeting(normalized)) {
        return {
            replyText: `Hey there. ${capabilitiesReplyText()} We can keep this conversational.`,
            action: { type: "none" },
        };
    }

    const timeReply = austinTimeReply(normalized);
    if (timeReply) {
        return {
            replyText: timeReply,
            action: { type: "none" },
        };
    }

    const smallTalk = smallTalkReply(normalized);
    if (smallTalk) {
        return {
            replyText: smallTalk,
            action: { type: "none" },
        };
    }

    if (/(which|what)\s+(llm|model).*(using|use)|what model are you|which llm are you/i.test(lower)) {
        return {
            replyText: vertexEnabled
                ? "I am using Gemini through Vertex for planning, plus typed CRM actions."
                : "Vertex is currently disabled, so I am running local heuristic planning and typed CRM actions.",
            action: { type: "none" },
        };
    }

    if (/(what|which).*(able|can).*(do|help)|capabilities|what can you do|help me/i.test(lower)) {
        if (/\bproperty|properties\b/i.test(lower)) {
            return {
                replyText: "In this MVP I cannot modify property records yet. I currently handle contacts, companies, and tasks.",
                action: { type: "none" },
            };
        }

        return {
            replyText: `${capabilitiesReplyText()} I can also keep quick back-and-forth conversation.`,
            action: { type: "none" },
        };
    }

    if (/\bproperty|properties\b/i.test(lower)) {
        return {
            replyText: `Property operations are not wired in this MVP yet. ${capabilitiesReplyText()}`,
            action: { type: "none" },
        };
    }

    // Prioritize explicit create intents over list/find patterns.
    if (/(^|\b(?:can you|could you|please)\s+)(create|add|new)\b.*\b(company|account)\b/i.test(lower)) {
        const name = parseCreateCompanyName(normalized);
        const industryMatch = normalized.match(/\bin\s+([A-Za-z0-9&.,' -]+)$/i);
        if (!name) {
            return {
                replyText: "Sure, what company name should I use? Example: create company named Acme Logistics.",
                action: { type: "none" },
            };
        }

        return {
            replyText: `I created ${name} as a company.`,
            action: {
                type: "create_company",
                name,
                website: websiteMatch?.[0],
                industry: industryMatch?.[1]?.trim(),
            },
        };
    }

    if (/(^|\b(?:can you|could you|please)\s+)(create|add|new)\b.*\b(contact|lead)\b/i.test(lower)) {
        const name = parseCreateContactName(normalized);
        const companyMatch = normalized.match(/\bat\s+([A-Za-z0-9&.,' -]+)$/i);
        if (!name) {
            return {
                replyText: "Sure, what contact name should I use? Example: create contact named Jamie Rivera.",
                action: { type: "none" },
            };
        }

        return {
            replyText: `I created ${name} as a contact.`,
            action: {
                type: "create_contact",
                name,
                email: emailMatch?.[0],
                phone: phoneMatch?.[0],
                companyName: companyMatch?.[1]?.trim(),
            },
        };
    }

    if (/(^|\b(?:can you|could you|please)\s+)(create|add|new)\b.*\b(task|follow-?up|todo)\b/i.test(lower)) {
        const title = parseCreateTaskTitle(normalized);
        if (!title) {
            return {
                replyText: "Sure, what should the task title be? Example: create task follow up with Acme this week.",
                action: { type: "none" },
            };
        }

        const priority = lower.includes("high priority") ? "high" : lower.includes("low priority") ? "low" : "medium";
        return {
            replyText: `I created the task "${title}".`,
            action: { type: "create_task", title, priority },
        };
    }

    if (/(show|list|find|search).*(contacts|contact|leads|lead)/i.test(lower)) {
        const namedMatch = normalized.match(/(?:named|for)\s+(.+)$/i);
        const query = namedMatch?.[1]?.trim();
        return {
            replyText: query ? `I pulled the contacts matching "${query}".` : "I pulled the latest contacts.",
            action: { type: "list_contacts", query },
        };
    }

    if (/(show|list|find|search).*(companies|company|accounts|account)/i.test(lower)) {
        const queryMatch = normalized.match(/(?:named|for)\s+(.+)$/i);
        const query = queryMatch?.[1]?.trim();
        return {
            replyText: query ? `I pulled the companies matching "${query}".` : "I pulled the latest companies.",
            action: { type: "list_companies", query },
        };
    }

    if (/(show|list|find).*(tasks|task|follow-?ups|todo)/i.test(lower)) {
        const status = lower.includes("done") ? "done" : lower.includes("in progress") ? "in_progress" : lower.includes("open") ? "open" : undefined;
        return {
            replyText: status ? `I pulled the ${status.replace("_", " ")} tasks.` : "I pulled the latest tasks.",
            action: { type: "list_tasks", status },
        };
    }

    return {
        replyText: "I am here with you. I did not fully catch that, can you say it another way? If helpful, you can ask me to create or list contacts, companies, or tasks.",
        action: { type: "none" },
    };
}

async function planAssistantTurn(traceId: string, text: string, history: Msg[], overview: CrmOverview): Promise<AssistantPlan> {
    const vertexEnabled = getVertexStatus().enabled;
    const recentConversation = history.slice(-8).map((message) => ({
        role: message.role,
        text: message.text,
    }));

    traceLog(traceId, "plan.start", {
        text: previewText(text),
        historyMessages: history.length,
        recentMessages: recentConversation.length,
        vertexEnabled,
        counts: overview.counts,
    });

    if (isEchoOfRecentAssistant(text, history)) {
        traceLog(traceId, "plan.echo_detected");
        return {
            replyText: "Looks like that repeated my last message. Ask me in your own words, and I will respond naturally.",
            action: { type: "none" },
        };
    }

    const configuredToolPlan = await planFromConfiguredTool(traceId, text);
    if (configuredToolPlan) {
        traceLog(traceId, "plan.config_tool.selected", {
            action: summarizeAction(configuredToolPlan.action),
            replyText: previewText(configuredToolPlan.replyText, 90),
        });
        return configuredToolPlan;
    }

    if (isDeterministicCrmCommand(text)) {
        const deterministicPlan = heuristicPlan(text, vertexEnabled);
        if (deterministicPlan.action.type !== "none") {
            traceLog(traceId, "plan.deterministic_crm.selected", {
                action: summarizeAction(deterministicPlan.action),
                replyText: previewText(deterministicPlan.replyText, 90),
            });
            return deterministicPlan;
        }
    }

    if (isDeterministicMetaQuestion(text)) {
        const metaPlan = heuristicPlan(text, vertexEnabled);
        traceLog(traceId, "plan.deterministic_meta.selected", {
            action: summarizeAction(metaPlan.action),
            replyText: previewText(metaPlan.replyText, 90),
        });
        return metaPlan;
    }

    const likelyGeneralQuestion = isLikelyGeneralQuestion(text);
    let generalAttempted = false;
    const maybePlanGeneralAnswer = async (reason: string): Promise<AssistantPlan | null> => {
        if (!vertexEnabled || !likelyGeneralQuestion || generalAttempted) return null;
        generalAttempted = true;
        traceLog(traceId, "plan.vertex.general.attempt", { reason });
        const raw = await tryGenerateGeminiText(buildGeneralPrompt(text, recentConversation), traceId);
        if (!raw) {
            traceLog(traceId, "plan.vertex.general.empty", { reason });
            return null;
        }

        const replyText = cleanGeneralReply(raw);
        traceLog(traceId, "plan.vertex.general.selected", {
            reason,
            replyText: previewText(replyText, 90),
        });
        return {
            replyText,
            action: { type: "none" },
        };
    };

    const localPlan = await tryLocalRouterPlan({
        traceId,
        text,
        recentConversation,
        overview,
    });

    if (localPlan) {
        traceLog(traceId, "plan.local_router.result", {
            intent: localPlan.intent,
            confidence: localPlan.confidence,
            alternatives: localPlan.alternatives,
        });
        if (localPlan.confidence < localRouterMinConfidence()) {
            traceLog(traceId, "plan.local_router.low_confidence", {
                confidence: localPlan.confidence,
                minConfidence: localRouterMinConfidence(),
            });
            const generalPlan = await maybePlanGeneralAnswer("local_router_low_confidence");
            if (generalPlan) return generalPlan;
            return {
                replyText: lowConfidenceReply(localPlan),
                action: { type: "none" },
            };
        }

        const mapped = planFromIntent(localPlan.intent, localPlan.entities, text, vertexEnabled);
        if (mapped) {
            traceLog(traceId, "plan.local_router.selected", {
                action: summarizeAction(mapped.action),
                replyText: previewText(mapped.replyText, 90),
            });
            return mapped;
        }
    } else {
        traceLog(traceId, "plan.local_router.miss");
    }

    const generalPlan = await maybePlanGeneralAnswer("post_local_router");
    if (generalPlan) return generalPlan;

    const prompt = [
        "You are Max, an AI CRM operator for a focused MVP.",
        "Return exactly one JSON object and nothing else.",
        "Schema:",
        JSON.stringify({
            replyText: "Short helpful response in plain English.",
            action: {
                type: "one of none | create_contact | create_company | create_task | list_contacts | list_companies | list_tasks",
            },
        }),
        "Rules:",
        "- Only choose actions that are supported by the schema.",
        "- Prefer list actions when the user asks to show, list, find, or search records.",
        "- Prefer create actions when the user asks to add or create a record.",
        "- If the user request is ambiguous or missing required details, use action type 'none' and ask a short follow-up question.",
        "- Do not mention unsupported features like dynamic models, forms, images, or YouTube.",
        "- Keep replyText under 160 characters.",
        "Enabled tool catalog:",
        JSON.stringify(getEnabledToolsForPrompt(getAgentToolsConfig())),
        "CRM snapshot:",
        JSON.stringify(overview),
        "Recent conversation:",
        JSON.stringify(recentConversation),
        "User request:",
        text,
    ].join("\n");

    try {
        traceLog(traceId, "plan.vertex.attempt");
        const rawText = await tryGenerateGeminiText(prompt, traceId);
        if (!rawText) {
            traceLog(traceId, "plan.vertex.empty_fallback_heuristic");
            const plan = heuristicPlan(text, vertexEnabled);
            traceLog(traceId, "plan.heuristic.selected", {
                action: summarizeAction(plan.action),
                replyText: previewText(plan.replyText, 90),
            });
            return plan;
        }

        const jsonText = extractJsonObject(rawText);
        if (!jsonText) {
            traceLog(traceId, "plan.vertex.no_json_fallback_heuristic", {
                rawPreview: previewText(rawText, 120),
            });
            const plan = heuristicPlan(text, true);
            traceLog(traceId, "plan.heuristic.selected", {
                action: summarizeAction(plan.action),
                replyText: previewText(plan.replyText, 90),
            });
            return plan;
        }

        const parsed = JSON.parse(jsonText) as { replyText?: unknown; action?: unknown };
        const action = normalizeAction(parsed.action);
        const replyText = typeof parsed.replyText === "string" && parsed.replyText.trim()
            ? parsed.replyText.trim()
            : buildFallbackReply(action);

        traceLog(traceId, "plan.vertex.selected", {
            action: summarizeAction(action),
            replyText: previewText(replyText, 90),
        });

        return { replyText, action };
    } catch (error) {
        traceError(traceId, "plan.vertex.error_fallback_heuristic", error);
        const plan = heuristicPlan(text, false);
        traceLog(traceId, "plan.heuristic.selected", {
            action: summarizeAction(plan.action),
            replyText: previewText(plan.replyText, 90),
        });
        return plan;
    }
}

async function ensureSession(db: Db, ctx: ReqCtx, sessionId: string, now: string): Promise<void> {
    await db.collection<SessionDoc>("ai_sessions").updateOne(
        { tenantId: ctx.tenantId, userId: ctx.user.id, sessionId },
        {
            $setOnInsert: {
                tenantId: ctx.tenantId,
                userId: ctx.user.id,
                sessionId,
                messages: [],
                createdAt: now,
                updatedAt: now,
            },
        },
        { upsert: true },
    );
}

async function appendUserMessage(db: Db, ctx: ReqCtx, sessionId: string, text: string, now: string): Promise<SessionDoc | null> {
    const updated = await db.collection<SessionDoc>("ai_sessions").findOneAndUpdate(
        { tenantId: ctx.tenantId, userId: ctx.user.id, sessionId },
        {
            $push: { messages: { role: "user", text, ts: now } },
            $set: { updatedAt: now },
        },
        { returnDocument: "after" },
    );

    return updated;
}

async function appendModelMessage(db: Db, ctx: ReqCtx, sessionId: string, text: string): Promise<void> {
    const now = new Date().toISOString();
    await db.collection<SessionDoc>("ai_sessions").updateOne(
        { tenantId: ctx.tenantId, userId: ctx.user.id, sessionId },
        {
            $push: { messages: { role: "model", text, ts: now } },
            $set: { updatedAt: now },
        },
    );
}

async function runChatTurn(
    traceId: string,
    getClient: () => Promise<MongoClient>,
    dbName: string,
    ctx: ReqCtx,
    text: string,
    requestedThreadId?: string,
): Promise<ChatTurnResult> {
    const startedAt = Date.now();
    traceLog(traceId, "turn.start", {
        tenantId: ctx.tenantId,
        userId: ctx.user.id,
        requestedThreadId: requestedThreadId ?? null,
        text: previewText(text),
    });

    const client = await getClient();
    const db = client.db(dbName);
    await ensureCrmIndexes(db);

    const now = new Date().toISOString();
    const threadId = requestedThreadId?.trim() || new ObjectId().toHexString();
    await ensureSession(db, ctx, threadId, now);

    const conversation = await appendUserMessage(db, ctx, threadId, text, now);
    const history = conversation?.messages || [{ role: "user", text, ts: now }];
    traceLog(traceId, "turn.history.updated", {
        threadId,
        historyMessages: history.length,
    });
    const overviewBefore = await getOverview(db, ctx);
    const plan = await planAssistantTurn(traceId, text, history, overviewBefore);
    traceLog(traceId, "turn.plan.selected", {
        threadId,
        action: summarizeAction(plan.action),
        replyText: previewText(plan.replyText, 90),
    });
    const result = await executeAssistantAction(db, ctx, plan.action);
    traceLog(traceId, "turn.action.executed", {
        threadId,
        result: summarizeResult(result),
    });
    const overview = await getOverview(db, ctx);
    const replyText = plan.replyText || buildFallbackReply(plan.action);

    await appendModelMessage(db, ctx, threadId, replyText);
    traceLog(traceId, "turn.end", {
        threadId,
        durationMs: Date.now() - startedAt,
    });

    return {
        threadId,
        threadTitle: getSessionTitle(history),
        replyText,
        action: plan.action,
        result,
        overview,
        visual: null,
    };
}

export default function aiRoutes(getClient: () => Promise<MongoClient>, dbName: string) {
    router.get("/ping", async (_req, res, next) => {
        try {
            const status = getVertexStatus();
            const localRouter = getLocalRouterStatus();
            if (!status.enabled) {
                return res.json({
                    ok: true,
                    vertex: "disabled",
                    reason: status.reason ?? "heuristics-only",
                    localRouter,
                });
            }

            const text = await tryGenerateGeminiText("ping", "ping");
            if (!text) {
                const nextStatus = getVertexStatus();
                return res.json({
                    ok: true,
                    vertex: "fallback",
                    reason: nextStatus.enabled ? "empty-response" : (nextStatus.reason ?? "unavailable"),
                    text,
                    localRouter,
                });
            }

            res.json({ ok: true, vertex: "ready", text, localRouter });
        } catch (error) {
            next(error);
        }
    });

    router.get("/tools", (_req, res) => {
        const config = getAgentToolsConfig();
        res.json({
            ok: true,
            version: config.version,
            abilities: config.abilities,
            tools: config.tools,
            enabledTools: getEnabledToolsForPrompt(config),
        });
    });

    router.get("/threads", async (req, res, next) => {
        try {
            const ctx = (req as AuthedRequest).ctx;
            const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 20)));
            const offset = Math.max(0, Number(req.query.offset ?? 0));

            const rows = await (await getClient())
                .db(dbName)
                .collection<SessionDoc>("ai_sessions")
                .find({ tenantId: ctx.tenantId, userId: ctx.user.id })
                .sort({ updatedAt: -1 })
                .skip(offset)
                .limit(limit)
                .toArray();

            res.json({
                threads: rows.map((session) => ({
                    id: session.sessionId,
                    title: getSessionTitle(session.messages || []),
                    updatedAt: session.updatedAt,
                })),
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/threads/:threadId/messages", async (req, res, next) => {
        try {
            const ctx = (req as AuthedRequest).ctx;
            const threadId = String(req.params.threadId || "").trim();
            if (!threadId) return res.status(400).json({ error: "Missing threadId" });

            const row = await (await getClient()).db(dbName).collection<SessionDoc>("ai_sessions").findOne({
                tenantId: ctx.tenantId,
                userId: ctx.user.id,
                sessionId: threadId,
            });

            if (!row) return res.json({ messages: [] });

            const messages = row.messages.map((message, index) => ({
                id: `${threadId}-${index + 1}`,
                role: message.role === "model" ? "agent" : "user",
                content: message.text,
                createdAt: message.ts,
            }));

            res.json({ messages });
        } catch (error) {
            next(error);
        }
    });

    router.delete("/threads/:threadId", async (req, res, next) => {
        try {
            const ctx = (req as AuthedRequest).ctx;
            const threadId = String(req.params.threadId || "").trim();
            if (!threadId) return res.status(400).json({ error: "Missing threadId" });

            await (await getClient()).db(dbName).collection<SessionDoc>("ai_sessions").deleteOne({
                tenantId: ctx.tenantId,
                userId: ctx.user.id,
                sessionId: threadId,
            });

            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    router.post("/chat/stream", async (req, res, next) => {
        try {
            const traceId = newTraceId();
            const text = String(req.body?.text || "").trim();
            const threadId = typeof req.body?.threadId === "string" ? req.body.threadId : undefined;
            if (!text) return res.status(400).json({ error: "Missing text" });

            const ctx = (req as AuthedRequest).ctx;
            traceLog(traceId, "route.chat_stream.request", {
                tenantId: ctx.tenantId,
                threadId: threadId ?? null,
                text: previewText(text),
            });
            const result = await runChatTurn(traceId, getClient, dbName, ctx, text, threadId);

            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.flushHeaders?.();

            writeSse(res, "meta", { threadId: result.threadId, threadTitle: result.threadTitle });
            writeSse(res, "done", {
                threadId: result.threadId,
                threadTitle: result.threadTitle,
                text: result.replyText,
                result: result.result,
                overview: result.overview,
            });
            res.end();
        } catch (error) {
            traceError("stream", "route.chat_stream.error", error);
            try {
                writeSse(res, "error", {
                    message: error instanceof Error ? error.message : "Streaming failed",
                });
                res.end();
            } catch {
                next(error);
            }
        }
    });

    router.post("/chat", async (req, res, next) => {
        try {
            const traceId = newTraceId();
            const text = String(req.body?.text || "").trim();
            const threadId = typeof req.body?.threadId === "string"
                ? req.body.threadId
                : typeof req.body?.sessionId === "string"
                    ? req.body.sessionId
                    : undefined;

            if (!text) return res.status(400).json({ error: "Missing text" });

            const ctx = (req as AuthedRequest).ctx;
            traceLog(traceId, "route.chat.request", {
                tenantId: ctx.tenantId,
                threadId: threadId ?? null,
                text: previewText(text),
            });
            const result = await runChatTurn(traceId, getClient, dbName, ctx, text, threadId);
            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
