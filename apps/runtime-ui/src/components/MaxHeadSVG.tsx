import React, { forwardRef, useImperativeHandle, useRef } from "react";

export type MaxHeadRef = {
    setMouth(open: number): void;       // 0..1
    setPupil(x: number, y: number): void; // -1..1
    setTilt(deg: number): void;         // degrees
};

export default forwardRef<MaxHeadRef, { size?: number | string; accentHex?: string; className?: string }>(
    function MaxHeadSVG({ size = 520, accentHex = "#22D3EE", className }, ref) {
        const root = useRef<SVGSVGElement>(null);
        const mouth = useRef<SVGRectElement>(null);
        const pupils = useRef<SVGGElement>(null);
        const head = useRef<SVGGElement>(null);

        useImperativeHandle(ref, () => ({
            setMouth(open: number) {
                const clamp = Math.max(0, Math.min(1, open));
                const h = 3 + clamp * 10;                 // thin bar → wider when “speaking”
                const y = 228 - h / 2;
                mouth.current?.setAttribute("height", `${h}`);
                mouth.current?.setAttribute("y", `${y}`);
                mouth.current?.setAttribute("rx", `${Math.min(3, h / 2)}`);
            },
            setPupil(x: number, y: number) {
                const px = Math.max(-1, Math.min(1, x)) * 5;
                const py = Math.max(-1, Math.min(1, y)) * 3.5;
                pupils.current?.setAttribute("transform", `translate(${px}, ${py})`);
            },
            setTilt(deg: number) {
                head.current?.setAttribute("transform", `rotate(${deg} 200 200)`);
            }
        }), []);

        return (
            <svg
                ref={root}
                viewBox="0 0 400 400"
                width={typeof size === "number" ? size : undefined}
                height={typeof size === "number" ? size : undefined}
                className={className}
                style={{ width: size }}
                role="img"
                aria-label="Max-like AI head"
            >
                <defs>
                    {/* Plasticky “studio” skin + hard rim light */}
                    <radialGradient id="skin" cx="50%" cy="35%" r="65%">
                        <stop offset="0%" stopColor="#2b2b2b" />
                        <stop offset="80%" stopColor="#141414" />
                        <stop offset="100%" stopColor="#0a0a0a" />
                    </radialGradient>
                    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={accentHex} stopOpacity="0.95" />
                        <stop offset="60%" stopColor={accentHex} stopOpacity="0.25" />
                        <stop offset="100%" stopColor={accentHex} stopOpacity="0" />
                    </linearGradient>
                    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="2.1" result="b" />
                        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                </defs>

                {/* CRT frame */}
                <g opacity="0.28">
                    <rect x="30" y="34" width="340" height="332" rx="10" fill="none" stroke={accentHex} strokeWidth="2"/>
                    <rect x="44" y="48" width="312" height="304" rx="8" fill="none" stroke={accentHex} strokeOpacity=".35" />
                </g>

                {/* Background halo */}
                <g opacity=".18" filter="url(#glow)">
                    <ellipse cx="200" cy="185" rx="170" ry="150" fill={accentHex} />
                </g>

                {/* HEAD GROUP (tilt target) */}
                <g id="head" ref={head}>
                    {/* Hair: rigid, combed-back planes */}
                    <g id="hair" filter="url(#glow)">
                        <path
                            d="M118 145 L150 94 L200 80 L250 94 L282 145 L272 158 L256 142 L200 130 L144 142 L128 158 Z"
                            fill="#1a1a1a"
                            stroke="url(#rim)" strokeWidth="2"
                        />
                        {/* comb lines */}
                        {Array.from({ length: 8 }).map((_, i) => {
                            const x1 = 152 + i * 12;
                            const x2 = 248 - i * 12;
                            return <line key={i} x1={x1} y1="112" x2={x2} y2="100" stroke={accentHex} strokeOpacity=".22" />;
                        })}
                    </g>

                    {/* Jaw: square, angular */}
                    <g id="skull" filter="url(#glow)">
                        <path
                            d="
              M130 150
              L130 220
              L150 270
              L250 270
              L270 220
              L270 150
              L250 120
              L150 120 Z
            "
                            fill="url(#skin)"
                            stroke="url(#rim)" strokeWidth="2.2"
                        />
                        {/* cheek ridges */}
                        <polyline points="150,180 170,190 150,205" fill="none" stroke={accentHex} strokeOpacity=".35" />
                        <polyline points="250,180 230,190 250,205" fill="none" stroke={accentHex} strokeOpacity=".35" />
                    </g>

                    {/* Brows (hard) */}
                    <g id="brow" stroke={accentHex} strokeWidth="3" strokeOpacity=".85">
                        <path d="M148 176 L190 170" />
                        <path d="M210 170 L252 176" />
                    </g>

                    {/* Eyes: slit + tiny pupil bars (move as a group) */}
                    <g id="eyes">
                        <rect x="156" y="186" width="32" height="4" rx="2" fill={accentHex} />
                        <rect x="212" y="186" width="32" height="4" rx="2" fill={accentHex} />
                        <g id="pupils" ref={pupils}>
                            <rect x="170" y="187" width="6" height="2" rx="1" fill="#0a0a0a"/>
                            <rect x="224" y="187" width="6" height="2" rx="1" fill="#0a0a0a"/>
                        </g>
                    </g>

                    {/* Nose crease */}
                    <path d="M200 188 L198 205" stroke={accentHex} strokeOpacity=".3" />

                    {/* Mouth (thin bar, animates height) */}
                    <rect ref={mouth} x="184" y="226" width="32" height="3" rx="1.5" fill={accentHex} opacity=".85" />

                    {/* Suit collar & tie */}
                    <g id="suit">
                        {/* shirt */}
                        <polygon points="175,270 225,270 200,305" fill="#d9d9d9" opacity=".9"/>
                        {/* lapels */}
                        <polygon points="150,270 177,270 145,315 130,300" fill="#0f0f10" />
                        <polygon points="250,270 223,270 255,315 270,300" fill="#0f0f10" />
                        {/* tie */}
                        <polygon points="195,270 205,270 202,305 198,305" fill="#111" />
                    </g>

                    {/* Face grid (retro wireframe) */}
                    <g id="grid" stroke={accentHex} strokeOpacity=".12" strokeWidth="1">
                        {Array.from({ length: 7 }).map((_, i) => {
                            const y = 145 + i * 18;
                            return <line key={`h${i}`} x1="142" y1={y} x2="258" y2={y} />;
                        })}
                        {Array.from({ length: 8 }).map((_, i) => {
                            const x = 152 + i * 12;
                            return <line key={`v${i}`} x1={x} y1="140" x2={x} y2="270" />;
                        })}
                    </g>
                </g>
            </svg>
        );
    });
