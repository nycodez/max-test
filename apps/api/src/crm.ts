import { Db, Filter, ObjectId } from "mongodb";
import type { ReqCtx } from "@crm/auth";

export type ContactStatus = "lead" | "active";
export type TaskStatus = "open" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

type CrmDocBase = {
    _id?: ObjectId;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    updatedBy: string;
};

type CompanyDoc = CrmDocBase & {
    name: string;
    website?: string;
    industry?: string;
    notes?: string;
};

type ContactDoc = CrmDocBase & {
    name: string;
    email?: string;
    phone?: string;
    companyName?: string;
    status: ContactStatus;
    notes?: string;
};

type TaskDoc = CrmDocBase & {
    title: string;
    details?: string;
    dueDate?: string;
    status: TaskStatus;
    priority: TaskPriority;
    contactName?: string;
    companyName?: string;
};

export type CompanyRecord = {
    id: string;
    name: string;
    website?: string;
    industry?: string;
    notes?: string;
    updatedAt: string;
};

export type ContactRecord = {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    companyName?: string;
    status: ContactStatus;
    notes?: string;
    updatedAt: string;
};

export type TaskRecord = {
    id: string;
    title: string;
    details?: string;
    dueDate?: string;
    status: TaskStatus;
    priority: TaskPriority;
    contactName?: string;
    companyName?: string;
    updatedAt: string;
};

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

export type AssistantAction =
    | { type: "none" }
    | { type: "create_contact"; name: string; email?: string; phone?: string; companyName?: string; notes?: string }
    | { type: "create_company"; name: string; website?: string; industry?: string; notes?: string }
    | { type: "create_task"; title: string; details?: string; dueDate?: string; priority?: TaskPriority; contactName?: string; companyName?: string }
    | { type: "list_contacts"; query?: string; limit?: number }
    | { type: "list_companies"; query?: string; limit?: number }
    | { type: "list_tasks"; status?: TaskStatus; limit?: number };

export type AssistantActionResult =
    | { type: "none" }
    | { type: "contact_created"; record: ContactRecord }
    | { type: "company_created"; record: CompanyRecord }
    | { type: "task_created"; record: TaskRecord }
    | { type: "contacts_list"; records: ContactRecord[]; total: number }
    | { type: "companies_list"; records: CompanyRecord[]; total: number }
    | { type: "tasks_list"; records: TaskRecord[]; total: number };

let indexesPromise: Promise<void> | null = null;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function searchRegex(query?: string): RegExp | null {
    const normalized = query?.trim();
    if (!normalized) return null;
    return new RegExp(escapeRegExp(normalized), "i");
}

function withBaseFields<T extends Record<string, unknown>>(ctx: ReqCtx, payload: T) {
    const now = new Date().toISOString();
    return {
        ...payload,
        tenantId: ctx.tenantId,
        createdAt: now,
        updatedAt: now,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
    };
}

function toCompanyRecord(doc: CompanyDoc): CompanyRecord {
    return {
        id: String(doc._id),
        name: doc.name,
        website: doc.website,
        industry: doc.industry,
        notes: doc.notes,
        updatedAt: doc.updatedAt,
    };
}

function toContactRecord(doc: ContactDoc): ContactRecord {
    return {
        id: String(doc._id),
        name: doc.name,
        email: doc.email,
        phone: doc.phone,
        companyName: doc.companyName,
        status: doc.status,
        notes: doc.notes,
        updatedAt: doc.updatedAt,
    };
}

function toTaskRecord(doc: TaskDoc): TaskRecord {
    return {
        id: String(doc._id),
        title: doc.title,
        details: doc.details,
        dueDate: doc.dueDate,
        status: doc.status,
        priority: doc.priority,
        contactName: doc.contactName,
        companyName: doc.companyName,
        updatedAt: doc.updatedAt,
    };
}

export async function ensureCrmIndexes(db: Db): Promise<void> {
    if (!indexesPromise) {
        indexesPromise = Promise.all([
            db.collection<CompanyDoc>("crm_companies").createIndex({ tenantId: 1, name: 1 }),
            db.collection<CompanyDoc>("crm_companies").createIndex({ tenantId: 1, updatedAt: -1 }),
            db.collection<ContactDoc>("crm_contacts").createIndex({ tenantId: 1, email: 1 }, { sparse: true }),
            db.collection<ContactDoc>("crm_contacts").createIndex({ tenantId: 1, name: 1 }),
            db.collection<ContactDoc>("crm_contacts").createIndex({ tenantId: 1, updatedAt: -1 }),
            db.collection<TaskDoc>("crm_tasks").createIndex({ tenantId: 1, status: 1, updatedAt: -1 }),
            db.collection<TaskDoc>("crm_tasks").createIndex({ tenantId: 1, priority: 1, updatedAt: -1 }),
            db.collection<TaskDoc>("crm_tasks").createIndex({ tenantId: 1, updatedAt: -1 }),
        ]).then(() => undefined);
    }

    await indexesPromise;
}

export async function createCompany(db: Db, ctx: ReqCtx, input: {
    name: string;
    website?: string;
    industry?: string;
    notes?: string;
}): Promise<CompanyRecord> {
    const companies = db.collection<CompanyDoc>("crm_companies");
    const doc = withBaseFields(ctx, {
        name: input.name.trim(),
        website: input.website?.trim(),
        industry: input.industry?.trim(),
        notes: input.notes?.trim(),
    });

    const inserted = await companies.insertOne(doc);
    return toCompanyRecord({ ...doc, _id: inserted.insertedId });
}

