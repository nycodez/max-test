import { MongoClient, Collection } from "mongodb";
import type { ReqCtx } from "@crm/auth";

let client: MongoClient;
export async function getClient(uri: string) {
    if (!client) client = new MongoClient(uri);
    if (!client.topology?.isConnected()) await client.connect();
    return client;
}

export function tcol<T = any>(dbName: string, colName: string, ctx: ReqCtx, client: MongoClient): Collection<T> {
    // we return the raw collection but consumers MUST always inject tenant filter via helpers below
    return client.db(dbName).collection<T>(colName);
}

// helpers that enforce tenant safety
export async function findMany<T>(col: Collection<T>, ctx: ReqCtx, query: any, options: any = {}) {
    return col.find({ tenantId: ctx.tenantId, ...query }, options).toArray();
}
export async function findOne<T>(col: Collection<T>, ctx: ReqCtx, query: any) {
    return col.findOne({ tenantId: ctx.tenantId, ...query });
}
export async function insertOne<T>(col: Collection<T>, ctx: ReqCtx, doc: any) {
    const now = new Date().toISOString();
    const stamped = { ...doc, tenantId: ctx.tenantId, createdAt: now, updatedAt: now };
    return col.insertOne(stamped);
}
export async function updateOne<T>(col: Collection<T>, ctx: ReqCtx, query: any, update: any) {
    return col.updateOne({ tenantId: ctx.tenantId, ...query }, { ...update, $set: { "updatedAt": new Date().toISOString() } });
}
