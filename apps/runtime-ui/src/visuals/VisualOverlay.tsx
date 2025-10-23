import { useEffect, useState } from "react";
import { useVisuals } from "./VisualProvider";

export default function VisualOverlay() {
    const { visual, clear } = useVisuals();
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (visual && visual.type !== "none") {
            setVisible(true);
        } else {
            setVisible(false);
        }
    }, [visual]);

    if (!visible || !visual) return null;

    return (
        <div
            aria-live="polite"
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 10,
                display: "grid",
                placeItems: "center",
                background: "rgba(0,0,0,0.62)",
                backdropFilter: "blur(2px)",
                animation: "fadeIn 160ms ease-out",
            }}
            onClick={clear} // click-to-dismiss; swap for a close button if you prefer
        >
            <div
                role="dialog"
                aria-label="Assistant visual"
                style={{
                    maxWidth: "min(92vw, 1200px)",
                    maxHeight: "82vh",
                    width: "auto",
                    background: "rgba(12,12,16,0.9)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 14,
                    overflow: "hidden",
                    boxShadow: "0 18px 64px rgba(0,0,0,0.45)",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {visual.type === "image" && (
                    <img src={visual.url} alt={visual.alt || "visual"} style={{ display: "block", maxWidth: "100%", maxHeight: "82vh" }} />
                )}

                {visual.type === "youtube" && (
                    <div style={{ position: "relative", width: "min(92vw, 1200px)", aspectRatio: "16/9" }}>
                        <iframe
                            width="100%"
                            height="100%"
                            src={`https://www.youtube.com/embed/${visual.id}?autoplay=1${visual.start ? `&start=${visual.start}` : ""}`}
                            title="YouTube video player"
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    </div>
                )}

                {visual.type === "html" && (
                    <div
                        style={{ padding: 16, color: "#e5e7eb" }}
                        dangerouslySetInnerHTML={{ __html: visual.html }}
                    />
                )}

                {visual.type === "chart" && (
                    <div style={{ padding: 16, color: "#e5e7eb" }}>
                        <p style={{ opacity: 0.8, margin: 0 }}>Chart goes here (wire your lib to `visual.spec`).</p>
                    </div>
                )}
            </div>
        </div>
    );
}
