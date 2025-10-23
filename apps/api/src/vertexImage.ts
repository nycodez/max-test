import { VertexAI } from "@google-cloud/vertexai";

// Force Imagen location to us-central1 (supported region)
const IMAGE_LOCATION = "us-central1";

const vertex = new VertexAI({
    project: process.env.VERTEX_PROJECT!,
    location: IMAGE_LOCATION,
});

export async function generateImage(prompt: string) {
    // Cast to any because typings don't expose generateImages()
    const model = vertex.getGenerativeModel({ model: "imagen-3.0-fast" }) as any;

    try {
        const result = await model.generateImages({ prompt });
        const img = result?.response?.images?.[0]?.bytesBase64;
        if (!img) throw new Error("No image generated");
        return `data:image/png;base64,${img}`;
    } catch (e: any) {
        // Helpful log: shows which region we tried
        console.error(`[Imagen] project=${process.env.VERTEX_PROJECT} location=${IMAGE_LOCATION}`, e);
        throw e;
    }
}
