import { createContext, useContext, useState, ReactNode } from "react";
import { VisualPayload } from "./types";

type VisualCtx = {
    visual: VisualPayload | null;
    showVisual: (v: VisualPayload) => void;
    clearVisual: () => void;
};

const Context = createContext<VisualCtx>({
    visual: null,
    showVisual: () => {},
    clearVisual: () => {},
});

export const VisualProvider = ({ children }: { children: ReactNode }) => {
    const [visual, setVisual] = useState<VisualPayload | null>(null);

    const showVisual = (v: VisualPayload) => setVisual(v);
    const clearVisual = () => setVisual(null);

    return (
        <Context.Provider value={{ visual, showVisual, clearVisual }}>
            {children}
        </Context.Provider>
    );
};

export const useVisual = () => useContext(Context);
