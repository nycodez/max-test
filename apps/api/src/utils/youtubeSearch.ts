export async function searchYouTube(query: string): Promise<string | null> {
    const key = process.env.YT_API_KEY;
    if (!key) throw new Error("Missing YT_API_KEY");

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "id");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "1");
    url.searchParams.set("q", query);
    url.searchParams.set("key", key);

    const r = await fetch(url.toString());
    if (!r.ok) {
        const err = await r.text().catch(() => "");
        throw new Error(`YouTube HTTP ${r.status}: ${err || r.statusText}`);
    }
    const data = (await r.json()) as { items?: Array<{ id?: { videoId?: string } }> };
    return data.items?.[0]?.id?.videoId ?? null;
}
