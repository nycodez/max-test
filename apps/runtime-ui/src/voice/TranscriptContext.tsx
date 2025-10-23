import React, { createContext, useContext, useMemo, useState } from "react";

export type TranscriptItem = { text: string; ts: number };
type Ctx = {
    partial: string;
    history: TranscriptItem[];
    setPartial: (s: string) => void;
    pushFinal: (s: string) => void;
    clear: () => void;
};

const TranscriptCtx = createContext<Ctx | null>(null);

export function TranscriptProvider({ children }: { children: React.ReactNode }) {
    const [partial, setPartial] = useState("");
    const [history, setHistory] = useState<TranscriptItem[]>([]);
    const api = useMemo<Ctx>(() => ({
        partial,
        history,
        setPartial,
        pushFinal: (s) => setHistory(h => [{ text: s, ts: Date.now() }, ...h].slice(0, 8)),
        clear: () => { setPartial(""); setHistory([]); }
    }), [partial, history]);
    return <TranscriptCtx.Provider value={api}>{children}</TranscriptCtx.Provider>;
}

export function useTranscript() {
    const ctx = useContext(TranscriptCtx);
    if (!ctx) throw new Error("useTranscript must be used inside <TranscriptProvider>");
    return ctx;
}
