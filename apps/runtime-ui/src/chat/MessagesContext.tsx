import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type ChatRole = "user" | "assistant" | "system";
export type ChatMsg = { id: string; role: ChatRole; text: string; ts: number };

type Ctx = {
    messages: ChatMsg[];
    add: (role: ChatRole, text: string) => ChatMsg;
    clear: () => void;
};

const C = createContext<Ctx | null>(null);

export function MessagesProvider({ children }: { children: React.ReactNode }) {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const idRef = useRef(0);

    const add = useCallback((role: ChatRole, text: string) => {
        const msg: ChatMsg = { id: String(++idRef.current), role, text, ts: Date.now() };
        setMessages(m => [...m, msg]);
        return msg;
    }, []);

    const clear = useCallback(() => setMessages([]), []);

    const value = useMemo(() => ({ messages, add, clear }), [messages, add, clear]);
    return <C.Provider value={value}>{children}</C.Provider>;
}

export function useMessages() {
    const ctx = useContext(C);
    if (!ctx) throw new Error("useMessages must be used inside <MessagesProvider>");
    return ctx;
}
