import React, { createContext, useContext, useMemo, useState } from "react";

export type Visual =
    | { type: "none" }
    | { type: "image"; url: string; alt?: string }
    | { type: "youtube"; id: string; start?: number }
    | { type: "html"; html: string };

type Ctx = { visual: Visual | null; show(v: Visual): void; clear(): void; };

const VisualCtx = createContext<Ctx | null>(null);

export function VisualProvider({ children }: { children: React.ReactNode }) {
    const [visual, setVisual] = useState<Visual | null>(null);
    const api = useMemo<Ctx>(() => ({ visual, show: setVisual, clear: () => setVisual(null) }), [visual]);
    return <VisualCtx.Provider value={api}>{children}</VisualCtx.Provider>;
}
export function useVisuals() {
    const ctx = useContext(VisualCtx); if (!ctx) throw new Error("useVisuals must be inside VisualProvider");
    return ctx;
}
