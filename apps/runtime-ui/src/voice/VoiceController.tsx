import { useEffect, useRef, useState } from "react";
import { useMicLevel } from "./useMicLevel";
import { useSpeechToText } from "./useSpeechToText";
import { useTextToSpeech } from "./useTextToSpeech";
import { useTranscript } from "./TranscriptContext"; // <— add

export type VoiceControllerProps = {
    enabled?: boolean;
    onUserText?: (text: string) => Promise<string | { replyText?: string; speak?: boolean }> | string | { replyText?: string; speak?: boolean };
    speakAssistant?: boolean;
};

export default function VoiceController({ enabled = true, onUserText }: VoiceControllerProps) {
    const { level } = useMicLevel(enabled);
    const stt = useSpeechToText(enabled);
    const tts = useTextToSpeech();
    const [vadTalking, setVadTalking] = useState(false);
    const transcript = useTranscript(); // <— add

    useEffect(() => {
        if (!stt.finalText) return;
        const text = stt.finalText;
        transcript.pushFinal(text);
        stt.clearFinal();

        (async () => {
            const result = await onUserText?.(text);
            const reply = typeof result === "string" ? result : result?.replyText;
            const shouldSpeak = typeof result === "object" && "speak" in result
                ? !!result.speak
                : speakAssistant; // default behavior

            if (reply && shouldSpeak) {
                setTimeout(() => tts.say(reply), 150);
            }
            // If you also show the reply as text somewhere, do that here
        })();
    }, [stt.finalText]);

    // Simple VAD: if RMS > threshold for a bit, consider talking
    useEffect(() => {
        const th = 0.12; // tweak
        setVadTalking(level > th);
        if (level > th && tts.speaking) tts.stop(); // barge-in
    }, [level, tts]);

    // When we get a final STT result, send to agent, speak the reply
    // useEffect(() => {
    //     if (!stt.finalText) return;
    //     const text = stt.finalText;
    //     transcript.pushFinal(text);       // <— add
    //     stt.clearFinal();
    //     (async () => {
    //         const assistant = (await onUserText?.(text)) ?? "Okay.";
    //         // small delay to avoid cutting off tail of user speech
    //         setTimeout(() => tts.say(assistant), 150);
    //     })();
    // }, [stt.finalText]);

    // Optional UI indicator (tiny dot)
    return (
        <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 30 }}>
            <div style={{
                width: 12, height: 12, borderRadius: 9999,
                background: vadTalking ? "#22d3ee" : "rgba(255,255,255,0.35)",
                boxShadow: vadTalking ? "0 0 12px rgba(34,211,238,.8)" : "none",
                transition: "all .12s ease"
            }} title={vadTalking ? "Listening..." : "Idle"} />
        </div>
    );
}
