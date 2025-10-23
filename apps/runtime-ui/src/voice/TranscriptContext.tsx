import React, { createContext, useContext, useMemo, useState } from "react";

export type TranscriptItem = { role: "user" | "assistant"; text: string; ts: number };

type Ctx = {
    partial: string;                      // live mic partial (user)
    history: TranscriptItem[];            // recent utterances (user + assistant)
    setPartial: (s: string) => void;
    pushUser: (s: string) => void;
    pushAssistant: (s: string) => void;
    clear: () => void;
};

const TranscriptCtx = createContext<Ctx | null>(null);

export function TranscriptProvider({ children }: { children: React.ReactNode }) {
    const [partial, setPartial] = useState("");
    const [history, setHistory] = useState<TranscriptItem[]>([]);

    function push(role: "user" | "assistant", text: string) {
        setHistory(h => [{ role, text, ts: Date.now() }, ...h].slice(0, 12));
    }

    const api = useMemo<Ctx>(() => ({
        partial,
        history,
        setPartial,
        pushUser: (s) => push("user", s),
        pushAssistant: (s) => push("assistant", s),
        clear: () => { setPartial(""); setHistory([]); },
    }), [partial, history]);

    return <TranscriptCtx.Provider value={api}>{children}</TranscriptCtx.Provider>;
}

export function useTranscript() {
    const ctx = useContext(TranscriptCtx);
    if (!ctx) throw new Error("useTranscript must be used inside <TranscriptProvider>");
    return ctx;
}
