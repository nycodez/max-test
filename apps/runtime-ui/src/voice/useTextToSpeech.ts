import { useEffect, useRef, useState } from "react";

export function useTextToSpeech() {
    const [speaking, setSpeaking] = useState(false);
    const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

    useEffect(() => {
        const h = () => setSpeaking(window.speechSynthesis.speaking);
        const id = setInterval(h, 120);
        return () => clearInterval(id);
    }, []);

    function say(text: string, opts?: { rate?: number; pitch?: number; voice?: string }) {
        window.speechSynthesis.cancel(); // stop any ongoing speech
        const u = new SpeechSynthesisUtterance(text);
        u.rate = opts?.rate ?? 1.02;
        u.pitch = opts?.pitch ?? 1.0;
        u.volume = 1.0;
        if (opts?.voice) {
            const v = speechSynthesis.getVoices().find(v => v.name === opts.voice);
            if (v) u.voice = v;
        }
        u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
        utterRef.current = u;
        setSpeaking(true);
        window.speechSynthesis.speak(u);
    }

    function stop() {
        window.speechSynthesis.cancel();
        setSpeaking(false);
    }

    return { speaking, say, stop };
}
