import * as fs from "fs";
import * as path from "path";

export type AgentToolMethod =
    | "local.weather_open_meteo"
    | "local.time_lookup"
    | "crm.list_contacts"
    | "crm.list_companies"
    | "crm.list_tasks"
    | "crm.create_contact"
    | "crm.create_company"
    | "crm.create_task";

export type AgentAbilityDefinition = {
    id: string;
    label: string;
    description?: string;
    enabled?: boolean;
};

export type AgentToolAccess = {
    method: AgentToolMethod;
    defaultLocation?: string;
    defaultTimezone?: string;
    defaultLocationLabel?: string;
    cityTimezones?: Record<string, string>;
};

export type AgentToolDefinition = {
    id: string;
    label: string;
    description: string;
    enabled?: boolean;
    triggers: string[];
    access: AgentToolAccess;
};

export type AgentToolsConfig = {
    version: number;
    abilities: AgentAbilityDefinition[];
    tools: AgentToolDefinition[];
};

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "../../../config/agent-tools.json");

const FALLBACK_CONFIG: AgentToolsConfig = {
    version: 1,
    abilities: [
        {
            id: "crm_core",
            label: "CRM Operations",
            description: "create and list contacts, companies, and tasks",
            enabled: true,
        },
        {
            id: "weather_live",
            label: "Live Weather",
            description: "answer live weather questions by city",
            enabled: true,
        },
        {
            id: "time_lookup",
            label: "Time Lookup",
            description: "answer current time questions by city or timezone",
            enabled: true,
        },
    ],
    tools: [
        {
            id: "weather_current",
            label: "Current Weather",
            description: "Get current weather using Open-Meteo",
            enabled: true,
            triggers: ["weather", "temperature", "forecast", "rain", "sunny", "cloudy", "wind"],
            access: {
                method: "local.weather_open_meteo",
                defaultLocation: "Austin, Texas",
            },
        },
        {
            id: "time_current",
            label: "Current Time",
            description: "Get current time for a place",
            enabled: true,
            triggers: ["what time", "current time", "time in", "time now"],
            access: {
                method: "local.time_lookup",
                defaultTimezone: "America/Chicago",
                defaultLocationLabel: "Austin, Texas",
                cityTimezones: {
                    "austin": "America/Chicago",
                    "austin texas": "America/Chicago",
                    "new york": "America/New_York",
                    "los angeles": "America/Los_Angeles",
                    "san francisco": "America/Los_Angeles",
                    "chicago": "America/Chicago",
                    "dallas": "America/Chicago",
                    "london": "Europe/London",
                    "paris": "Europe/Paris",
                    "kuala lumpur": "Asia/Kuala_Lumpur",
                    "singapore": "Asia/Singapore",
                    "tokyo": "Asia/Tokyo",
                },
            },
        },
        {
            id: "crm_create_contact",
            label: "Create Contact",
            description: "Create a CRM contact record",
            enabled: true,
            triggers: ["create contact", "add contact", "new contact"],
            access: { method: "crm.create_contact" },
        },
        {
            id: "crm_create_company",
            label: "Create Company",
            description: "Create a CRM company record",
            enabled: true,
            triggers: ["create company", "add company", "new company"],
            access: { method: "crm.create_company" },
        },
        {
            id: "crm_create_task",
            label: "Create Task",
            description: "Create a CRM task record",
            enabled: true,
            triggers: ["create task", "add task", "new task", "create follow up"],
            access: { method: "crm.create_task" },
        },
        {
            id: "crm_list_contacts",
            label: "List Contacts",
            description: "List CRM contacts",
            enabled: true,
            triggers: ["list contacts", "show contacts", "find contacts", "search contacts"],
            access: { method: "crm.list_contacts" },
        },
        {
            id: "crm_list_companies",
            label: "List Companies",
            description: "List CRM companies",
            enabled: true,
            triggers: ["list companies", "show companies", "find companies", "search companies"],
            access: { method: "crm.list_companies" },
        },
        {
            id: "crm_list_tasks",
            label: "List Tasks",
            description: "List CRM tasks",
            enabled: true,
            triggers: ["list tasks", "show tasks", "find tasks", "search tasks"],
            access: { method: "crm.list_tasks" },
        },
    ],
};

