import { useEffect, useMemo, useState } from "react";
import { useTranscript } from "../voice/TranscriptContext";

export default function MicTranscriptOverlay() {
    const { partial, history, clear } = useTranscript();
    const [visible, setVisible] = useState(true);

    // Auto-dim when totally idle
    const isIdle = !partial && history.length === 0;

    const boxStyle = useMemo<React.CSSProperties>(() => ({
        position: "fixed",
        top: 14,
        right: 14,
        zIndex: 25,
        width: "min(36vw, 520px)",
        maxHeight: "40vh",
        overflow: "auto",
        background: "rgba(15,15,20,0.56)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 12,
        backdropFilter: "blur(6px)",
        boxShadow: "0 12px 36px rgba(0,0,0,0.45)",
        padding: 12,
        color: "#e5e7eb",
        font: "13px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
        opacity: visible ? 1 : 0.2,
        transition: "opacity .18s ease",
    }), [visible]);

    useEffect(() => {
        // show when there is activity; dim when idle
        if (partial || history.length) setVisible(true);
    }, [partial, history.length]);

    return (
        <div style={boxStyle} onMouseEnter={() => setVisible(true)} onMouseLeave={() => !partial && setVisible(false)}>
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{
                    width: 8, height: 8, borderRadius: 9999,
                    background: partial ? "#22d3ee" : "rgba(255,255,255,0.35)",
                    boxShadow: partial ? "0 0 10px rgba(34,211,238,.8)" : "none"
                }} />
                <div style={{ fontWeight: 600, fontSize: 12, opacity: 0.9 }}>Mic transcript</div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button onClick={clear} title="Clear" style={btn()}>Clear</button>
                    <button onClick={() => setVisible(v => !v)} title={visible ? "Dim" : "Show"} style={btn()}>
                        {visible ? "Dim" : "Show"}
                    </button>
                </div>
            </div>

            {/* live partial */}
            {partial && (
                <div style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "rgba(34,211,238,0.08)",
                    border: "1px solid rgba(34,211,238,0.25)",
                    marginBottom: 10
                }}>
                    {partial}
                </div>
            )}

            {/* history (last finals) */}
            {history.map((h) => (
                <div key={h.ts} style={{ opacity: 0.9, marginBottom: 6 }}>
                    {h.text}
                </div>
            ))}

            {isIdle && (
                <div style={{ opacity: 0.5, fontStyle: "italic" }}>
                    Say something to Max…
                </div>
            )}
        </div>
    );
}

function btn(): React.CSSProperties {
    return {
        appearance: "none",
        background: "transparent",
        color: "#e5e7eb",
        border: "1px solid rgba(255,255,255,0.18)",
        padding: "4px 8px",
        borderRadius: 8,
        fontSize: 12,
        cursor: "pointer"
    };
}
