import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";

export type AiFaceRef = {
    setMouth(open: number): void;     // 0..1
    setPupil(x: number, y: number): void; // -1..1 offsets
    setTilt(deg: number): void;       // head tilt
};

type Props = {
    size?: number | string;           // px or css value
    accentHex?: string;               // rim light / neon
    strokeWidth?: number;
    className?: string;
    ariaLabel?: string;
};

const AiFaceSVG = forwardRef<AiFaceRef, Props>(function AiFaceSVG(
    { size = 420, accentHex = "#22D3EE", strokeWidth = 2, className, ariaLabel = "AI face" },
    ref
) {
    const root = useRef<SVGSVGElement>(null);
    const mouthRect = useRef<SVGRectElement>(null);
    const pupils = useRef<SVGGElement>(null);
    const head = useRef<SVGGElement>(null);

    // expose a tiny control surface for any animation lib
    useImperativeHandle(ref, () => ({
        setMouth(open: number) {
            const h = 6 + Math.max(0, Math.min(1, open)) * 12;
            mouthRect.current?.setAttribute("height", `${h}`);
            mouthRect.current?.setAttribute("y", `${226 - h / 2}`);
            mouthRect.current?.setAttribute("rx", `${Math.max(3, h / 3)}`);
        },
        setPupil(x: number, y: number) {
            const clx = Math.max(-1, Math.min(1, x));
            const cly = Math.max(-1, Math.min(1, y));
            const px = clx * 6; // movement range
            const py = cly * 4;
            pupils.current?.setAttribute("transform", `translate(${px}, ${py})`);
        },
        setTilt(deg: number) {
            head.current?.setAttribute("transform", `rotate(${deg} 200 200)`);
        },
    }), []);

    const sizeStyle = useMemo(() => ({ width: size, height: typeof size === "number" ? size : undefined }), [size]);

    return (
        <svg
            ref={root}
            viewBox="0 0 400 400"
            role="img"
            aria-label={ariaLabel}
            className={className}
            style={sizeStyle}
        >
            <defs>
                <radialGradient id="skin" cx="50%" cy="35%" r="65%">
                    <stop offset="0%" stopColor="#3a3a3a" />
                    <stop offset="100%" stopColor="#141414" />
                </radialGradient>
                <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={accentHex} stopOpacity="0.9" />
                    <stop offset="60%" stopColor={accentHex} stopOpacity="0.2" />
                    <stop offset="100%" stopColor={accentHex} stopOpacity="0" />
                </linearGradient>
                <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b"/>
                    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
            </defs>

            {/* backdrop halo for neon vibe */}
            <g id="halo" opacity="0.22" filter="url(#glow)">
                <ellipse cx="200" cy="180" rx="160" ry="150" fill={accentHex} />
            </g>

            {/* head & neck group (target with setTilt) */}
            <g id="head" ref={head}>
                {/* neck / base */}
                <g id="neck">
                    <rect x="152" y="292" width="96" height="18" fill="#0b0b0b" opacity="0.6" />
                    <rect x="120" y="312" width="160" height="12" fill="#0b0b0b" opacity="0.35" />
                </g>

                {/* skull / face silhouette */}
                <g id="skull" filter="url(#glow)">
                    <path
                        d="M200 72
               C 168 84, 130 114, 122 152
               C 113 188, 118 225, 136 256
               C 150 279, 150 300, 150 300
               L 250 300
               C 250 300, 250 279, 264 256
               C 282 225, 287 188, 278 152
               C 270 114, 232 84, 200 72 Z"
                        fill="url(#skin)"
                        stroke="url(#rim)"
                        strokeWidth={strokeWidth}
                    />
                </g>

                {/* brows */}
                <g id="brow" stroke={accentHex} strokeOpacity="0.7" strokeWidth={strokeWidth}>
                    <path d="M150 176 L188 172" />
                    <path d="M212 172 L250 176" />
                </g>

                {/* eyes + pupils in a sub-group so we can translate pupils */}
                <g id="eyes">
                    <rect x="156" y="184" width="32" height="6" rx="3" fill={accentHex} opacity="0.95" />
                    <rect x="212" y="184" width="32" height="6" rx="3" fill={accentHex} opacity="0.95" />
                    <g id="pupils" ref={pupils}>
                        <rect x="168" y="186" width="8" height="2.5" rx="1.25" fill="#0a0a0a" />
                        <rect x="224" y="186" width="8" height="2.5" rx="1.25" fill="#0a0a0a" />
                    </g>
                </g>

                {/* nose hint */}
                <path d="M198 196 C 200 206, 200 214, 196 220" stroke={accentHex} strokeOpacity="0.35" fill="none" />

                {/* mouth (animated by setMouth) */}
                <rect id="mouth" ref={mouthRect}
                      x="184" y="226" width="32" height="6" rx="3"
                      fill={accentHex} opacity="0.75"
                />

                {/* wireframe face lines (retro grid) */}
                <g id="grid" stroke={accentHex} strokeOpacity="0.12" strokeWidth="1">
                    {Array.from({ length: 8 }).map((_, i) => {
                        const y = 112 + i * 20;
                        return <line key={`h${i}`} x1="142" y1={y} x2="258" y2={y} />;
                    })}
                    {Array.from({ length: 8 }).map((_, i) => {
                        const x = 152 + i * 12;
                        return <line key={`v${i}`} x1={x} y1="108" x2={x} y2="280" />;
                    })}
                </g>
            </g>
        </svg>
    );
});

export default AiFaceSVG;