function normalizeText(value: string): string {
    return value.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMethod(value: unknown): AgentToolMethod | null {
    const method = String(value || "").trim();
    if (
        method === "local.weather_open_meteo"
        || method === "local.time_lookup"
        || method === "crm.list_contacts"
        || method === "crm.list_companies"
        || method === "crm.list_tasks"
        || method === "crm.create_contact"
        || method === "crm.create_company"
        || method === "crm.create_task"
    ) {
        return method;
    }
    return null;
}

function toCityTimezones(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const out: Record<string, string> = {};
    for (const [key, maybeTz] of Object.entries(value as Record<string, unknown>)) {
        const normalizedKey = normalizeText(String(key || ""));
        const tz = String(maybeTz || "").trim();
        if (!normalizedKey || !tz) continue;
        out[normalizedKey] = tz;
    }
    return Object.keys(out).length ? out : undefined;
}

function normalizeAbility(raw: unknown, index: number): AgentAbilityDefinition | null {
    if (!raw || typeof raw !== "object") return null;
    const source = raw as Record<string, unknown>;
    const label = String(source.label || source.description || "").trim();
    if (!label) return null;
    return {
        id: String(source.id || `ability_${index + 1}`).trim() || `ability_${index + 1}`,
        label,
        description: typeof source.description === "string" ? source.description.trim() : undefined,
        enabled: source.enabled !== false,
    };
}

function normalizeTool(raw: unknown, index: number): AgentToolDefinition | null {
    if (!raw || typeof raw !== "object") return null;
    const source = raw as Record<string, unknown>;
    const method = normalizeMethod((source.access as Record<string, unknown> | undefined)?.method ?? source.method);
    if (!method) return null;

    const triggers = Array.isArray(source.triggers)
        ? source.triggers.map((trigger) => normalizeText(String(trigger || ""))).filter(Boolean)
        : [];
    if (!triggers.length) return null;

    const label = String(source.label || source.id || "").trim();
    const description = String(source.description || label || "").trim();
    if (!label || !description) return null;

    const accessSource = (source.access && typeof source.access === "object")
        ? (source.access as Record<string, unknown>)
        : source;

    return {
        id: String(source.id || `tool_${index + 1}`).trim() || `tool_${index + 1}`,
        label,
        description,
        enabled: source.enabled !== false,
        triggers,
        access: {
            method,
            defaultLocation: typeof accessSource.defaultLocation === "string" ? accessSource.defaultLocation.trim() : undefined,
            defaultTimezone: typeof accessSource.defaultTimezone === "string" ? accessSource.defaultTimezone.trim() : undefined,
            defaultLocationLabel: typeof accessSource.defaultLocationLabel === "string" ? accessSource.defaultLocationLabel.trim() : undefined,
            cityTimezones: toCityTimezones(accessSource.cityTimezones),
        },
    };
}

function normalizeConfig(raw: unknown): AgentToolsConfig {
    if (!raw || typeof raw !== "object") return FALLBACK_CONFIG;
    const source = raw as Record<string, unknown>;
    const abilities = Array.isArray(source.abilities)
        ? source.abilities.map((item, index) => normalizeAbility(item, index)).filter((item): item is AgentAbilityDefinition => Boolean(item))
        : [];
    const tools = Array.isArray(source.tools)
        ? source.tools.map((item, index) => normalizeTool(item, index)).filter((item): item is AgentToolDefinition => Boolean(item))
        : [];

    return {
        version: Number(source.version) || 1,
        abilities: abilities.length ? abilities : FALLBACK_CONFIG.abilities,
        tools: tools.length ? tools : FALLBACK_CONFIG.tools,
    };
}

function readConfigPath(): string {
    const envPath = String(process.env.AGENT_TOOLS_CONFIG_PATH || "").trim();
    if (!envPath) return DEFAULT_CONFIG_PATH;
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
}

let cachePath = "";
let cacheMtimeMs = -1;
let cacheConfig: AgentToolsConfig | null = null;
let warnedMessage = "";

function warnOnce(message: string): void {
    if (warnedMessage === message) return;
    warnedMessage = message;
    console.warn(`[agent-tools] ${message}`);
}

export function getAgentToolsConfig(): AgentToolsConfig {
    const configPath = readConfigPath();
    try {
        const stat = fs.statSync(configPath);
        if (cacheConfig && cachePath === configPath && cacheMtimeMs === stat.mtimeMs) {
            return cacheConfig;
        }

        const raw = fs.readFileSync(configPath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        const normalized = normalizeConfig(parsed);
        cacheConfig = normalized;
        cachePath = configPath;
        cacheMtimeMs = stat.mtimeMs;
        warnedMessage = "";
        return normalized;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnOnce(`using fallback config because ${configPath} failed to load: ${message}`);
        cacheConfig = FALLBACK_CONFIG;
        cachePath = configPath;
        cacheMtimeMs = -1;
        return FALLBACK_CONFIG;
    }
}

function joinHumanList(items: string[]): string {
    if (!items.length) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function getAgentAbilitiesSummary(config = getAgentToolsConfig()): string {
    const abilities = config.abilities
        .filter((ability) => ability.enabled !== false)
        .map((ability) => ability.description || ability.label)
        .map((value) => value.trim())
        .filter(Boolean);

    return joinHumanList(abilities);
}

export function getEnabledToolsForPrompt(config = getAgentToolsConfig()): Array<{
    id: string;
    description: string;
    method: AgentToolMethod;
    triggers: string[];
}> {
    return config.tools
        .filter((tool) => tool.enabled !== false)
        .map((tool) => ({
            id: tool.id,
            description: tool.description,
            method: tool.access.method,
            triggers: tool.triggers,
        }));
}

export function matchAgentToolByText(text: string, config = getAgentToolsConfig()): AgentToolDefinition | null {
    const normalized = normalizeText(text);
    if (!normalized) return null;

    let winner: AgentToolDefinition | null = null;
    let winnerScore = -1;

    for (const tool of config.tools) {
        if (tool.enabled === false) continue;
        for (const trigger of tool.triggers) {
            const normalizedTrigger = normalizeText(trigger);
            if (!normalizedTrigger) continue;
            if (!normalized.includes(normalizedTrigger)) continue;
            const score = normalizedTrigger.length;
            if (score > winnerScore) {
                winner = tool;
                winnerScore = score;
            }
        }
    }

    return winner;
}
