import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Props = {
    onSend?: (text: string) => void;
    placeholder?: string;
    maxHeightPx?: number; // max textarea height when auto-resizing
};

export default function ChatDock({
                                     onSend,
                                     placeholder = "Ask Max…",
                                     maxHeightPx = 160,
                                 }: Props) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const hoverZoneRef = useRef<HTMLDivElement>(null);

    // auto-resize textarea
    const autosize = useCallback(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = "auto";
        const h = Math.min(el.scrollHeight, maxHeightPx);
        el.style.height = h + "px";
    }, [maxHeightPx]);

    useEffect(() => autosize(), [text, autosize]);

    // open when mouse hits bottom 24px; close when mouse leaves dock area
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            const vh = window.innerHeight;
            const bottomZone = 24; // px from bottom to trigger
            if (!open && vh - e.clientY <= bottomZone) setOpen(true);
        };
        window.addEventListener("mousemove", onMove);
        return () => window.removeEventListener("mousemove", onMove);
    }, [open]);

    // close on ESC
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // focus input when opened
    useEffect(() => {
        if (open) {
            const id = setTimeout(() => inputRef.current?.focus(), 50);
            return () => clearTimeout(id);
        }
    }, [open]);

    const send = useCallback(() => {
        const v = text.trim();
        if (!v) return;
        onSend?.(v);
        setText("");
        setOpen(false); // or keep open if you prefer
    }, [text, onSend]);

    const containerStyle = useMemo<React.CSSProperties>(() => ({
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        pointerEvents: "none", // only inner elements capture
    }), []);

    const panelStyle = useMemo<React.CSSProperties>(() => ({
        margin: "0 auto",
        maxWidth: "min(1200px, 96vw)",
        transform: open ? "translateY(0)" : "translateY(90%)",
        opacity: open ? 1 : 0,
        transition: "transform 180ms ease, opacity 180ms ease",
        pointerEvents: "auto",
        background: "rgba(15,15,20,0.82)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderBottom: "none",
        borderRadius: "16px 16px 0 0",
        boxShadow: "0 -12px 40px rgba(0,0,0,0.45)",
        backdropFilter: "blur(6px)",
    }), [open]);

    const rowStyle: React.CSSProperties = {
        display: "flex",
        alignItems: "flex-end",
        gap: 10,
        padding: "12px 12px 14px 12px",
    };

    const textareaStyle: React.CSSProperties = {
        flex: 1,
        resize: "none",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.14)",
        color: "#e5e7eb",
        padding: "10px 12px",
        borderRadius: 12,
        lineHeight: 1.35,
        outline: "none",
        font: "14px/1.35 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
    };

    const btnStyle: React.CSSProperties = {
        appearance: "none",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "transparent",
        color: "#e5e7eb",
        padding: "10px 14px",
        borderRadius: 12,
        cursor: "pointer",
        font: "14px/1 ui-sans-serif, system-ui, -apple-system",
    };

    return (
        <div style={containerStyle} aria-live="polite">
            {/* invisible hover zone for touch to open */}
            <div
                ref={hoverZoneRef}
                onClick={() => setOpen(true)}
                style={{
                    position: "absolute",
                    left: 0, right: 0, bottom: 0,
                    height: 18,
                    pointerEvents: "auto",
                }}
                aria-hidden
            />

            {/* the sliding panel */}
            <div style={panelStyle}
                 role="form"
                 aria-label="Chat with Max"
                 onMouseLeave={(e) => {
                     // if we leave the panel and the mouse is not in bottom zone, close
                     const y = e.clientY;
                     const vh = window.innerHeight;
                     if (vh - y > 120) setOpen(false);
                 }}>
                {/* grab handle */}
                <div style={{ display: "grid", placeItems: "center", paddingTop: 8 }}>
                    <div style={{
                        width: 44, height: 4, borderRadius: 9999,
                        background: "rgba(255,255,255,0.25)"
                    }} />
                </div>

                <div style={rowStyle}>

                    <div style={{ display:"flex", gap:8, padding:"0 12px 8px 12px", flexWrap:"wrap" }}>
                        {["Show today’s pipeline", "Find hot leads", "Draft follow-up email"].map(s => (
                            <button key={s}
                                    onClick={() => setText(s)}
                                    style={{ pointerEvents:"auto", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)",
                                        borderRadius: 9999, padding:"6px 10px", color:"#d1d5db", fontSize:12, cursor:"pointer" }}>
                                {s}
                            </button>
                        ))}
                    </div>

                    <textarea
                      ref={inputRef}
                      rows={1}
                      placeholder={placeholder}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onInput={autosize}
                      onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "enter") {
                              e.preventDefault(); send();
                          }
                      }}
                      style={textareaStyle}
                  />
                    <button
                        onClick={send}
                        style={btnStyle}
                        aria-label="Send message"
                    >
                        Send ⏎
                    </button>
                </div>
            </div>
        </div>
    );
}
