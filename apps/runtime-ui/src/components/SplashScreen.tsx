import { useEffect, useState } from "react";
import AiFaceGSAP from "./AiFaceGSAP";

type Props = {
    accentHex?: string;
    onDone: () => void;
    showEnter?: boolean;     // optional "ENTER" button
    minMs?: number;          // minimum show time (ms), default 800
};

export default function SplashScreen({ accentHex = "#22D3EE", onDone, showEnter = true, minMs = 800 }: Props) {
    const [canClose, setCanClose] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setCanClose(true), minMs);
        return () => clearTimeout(t);
    }, [minMs]);

    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "radial-gradient(120% 80% at 50% 10%, rgba(255,255,255,0.06), transparent 60%), linear-gradient(#0b0b0f, #000)"
        }}>
            {/* simple scanlines */}
            <div style={{
                position: "absolute", inset: 0,
                background: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 2px, transparent 4px)",
                mixBlendMode: "overlay", pointerEvents: "none"
            }} />

            {/* center the face */}
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                <AiFaceGSAP size={520} accentHex={accentHex} />
            </div>

            {/* enter button */}
            {showEnter && (
                <div style={{ position: "absolute", bottom: "2.5rem", left: 0, right: 0, textAlign: "center" }}>
                    <button
                        onClick={() => { if (canClose) onDone(); }}
                        style={{
                            appearance: "none",
                            background: "transparent",
                            color: "#e6e6e6",
                            border: "1px solid rgba(255,255,255,.2)",
                            padding: ".65rem 1rem",
                            borderRadius: "12px",
                            cursor: canClose ? "pointer" : "not-allowed",
                            opacity: canClose ? 1 : 0.6
                        }}
                    >
                        ENTER
                    </button>
                </div>
            )}
        </div>
    );
}
