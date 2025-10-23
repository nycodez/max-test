import { useCallback, useMemo, useRef, useState } from "react";

export function useElevenTTS(apiBase: string) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const urlRef = useRef<string | null>(null);
    const fetchAbort = useRef<AbortController | null>(null);
    const [speaking, setSpeaking] = useState(false);

    const cleanup = useCallback(() => {
        try {
            audioRef.current?.pause();
            if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        } catch {}
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
        voiceId?: string;
        modelId?: string;
        voice_settings?: { stability?: number; similarity_boost?: number; style?: number; use_speaker_boost?: boolean };
    }) => {
        cleanup(); // stop anything in-flight
        setSpeaking(true);

        const ac = new AbortController();
        fetchAbort.current = ac;

        const r = await fetch(`${apiBase}/tts/eleven`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, ...opts }),
            signal: ac.signal,
        });
        if (!r.ok) {
            setSpeaking(false);
            const err = await r.json().catch(() => ({}));
            throw new Error(err?.error || "TTS request failed");
        }

        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;

        return new Promise<void>((resolve, reject) => {
            const done = () => { cleanup(); resolve(); };
            const fail = (e: any) => { cleanup(); reject(e); };

            audio.addEventListener("ended", done, { once: true });
            audio.addEventListener("error", fail, { once: true });

            audio.play().catch(fail);
        });
    }, [apiBase, cleanup]);

    return useMemo(() => ({ say, stop, speaking }), [say, stop, speaking]);
}
