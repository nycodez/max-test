export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8080";
const DEV_BEARER_TOKEN = import.meta.env.VITE_BEARER_TOKEN || "";

export type ChatMessage = {
    id: string;
    role: "user" | "agent";
    content: string;
    createdAt: string;
};

export type ThreadSummary = {
    id: string;
    title: string;
    updatedAt: string;
};

export type ContactRecord = {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    companyName?: string;
    status: "lead" | "active";
    notes?: string;
    updatedAt: string;
};

export type CompanyRecord = {
    id: string;
    name: string;
    website?: string;
    industry?: string;
    notes?: string;
    updatedAt: string;
};

export type TaskRecord = {
    id: string;
    title: string;
    details?: string;
    dueDate?: string;
    status: "open" | "in_progress" | "done";
    priority: "low" | "medium" | "high";
    contactName?: string;
    companyName?: string;
    updatedAt: string;
};

export type AssistantAction =
    | { type: "none" }
    | { type: "create_contact"; name: string; email?: string; phone?: string; companyName?: string; notes?: string }
    | { type: "create_company"; name: string; website?: string; industry?: string; notes?: string }
    | { type: "create_task"; title: string; details?: string; dueDate?: string; priority?: "low" | "medium" | "high"; contactName?: string; companyName?: string }
    | { type: "list_contacts"; query?: string; limit?: number }
    | { type: "list_companies"; query?: string; limit?: number }
    | { type: "list_tasks"; status?: "open" | "in_progress" | "done"; limit?: number };

export type AssistantActionResult =
    | { type: "none" }
    | { type: "contact_created"; record: ContactRecord }
    | { type: "company_created"; record: CompanyRecord }
    | { type: "task_created"; record: TaskRecord }
    | { type: "contacts_list"; records: ContactRecord[]; total: number }
    | { type: "companies_list"; records: CompanyRecord[]; total: number }
    | { type: "tasks_list"; records: TaskRecord[]; total: number };

export type CrmOverview = {
    counts: {
        contacts: number;
        companies: number;
        openTasks: number;
    };
    recentContacts: ContactRecord[];
    recentCompanies: CompanyRecord[];
    recentTasks: TaskRecord[];
};

export type ChatResponse = {
    threadId: string;
    threadTitle: string;
    replyText: string;
    action: AssistantAction;
    result: AssistantActionResult;
    overview: CrmOverview;
    visual: null;
};

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers || {});
    if (!headers.has("Content-Type") && init.body) {
        headers.set("Content-Type", "application/json");
    }
    if (DEV_BEARER_TOKEN) {
        headers.set("Authorization", `Bearer ${DEV_BEARER_TOKEN}`);
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || `${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
}

export function fetchOverview() {
    return apiFetch<CrmOverview>("/crm/overview");
}

export async function fetchThreads() {
    const data = await apiFetch<{ threads: ThreadSummary[] }>("/ai/threads");
    return data.threads;
}

export async function fetchThreadMessages(threadId: string) {
    const data = await apiFetch<{ messages: ChatMessage[] }>(`/ai/threads/${encodeURIComponent(threadId)}/messages`);
    return data.messages;
}

export function chatWithMax(payload: { text: string; threadId?: string }) {
    return apiFetch<ChatResponse>("/ai/chat", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}
