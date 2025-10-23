// apps/runtime-ui/src/components/AiFaceGSAP.tsx
import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import gsap from "gsap";
import MaxHeadSVG, { MaxHeadRef } from "./MaxHeadSVG";

export type AiFaceGsapRef = {
    speak(level?: number): void;
    setAccent(hex: string): void;
    pause(): void;
    resume(): void;
};

const AiFaceGSAP = forwardRef<AiFaceGsapRef, { size?: number | string; accentHex?: string; className?: string }>(
    function AiFaceGSAP({ size = 520, accentHex = "#22D3EE", className }, ref) {
        const faceRef = useRef<MaxHeadRef>(null);
        const svgRoot = useRef<SVGSVGElement | null>(null);

        useImperativeHandle(ref, () => ({
            speak(level = 0.6) { faceRef.current?.setMouth(level); },
            setAccent(hex: string) { document.documentElement.style.setProperty("--ai-accent", hex); },
            pause() { gsap.globalTimeline.pause(); },
            resume() { gsap.globalTimeline.resume(); },
        }));

        useEffect(() => {
            document.documentElement.style.setProperty("--ai-accent", accentHex);
            return () => document.documentElement.style.setProperty("--ai-accent", "#22D3EE");
        }, [accentHex]);

        useEffect(() => {
            if (!svgRoot.current) return;
            // basic idle tilt
            const head = svgRoot.current.querySelector("#head");
            gsap.to(head, {
                rotation: 3, transformOrigin: "200px 200px",
                duration: 2.4, yoyo: true, repeat: -1, ease: "sine.inOut"
            });
            // subtle pupil wander
            const pupils = svgRoot.current.querySelector("#pupils");
            gsap.to(pupils, {
                x: () => gsap.utils.random(-4, 4),
                y: () => gsap.utils.random(-3, 3),
                duration: () => gsap.utils.random(1.2, 2),
                repeat: -1, yoyo: true, ease: "sine.inOut"
            });
        }, []);

        return (
            <div ref={(wrapper) => { svgRoot.current = wrapper?.querySelector("svg") || null; }}>
                <MaxHeadSVG ref={faceRef} size={size} accentHex={accentHex} className={className} />
            </div>
        );
    });
export default AiFaceGSAP;
