import { useEffect, useRef, useState } from "react";

export function useMicLevel(enabled: boolean) {
    const [level, setLevel] = useState(0);
    const stopRef = useRef<() => void>();

    useEffect(() => {
        let ctx: AudioContext | null = null;
        let analyser: AnalyserNode | null = null;
        let raf = 0;
        let src: MediaStreamAudioSourceNode | null = null;
        let stream: MediaStream | null = null;
        let data: Uint8Array;

        async function start() {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
            ctx = new AudioContext();
            src = ctx.createMediaStreamSource(stream);
            analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            src.connect(analyser);
            data = new Uint8Array(analyser.frequencyBinCount);

            const tick = () => {
                analyser!.getByteTimeDomainData(data);
                let sum = 0;
                for (let i = 0; i < data.length; i++) {
                    const v = (data[i] - 128) / 128;
                    sum += v * v;
                }
                const rms = Math.sqrt(sum / data.length); // ~0..~0.5
                setLevel(Math.min(1, rms * 3));
                raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
        }

        if (enabled) start().catch(console.error);

        stopRef.current = () => {
            cancelAnimationFrame(raf);
            analyser?.disconnect();
            src?.disconnect();
            ctx?.close();
            stream?.getTracks().forEach(t => t.stop());
        };

        return () => stopRef.current?.();
    }, [enabled]);

    return { level, stop: () => stopRef.current?.() };
}
