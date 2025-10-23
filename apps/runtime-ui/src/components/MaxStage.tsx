// apps/runtime-ui/src/components/MaxStage.tsx
import { useEffect } from "react";
import { useMicLevel } from "../voice/useMicLevel";
import AiFaceGSAP from "./AiFaceGSAP";

export default function MaxStage({ accentHex = "#7C3AED" }: { accentHex?: string }) {
    const { level } = useMicLevel(true); // always listening for animation; you can gate this

    // expose a ref in AiFaceGSAP if you want direct .speak(level); or let GSAP idle.
    // If your AiFaceGSAP exposes ref as before:
    // const face = useRef<AiFaceGsapRef>(null);
    // useEffect(() => face.current?.speak(level), [level]);

    useEffect(() => {
        // If AiFaceGSAP doesn't have ref yet, you can later wire it.
    }, [level]);

    return (
        <div style={{ position: "fixed", inset: 0, background:
                "radial-gradient(120% 80% at 50% 10%, rgba(255,255,255,0.06), transparent 60%), linear-gradient(#0b0b0f, #000)" }}>
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                <AiFaceGSAP size={560} accentHex={accentHex} />
            </div>
            {/* scanlines */}
            <div style={{ position: "absolute", inset: 0, background:
                    "repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 2px, transparent 4px)",
                mixBlendMode: "overlay", pointerEvents: "none" }} />
        </div>
    );
}
