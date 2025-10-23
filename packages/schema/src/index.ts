export type Id = string;
export type TenantId = string;

export interface BaseDoc {
    _id?: Id;
    tenantId: TenantId;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    updatedBy: string;
    version: number;
    active: boolean;
}

// Minimal ModelDef to start
export interface ModelDef extends BaseDoc {
    name: string;              // e.g., "Deal"
    collection: string;        // e.g., "deal_records"
    fields: Array<{ name: string; type: string; required?: boolean; refModel?: string }>;
    indexes?: Array<{ keys: Record<string, 1 | -1 | "text"> }>;
    policies?: { read?: any; write?: any }; // JSONLogic to keep it simple for Phase 1
}

export const ModelDefSchema = {
    type: "object",
    required: ["name", "collection", "fields"],
    additionalProperties: true
};
