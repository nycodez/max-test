// apps/runtime-ui/src/voice/VoiceController.tsx
import { useEffect, useRef, useState } from "react";
import { useMicLevel } from "./useMicLevel";
import { useSpeechToText } from "./useSpeechToText";
import { useTextToSpeech } from "./useTextToSpeech";
import { useTranscript } from "./TranscriptContext";
import { useElevenTTS } from "./useElevenTTS";

export type OnUserTextResult = string | { replyText?: string; speak?: boolean };
export type VoiceControllerProps = {
    enabled?: boolean;
    onUserText?: (text: string, skipTranscript?: boolean) => Promise<OnUserTextResult> | OnUserTextResult;
    speakAssistant?: boolean;   // default true
    allowBargeIn?: boolean;     // default true
};

export default function VoiceController({
                                            enabled = true,
                                            onUserText,
                                            speakAssistant = true,
                                            allowBargeIn = true,
                                        }: VoiceControllerProps) {
    const API = (import.meta as any).env?.VITE_API_URL || "http://localhost:8080";
    const tts = useElevenTTS(API);
    const sttEnabled = enabled && !tts.speaking;
    const stt = useSpeechToText(sttEnabled);

    const { level } = useMicLevel(enabled);
    const transcript = useTranscript();

    // ======== De-dupe / in-flight guards (NEW) ========
    const inflightRef = useRef(false);
    const lastSendRef = useRef<{ text: string; ts: number } | null>(null);
    const DUP_WINDOW_MS = 1500; // 1.5s

    function shouldDropDuplicate(text: string) {
        const now = Date.now();
        const last = lastSendRef.current;
        if (!last) return false;
        if (last.text === text && now - last.ts < DUP_WINDOW_MS) return true;
        return false;
    }
    // ===================================================

    // ---- Smarter VAD controls ----
    const VAD_HIGH = 0.22;
    const VAD_LOW  = 0.12;
    const SUSTAIN_MS = 180;
    const COOLDOWN_MS = 180;
    const TTS_GRACE_MS = 900;
    const POST_TTS_STT_DELAY_MS = 200;

    const [userTalking, setUserTalking] = useState(false);
    const lastTtsStartRef = useRef<number>(0);
    const hotAccumRef = useRef<number>(0);
    const coolAccumRef = useRef<number>(0);
    const lastFrameRef = useRef<number>(performance.now());
    const emaRef = useRef<number>(0);

    // EMA smoothing for mic level
    useEffect(() => {
        const now = performance.now();
        const dt = Math.max(0, now - lastFrameRef.current);
        lastFrameRef.current = now;
        const alpha = 0.35;
        emaRef.current = alpha * level + (1 - alpha) * emaRef.current;
        const x = emaRef.current;

        if (userTalking) {
            if (x < VAD_LOW) {
                coolAccumRef.current += dt;
                if (coolAccumRef.current >= COOLDOWN_MS) {
                    setUserTalking(false);
                    coolAccumRef.current = 0;
                    hotAccumRef.current = 0;
                }
            } else {
                coolAccumRef.current = 0;
            }
        } else {
            if (x > VAD_HIGH) {
                hotAccumRef.current += dt;
                if (hotAccumRef.current >= SUSTAIN_MS) {
                    setUserTalking(true);
                    hotAccumRef.current = 0;
                    coolAccumRef.current = 0;
                }
            } else {
                hotAccumRef.current = 0;
            }
        }
    }, [level, userTalking]);

    // Publish partials into overlay
    useEffect(() => {
        transcript.setPartial(stt.partial || "");
    }, [stt.partial]);

    // Barge-in logic
    useEffect(() => {
        if (!allowBargeIn) return;
        if (!userTalking) return;
        if (!sttEnabled) return;

        const now = Date.now();
        const sinceTtsStart = now - lastTtsStartRef.current;
        const inTtsGrace = sinceTtsStart < TTS_GRACE_MS;

        if (tts.speaking && !inTtsGrace) {
            tts.stop();
        }
    }, [userTalking, sttEnabled, tts.speaking, allowBargeIn]);

    // When user finishes: send to AI → push reply → optionally speak
    useEffect(() => {
        const final = stt.finalText?.trim();
        if (!final) return;

        // Clear immediately to avoid re-processing same final
        stt.clearFinal();

        // Drop duplicate finals within the window
        if (shouldDropDuplicate(final)) return;

        // If a previous turn is still in-flight, ignore this one (prevents double send)
        if (inflightRef.current) return;
        inflightRef.current = true;
        lastSendRef.current = { text: final, ts: Date.now() };

        transcript.pushUser(final);

        (async () => {
            try {
                const result = await onUserText?.(final, true); // skipTranscript=true to avoid duplication
                const reply =
                    typeof result === "string" ? result : (result?.replyText ?? "Okay.");
                const shouldSpeak =
                    typeof result === "object" && "speak" in (result ?? {})
                        ? !!result!.speak
                        : speakAssistant;

                transcript.pushAssistant(reply);

                if (reply && shouldSpeak) {
                    lastTtsStartRef.current = Date.now();
                    await tts.say(reply, {
                        // voiceId: "<override>",
                        // modelId: "eleven_multilingual_v2",
                        // voice_settings: { stability: 0.4, similarity_boost: 0.7, style: 0.3, use_speaker_boost: true },
                    });
                }
            } finally {
                // small delay to absorb any trailing duplicate finals
                setTimeout(() => { inflightRef.current = false; }, 150);
            }
        })();
    }, [stt.finalText]); // NOTE: keep deps tight so it only runs when finalText changes

    // Small post-TTS delay before flipping STT back on
    useEffect(() => {
        if (!tts.speaking) {
            const id = setTimeout(() => {}, POST_TTS_STT_DELAY_MS);
            return () => clearTimeout(id);
        }
    }, [tts.speaking]);

    return (
        <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 30 }}>
            <div
                style={{
                    width: 12, height: 12, borderRadius: 9999,
                    background: userTalking ? "#22d3ee" : "rgba(255,255,255,0.35)",
                    boxShadow: userTalking ? "0 0 12px rgba(34,211,238,.8)" : "none",
                    transition: "all .12s ease"
                }}
                title={userTalking ? "Listening..." : "Idle"}
            />
        </div>
    );
}
