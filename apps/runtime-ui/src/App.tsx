import MaxStage from "./components/MaxStage";
import { VisualProvider, useVisuals } from "./visuals/VisualProvider";
import VisualOverlay from "./visuals/VisualOverlay";
import ChatDock from "./components/ChatDock";
import VoiceController from "./voice/VoiceController";
import { TranscriptProvider } from "./voice/TranscriptContext";
import MicTranscriptOverlay from "./components/MicTranscriptOverlay";
import React from "react";

const ACCENT = "#7C3AED";
const API = "http://localhost:8080";

class Boundary extends React.Component<{children: React.ReactNode},{err?: any}> {
    state = { err: null as any };
    static getDerivedStateFromError(err: any){ return { err }; }
    render(){
        if (this.state.err) return (
            <div style={{color:"#fff", background:"#111", padding:20}}>
                <h3>UI crashed</h3>
                <pre style={{whiteSpace:"pre-wrap"}}>{String(this.state.err?.stack || this.state.err)}</pre>
            </div>
        );
        return this.props.children as any;
    }
}

export default function App() {
    const sessionId = ensureSessionId();

    async function handleUserText(text: string) {
        const r = await fetch(`${API}/ai/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, sessionId }),
        });
        const data = await r.json();
        // Optionally pop visuals if model asked for one
        if (data.visual) {
            // example shape: {type:"image", url:"..."} or {type:"youtube", id:"..."}
            // you'll need to call useVisuals().show(...) from inside a component; simple approach:
            (window as any).__pendingVisual = data.visual;
            const evt = new CustomEvent("max-visual"); window.dispatchEvent(evt);
        }
        return { replyText: data.replyText, speak: false }; // no TTS echo
    }

    // a small bridge to trigger VisualOverlay from anywhere (optional)
    function VisualBridge() {
        const { show } = useVisuals();
        React.useEffect(() => {
            const on = () => {
                const v = (window as any).__pendingVisual;
                if (v) { show(v); (window as any).__pendingVisual = null; }
            };
            window.addEventListener("max-visual", on);
            return () => window.removeEventListener("max-visual", on);
        }, [show]);
        return null;
    }

    return (
        <Boundary>
            <TranscriptProvider>
                <VisualProvider>
                    <MaxStage accentHex={ACCENT} />
                    <VisualOverlay />
                    <VisualBridge />
                    <ChatDock onSend={handleUserText} />
                    <VoiceController onUserText={handleUserText} />
                    <MicTranscriptOverlay />
                </VisualProvider>
            </TranscriptProvider>
        </Boundary>
    );
}

function ensureSessionId() {
    const k = "maxSessionId";
    const v = localStorage.getItem(k);
    if (v) return v;
    const n = Math.random().toString(36).slice(2);
    localStorage.setItem(k, n);
    return n;
}
