import { useEffect, useMemo, useRef, useState } from "react";
import { chatWithMax, fetchOverview, fetchThreadMessages, fetchThreads, type AssistantActionResult, type ChatMessage, type CrmOverview, type ThreadSummary } from "./api";
import OperatorWorkspace from "./components/OperatorWorkspace";
import MaxStage from "./components/MaxStage";
import MicTranscriptOverlay from "./components/MicTranscriptOverlay";
import { TranscriptProvider, useTranscript } from "./voice/TranscriptContext";
import VoiceController from "./voice/VoiceController";
import { VisualProvider, useVisuals } from "./visuals/VisualProvider";
import VisualOverlay from "./visuals/VisualOverlay";

const ACCENT = import.meta.env.VITE_TENANT_COLOR ?? "#22D3EE";
const THREAD_STORAGE_KEY = "maxActiveThreadId";

function readStoredThreadId(): string | null {
    return localStorage.getItem(THREAD_STORAGE_KEY);
}

function writeStoredThreadId(threadId: string | null) {
    if (!threadId) {
        localStorage.removeItem(THREAD_STORAGE_KEY);
        return;
    }
    localStorage.setItem(THREAD_STORAGE_KEY, threadId);
}

export default function App() {
    return (
        <TranscriptProvider>
            <VisualProvider>
                <AppContent />
                <VisualOverlay />
            </VisualProvider>
        </TranscriptProvider>
    );
}

function AppContent() {
    const transcript = useTranscript();
    const { show: showVisual } = useVisuals();
    const pendingThreadIdRef = useRef<string | null>(null);

    const [overview, setOverview] = useState<CrmOverview | null>(null);
    const [threads, setThreads] = useState<ThreadSummary[]>([]);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(() => readStoredThreadId());
    const [loadingOverview, setLoadingOverview] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<AssistantActionResult | null>(null);

    const welcomeMessages = useMemo<ChatMessage[]>(() => ([
        {
            id: "welcome-1",
            role: "agent",
            content: "Ask Max to create a contact, company, or task, or ask for the latest records.",
            createdAt: new Date().toISOString(),
        },
    ]), []);

    async function refreshThreads() {
        try {
            const rows = await fetchThreads();
            setThreads(rows);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to load threads";
            setError(message);
        }
    }

    async function refreshOverview() {
        setLoadingOverview(true);
        try {
            const nextOverview = await fetchOverview();
            setOverview(nextOverview);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to load CRM overview";
            setError(message);
        } finally {
            setLoadingOverview(false);
        }
    }

    useEffect(() => {
        refreshThreads();
        refreshOverview();
    }, []);

    useEffect(() => {
        if (!activeThreadId) {
            setLoadingMessages(false);
            setMessages(welcomeMessages);
            return;
        }

        let cancelled = false;
        setLoadingMessages(true);
        fetchThreadMessages(activeThreadId)
            .then((rows) => {
                if (cancelled) return;
                setMessages(rows.length ? rows : welcomeMessages);
            })
            .catch((err) => {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : "Failed to load conversation";
                setError(message);
            })
            .finally(() => {
                if (!cancelled) setLoadingMessages(false);
            });

        return () => {
            cancelled = true;
        };
    }, [activeThreadId, welcomeMessages]);

    async function processUserText(text: string, skipTranscript = false) {
        const trimmed = text.trim();
        if (!trimmed || sending) return { replyText: "I am already working on the last request.", speak: false };

        setSending(true);
        setError(null);
        const currentThreadId = pendingThreadIdRef.current ?? activeThreadId;
        const optimisticId = `${Date.now()}-user`;

        setMessages((current) => [
            ...(current.length === 1 && current[0].id === "welcome-1" ? [] : current),
            {
                id: optimisticId,
                role: "user",
                content: trimmed,
                createdAt: new Date().toISOString(),
            },
        ]);

        if (!skipTranscript) {
            transcript.pushUser(trimmed);
        }

        try {
            const response = await chatWithMax({ text: trimmed, threadId: currentThreadId ?? undefined });

            pendingThreadIdRef.current = response.threadId;
            setActiveThreadId(response.threadId);
            writeStoredThreadId(response.threadId);
            setOverview(response.overview);
            setLastResult(response.result);
            setMessages((current) => ([
                ...current,
                {
                    id: `${response.threadId}-${Date.now()}`,
                    role: "agent",
                    content: response.replyText,
                    createdAt: new Date().toISOString(),
                },
            ]));

            if (!skipTranscript) {
                transcript.pushAssistant(response.replyText);
            }

            if (response.visual) {
                showVisual(response.visual);
            }

            await refreshThreads();
            return { replyText: response.replyText, speak: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to talk to Max";
            setError(message);
            return { replyText: "I hit an error. Check the operator panel for details.", speak: true };
        } finally {
            setSending(false);
        }
    }

    function handleSelectThread(threadId: string) {
        pendingThreadIdRef.current = threadId;
        setLastResult(null);
        setActiveThreadId(threadId);
        writeStoredThreadId(threadId);
    }

    function handleNewThread() {
        pendingThreadIdRef.current = null;
        setLastResult(null);
        setActiveThreadId(null);
        writeStoredThreadId(null);
        setMessages(welcomeMessages);
    }

    return (
        <>
            <MaxStage accentHex={ACCENT} />
            <OperatorWorkspace
                overview={overview}
                threads={threads}
                messages={messages}
                activeThreadId={activeThreadId}
                sending={sending}
                loadingOverview={loadingOverview}
                loadingMessages={loadingMessages}
                error={error}
                lastResult={lastResult}
                onSend={(text) => { void processUserText(text); }}
                onSelectThread={handleSelectThread}
                onNewThread={handleNewThread}
            />
            <VoiceController onUserText={processUserText} speakAssistant={true} />
            <MicTranscriptOverlay />
        </>
    );
}
