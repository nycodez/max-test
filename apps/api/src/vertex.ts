import { VertexAI } from "@google-cloud/vertexai";

function must(k: string, d?: string) {
    const v = process.env[k] ?? d;
    if (!v) throw new Error(`Missing env ${k}`);
    return v;
}

export function getGemini() {
    const project   = must("VERTEX_PROJECT");
    const location  = must("VERTEX_LOCATION", "us-central1");
    const modelName = must("VERTEX_MODEL", "gemini-1.5-flash-002");
    const vertexAI  = new VertexAI({ project, location });
    return vertexAI.getGenerativeModel({
        model: modelName,
        generationConfig: { maxOutputTokens: 1024, temperature: 0.6, topP: 0.9 },
    });
}