export async function createContact(db: Db, ctx: ReqCtx, input: {
    name: string;
    email?: string;
    phone?: string;
    companyName?: string;
    status?: ContactStatus;
    notes?: string;
}): Promise<ContactRecord> {
    const contacts = db.collection<ContactDoc>("crm_contacts");
    const doc = withBaseFields(ctx, {
        name: input.name.trim(),
        email: input.email?.trim().toLowerCase(),
        phone: input.phone?.trim(),
        companyName: input.companyName?.trim(),
        status: input.status ?? "lead",
        notes: input.notes?.trim(),
    });

    const inserted = await contacts.insertOne(doc);
    return toContactRecord({ ...doc, _id: inserted.insertedId });
}

export async function createTask(db: Db, ctx: ReqCtx, input: {
    title: string;
    details?: string;
    dueDate?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    contactName?: string;
    companyName?: string;
}): Promise<TaskRecord> {
    const tasks = db.collection<TaskDoc>("crm_tasks");
    const doc = withBaseFields(ctx, {
        title: input.title.trim(),
        details: input.details?.trim(),
        dueDate: input.dueDate?.trim(),
        status: input.status ?? "open",
        priority: input.priority ?? "medium",
        contactName: input.contactName?.trim(),
        companyName: input.companyName?.trim(),
    });

    const inserted = await tasks.insertOne(doc);
    return toTaskRecord({ ...doc, _id: inserted.insertedId });
}

export async function listContacts(db: Db, ctx: ReqCtx, options: {
    query?: string;
    limit?: number;
} = {}): Promise<ContactRecord[]> {
    const contacts = db.collection<ContactDoc>("crm_contacts");
    const query = searchRegex(options.query);
    const filter: Filter<ContactDoc> = {
        tenantId: ctx.tenantId,
        ...(query ? {
            $or: [
                { name: query },
                { email: query },
                { phone: query },
                { companyName: query },
            ],
        } : {}),
    };

    const rows = await contacts
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(Math.max(1, Math.min(50, options.limit ?? 8)))
        .toArray();

    return rows.map(toContactRecord);
}

export async function listCompanies(db: Db, ctx: ReqCtx, options: {
    query?: string;
    limit?: number;
} = {}): Promise<CompanyRecord[]> {
    const companies = db.collection<CompanyDoc>("crm_companies");
    const query = searchRegex(options.query);
    const filter: Filter<CompanyDoc> = {
        tenantId: ctx.tenantId,
        ...(query ? {
            $or: [
                { name: query },
                { website: query },
                { industry: query },
            ],
        } : {}),
    };

    const rows = await companies
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(Math.max(1, Math.min(50, options.limit ?? 8)))
        .toArray();

    return rows.map(toCompanyRecord);
}

export async function listTasks(db: Db, ctx: ReqCtx, options: {
    status?: TaskStatus;
    limit?: number;
} = {}): Promise<TaskRecord[]> {
    const tasks = db.collection<TaskDoc>("crm_tasks");
    const filter: Filter<TaskDoc> = {
        tenantId: ctx.tenantId,
        ...(options.status ? { status: options.status } : {}),
    };

    const rows = await tasks
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(Math.max(1, Math.min(50, options.limit ?? 8)))
        .toArray();

    return rows.map(toTaskRecord);
}

export async function getOverview(db: Db, ctx: ReqCtx): Promise<CrmOverview> {
    const companies = db.collection<CompanyDoc>("crm_companies");
    const contacts = db.collection<ContactDoc>("crm_contacts");
    const tasks = db.collection<TaskDoc>("crm_tasks");

    const [contactCount, companyCount, openTaskCount, recentContacts, recentCompanies, recentTasks] = await Promise.all([
        contacts.countDocuments({ tenantId: ctx.tenantId }),
        companies.countDocuments({ tenantId: ctx.tenantId }),
        tasks.countDocuments({ tenantId: ctx.tenantId, status: { $ne: "done" } }),
        contacts.find({ tenantId: ctx.tenantId }).sort({ updatedAt: -1 }).limit(5).toArray(),
        companies.find({ tenantId: ctx.tenantId }).sort({ updatedAt: -1 }).limit(5).toArray(),
        tasks.find({ tenantId: ctx.tenantId }).sort({ updatedAt: -1 }).limit(5).toArray(),
    ]);

    return {
        counts: {
            contacts: contactCount,
            companies: companyCount,
            openTasks: openTaskCount,
        },
        recentContacts: recentContacts.map(toContactRecord),
        recentCompanies: recentCompanies.map(toCompanyRecord),
        recentTasks: recentTasks.map(toTaskRecord),
    };
}

export async function executeAssistantAction(db: Db, ctx: ReqCtx, action: AssistantAction): Promise<AssistantActionResult> {
    switch (action.type) {
        case "none":
            return { type: "none" };
        case "create_contact":
            return { type: "contact_created", record: await createContact(db, ctx, action) };
        case "create_company":
            return { type: "company_created", record: await createCompany(db, ctx, action) };
        case "create_task":
            return { type: "task_created", record: await createTask(db, ctx, action) };
        case "list_contacts": {
            const records = await listContacts(db, ctx, action);
            return { type: "contacts_list", records, total: records.length };
        }
        case "list_companies": {
            const records = await listCompanies(db, ctx, action);
            return { type: "companies_list", records, total: records.length };
        }
        case "list_tasks": {
            const records = await listTasks(db, ctx, action);
            return { type: "tasks_list", records, total: records.length };
        }
    }
}

