// mongo-init/init.js
// Runs automatically on first container start.
// Creates DB "crm" and the core per-tenant indexes.

(function () {
    const dbName = 'crm';
    const db = db.getSiblingDB(dbName);

    function idx(coll, keys, opts = {}) {
        db[coll].createIndex(keys, opts);
    }

    // ---------------------------
    // META COLLECTIONS
    // ---------------------------
    // Each meta doc MUST include: tenantId, version, active, createdAt, updatedAt, createdBy, updatedBy.

    // MODELS
    // Fast lookup by tenant+name+active (only one active model per name per tenant)
    idx('models', { tenantId: 1, name: 1, active: 1 }, { partialFilterExpression: { active: true }, unique: true, name: 'tenant_name_active_unique' });
    // Version history / admin screens
    idx('models', { tenantId: 1, name: 1, version: -1 }, { name: 'tenant_name_version' });
    // Basic tenant scans
    idx('models', { tenantId: 1, updatedAt: -1 }, { name: 'tenant_updatedAt' });

    // FORMS
    idx('forms', { tenantId: 1, id: 1, active: 1 }, { partialFilterExpression: { active: true }, unique: true, name: 'tenant_formId_active_unique' });
    idx('forms', { tenantId: 1, id: 1, version: -1 }, { name: 'tenant_formId_version' });

    // ACTIONS
    idx('actions', { tenantId: 1, id: 1, active: 1 }, { partialFilterExpression: { active: true }, unique: true, name: 'tenant_actionId_active_unique' });
    idx('actions', { tenantId: 1, id: 1, version: -1 }, { name: 'tenant_actionId_version' });

    // WORKFLOWS
    idx('workflows', { tenantId: 1, id: 1, active: 1 }, { partialFilterExpression: { active: true }, unique: true, name: 'tenant_workflowId_active_unique' });
    idx('workflows', { tenantId: 1, id: 1, version: -1 }, { name: 'tenant_workflowId_version' });

    // POLICIES
    idx('policies', { tenantId: 1, id: 1, active: 1 }, { partialFilterExpression: { active: true }, unique: true, name: 'tenant_policyId_active_unique' });
    idx('policies', { tenantId: 1, id: 1, version: -1 }, { name: 'tenant_policyId_version' });

    // COMPONENTS
    idx('components', { tenantId: 1, id: 1, active: 1 }, { partialFilterExpression: { active: true }, unique: true, name: 'tenant_componentId_active_unique' });
    idx('components', { tenantId: 1, id: 1, version: -1 }, { name: 'tenant_componentId_version' });

    // PROMPTS (optional meta used by the agent)
    idx('prompts', { tenantId: 1, id: 1, active: 1 }, { partialFilterExpression: { active: true }, unique: true, name: 'tenant_promptId_active_unique' });
    idx('prompts', { tenantId: 1, id: 1, version: -1 }, { name: 'tenant_promptId_version' });

    // SCRIPTS (sandboxed user code)
    idx('scripts', { tenantId: 1, id: 1, active: 1 }, { partialFilterExpression: { active: true }, unique: true, name: 'tenant_scriptId_active_unique' });
    idx('scripts', { tenantId: 1, id: 1, version: -1 }, { name: 'tenant_scriptId_version' });

    // ---------------------------
    // EVENT / AUDIT STORE
    // ---------------------------
    // Append-only audit trail for all writes and action executions
    idx('event_store', { tenantId: 1, ts: -1 }, { name: 'tenant_ts' });
    idx('event_store', { tenantId: 1, type: 1, ts: -1 }, { name: 'tenant_type_ts' });
    // If you later add a retention policy, use a TTL index on an archival shadow collection (not on primary events).

    // ---------------------------
    // EXAMPLE CONTENT COLLECTION INDEXES
    // ---------------------------
    // Content collections are dynamic (defined by models). Here are examples you can re-use when you create them.

    // Deals
    idx('deal_records', { tenantId: 1, stage: 1, updatedAt: -1 }, { name: 'deal_stage_recent' });
    idx('deal_records', { tenantId: 1, ownerId: 1, updatedAt: -1 }, { name: 'deal_owner_recent' });
    // optional text search if you will use it:
    // db.deal_records.createIndex({ tenantId: 1, name: "text", notes: "text" }, { name: "deal_text" });

    // Contacts
    idx('contact_records', { tenantId: 1, email: 1 }, { name: 'contact_email' });
    idx('contact_records', { tenantId: 1, updatedAt: -1 }, { name: 'contact_recent' });

    print(`[mongo-init] Initialized database '${dbName}' with core indexes.`);
})();
