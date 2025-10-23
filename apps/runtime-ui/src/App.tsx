import React from "react";
import MaxStage from "./components/MaxStage";
import { VisualProvider, useVisuals } from "./visuals/VisualProvider";
import VisualOverlay from "./visuals/VisualOverlay";
import ChatDock from "./components/ChatDock";
import VoiceController from "./voice/VoiceController";
import { TranscriptProvider, useTranscript } from "./voice/TranscriptContext";
import MicTranscriptOverlay from "./components/MicTranscriptOverlay";

const ACCENT = import.meta.env.VITE_TENANT_COLOR ?? "#7C3AED";
const API = import.meta.env.VITE_API_URL || "http://localhost:8080";

// 🔹 Unified backend call that handles reply + visuals
async function askBackend(text: string, sessionId: string) {
    const res = await fetch(`${API}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sessionId }),
    });

    const data = await res.json();
    return {
        replyText: data.replyText ?? "Okay.",
        visual: data.visual ?? null,
    };
}

function useSessionId() {
    const key = "maxSessionId";
    const v = localStorage.getItem(key);
    if (v) return v;
    const n = Math.random().toString(36).slice(2);
    localStorage.setItem(key, n);
    return n;
}

export default function App() {
    const sessionId = useSessionId();

    return (
        <TranscriptProvider>
            <VisualProvider>
                <AppContent sessionId={sessionId} />
                <VisualOverlay />
            </VisualProvider>
        </TranscriptProvider>
    );
}

// Create a separate component that can use hooks safely
function AppContent({ sessionId }: { sessionId: string }) {
    const transcript = useTranscript();
    const { show: showVisual } = useVisuals();

    // 🧠 Handles user text from ChatDock *and* from VoiceController
    async function processUserText(text: string) {
        transcript.pushUser(text);

        const { replyText, visual } = await askBackend(text, sessionId);

        transcript.pushAssistant(replyText);
        if (visual) showVisual(visual); // show image/video in modal

        // Return reply to VoiceController so it can speak it
        return { replyText, speak: true };
    }

    return (
        <>
            <MaxStage accentHex={ACCENT} />
            <ChatDock onSend={(t) => processUserText(t)} />
            <VoiceController onUserText={processUserText} speakAssistant={true} />
            <MicTranscriptOverlay />
        </>
    );
}
