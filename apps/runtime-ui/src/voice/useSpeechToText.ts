import { useEffect, useRef, useState } from "react";

type Recog = SpeechRecognition & { lang: string; interimResults: boolean; continuous: boolean };

export function useSpeechToText(enabled: boolean) {
    const [hearing, setHearing] = useState(false);
    const [partial, setPartial] = useState<string>("");
    const [finalText, setFinalText] = useState<string | null>(null);
    const recogRef = useRef<Recog | null>(null);

    useEffect(() => {
        const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
        if (!SR) {
            console.warn("Web Speech API not supported in this browser");
            return;
        }
        const r: Recog = new SR();
        r.lang = "en-US";              // set locale as needed
        r.interimResults = true;
        r.continuous = true;

        r.onresult = (e: SpeechRecognitionEvent) => {
            let interim = "";
            let finalChunk = "";
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const res = e.results[i];
                if (res.isFinal) finalChunk += res[0].transcript;
                else interim += res[0].transcript;
            }
            if (interim) setPartial(interim);
            if (finalChunk) {
                setFinalText(finalChunk.trim());
                setPartial("");
            }
        };
        r.onstart = () => setHearing(true);
        r.onend = () => setHearing(false);
        r.onerror = (e) => console.warn("STT error:", e);

        recogRef.current = r;
    }, []);

    useEffect(() => {
        const r = recogRef.current;
        if (!r) return;
        if (enabled && !hearing) {
            try { r.start(); } catch {}
        }
        if (!enabled && hearing) {
            try { r.stop(); } catch {}
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    return {
        hearing,
        partial,
        finalText,    // will briefly be set to the final utterance, then you should clear it
        clearFinal: () => setFinalText(null),
        stop: () => recogRef.current?.stop(),
        start: () => recogRef.current?.start(),
    };
}
