import { useCallback, useMemo, useRef, useState } from "react";

export function useServerTTS(apiBase: string) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const urlRef = useRef<string | null>(null);
    const fetchAbort = useRef<AbortController | null>(null);
    const [speaking, setSpeaking] = useState(false);

    const cleanup = useCallback(() => {
        try {
            audioRef.current?.pause();
            if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        } catch {
            // No-op cleanup path.
        }
        audioRef.current = null;
        urlRef.current = null;
        fetchAbort.current?.abort();
        fetchAbort.current = null;
        setSpeaking(false);
    }, []);

    const stop = useCallback(() => {
        cleanup();
    }, [cleanup]);

    const say = useCallback(async (text: string, opts?: {
        voice?: string;
        rate?: number;
        pitch?: number;
        allowFallback?: boolean;
    }) => {
        cleanup();
        setSpeaking(true);

        const ac = new AbortController();
        fetchAbort.current = ac;

        const response = await fetch(`${apiBase}/tts/speak`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text,
                provider: "google",
                allowFallback: opts?.allowFallback ?? true,
                voice: opts?.voice,
                rate: opts?.rate,
                pitch: opts?.pitch,
            }),
            signal: ac.signal,
        });

        if (!response.ok) {
            setSpeaking(false);
            const err = await response.json().catch(() => ({}));
            throw new Error(err?.error || "TTS request failed");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;

        return new Promise<void>((resolve, reject) => {
            const done = () => { cleanup(); resolve(); };
            const fail = (error: unknown) => { cleanup(); reject(error); };

            audio.addEventListener("ended", done, { once: true });
            audio.addEventListener("error", fail, { once: true });
            audio.play().catch(fail);
        });
    }, [apiBase, cleanup]);

    return useMemo(() => ({ say, stop, speaking }), [say, stop, speaking]);
}
