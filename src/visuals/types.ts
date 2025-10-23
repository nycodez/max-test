export type VisualPayload =
    | { type: "image"; url: string; caption?: string }
    | { type: "video"; url: string; caption?: string }
    | { type: "youtube"; id: string; caption?: string };
