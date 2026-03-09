import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type {
    AssistantActionResult,
    ChatMessage,
    CompanyRecord,
    ContactRecord,
    CrmOverview,
    TaskRecord,
    ThreadSummary,
} from "../api";

type Props = {
    overview: CrmOverview | null;
    threads: ThreadSummary[];
    messages: ChatMessage[];
    activeThreadId: string | null;
    sending: boolean;
    loadingOverview: boolean;
    loadingMessages: boolean;
    error: string | null;
    lastResult: AssistantActionResult | null;
    onSend: (text: string) => void;
    onSelectThread: (threadId: string) => void;
    onNewThread: () => void;
};

export default function OperatorWorkspace({
    overview,
    threads,
    messages,
    activeThreadId,
    sending,
    loadingOverview,
    loadingMessages,
    error,
    lastResult,
    onSend,
    onSelectThread,
    onNewThread,
}: Props) {
    const [draft, setDraft] = useState("");
    const [compact, setCompact] = useState(() => window.innerWidth < 1100);

    useEffect(() => {
        function onResize() {
            setCompact(window.innerWidth < 1100);
        }

        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    const quickPrompts = useMemo(() => ([
        "Show the latest contacts",
        "Show open tasks",
        "Create a task to follow up with Acme this week",
        "Create a contact named Jamie Rivera with email jamie@example.com",
    ]), []);

    function submit() {
        const text = draft.trim();
        if (!text || sending) return;
        onSend(text);
        setDraft("");
    }

    const layoutStyle: CSSProperties = compact
        ? {
            position: "fixed",
            inset: 0,
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr) auto",
            gap: 14,
            padding: 14,
            pointerEvents: "none",
        }
        : {
            position: "fixed",
            inset: 0,
            display: "grid",
            gridTemplateColumns: "280px minmax(0, 1fr) 320px",
            gap: 18,
            padding: 18,
            pointerEvents: "none",
        };

    const panelBase: CSSProperties = {
        pointerEvents: "auto",
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "linear-gradient(180deg, rgba(10,14,24,0.92), rgba(8,10,18,0.82))",
        backdropFilter: "blur(12px)",
        boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
        color: "#f3f4f6",
        overflow: "hidden",
    };

    return (
        <div style={layoutStyle}>
            <section style={{
                ...panelBase,
                display: "flex",
                flexDirection: "column",
                minHeight: compact ? 180 : 0,
                order: compact ? 2 : 0,
            }}>
                <div style={headerStyle}>
                    <div>
                        <div style={eyebrowStyle}>Threads</div>
                        <div style={titleStyle}>Recent conversations</div>
                    </div>
                    <button onClick={onNewThread} style={ghostButtonStyle}>New</button>
                </div>
                <div style={{ padding: "0 14px 14px", overflow: "auto" }}>
                    {threads.length === 0 && (
                        <div style={emptyStateStyle}>Your first conversation will show up here.</div>
                    )}
                    {threads.map((thread) => (
                        <button
                            key={thread.id}
                            onClick={() => onSelectThread(thread.id)}
                            style={{
                                ...threadButtonStyle,
                                borderColor: thread.id === activeThreadId ? "rgba(34,211,238,0.6)" : "rgba(255,255,255,0.08)",
                                background: thread.id === activeThreadId ? "rgba(34,211,238,0.12)" : "rgba(255,255,255,0.03)",
                            }}
                        >
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{thread.title}</div>
                            <div style={{ opacity: 0.62, fontSize: 12 }}>{formatDate(thread.updatedAt)}</div>
                        </button>
                    ))}
                </div>
            </section>

            <section style={{
                ...panelBase,
                display: "grid",
                gridTemplateRows: "auto auto minmax(0, 1fr) auto",
                order: compact ? 1 : 0,
            }}>
                <div style={headerStyle}>
                    <div>
                        <div style={eyebrowStyle}>Max CRM Operator</div>
                        <div style={titleStyle}>Typed CRM actions with voice on top</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{
                            padding: "6px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(34,211,238,0.3)",
                            background: "rgba(34,211,238,0.08)",
                            fontSize: 12,
                            color: "#a5f3fc",
                        }}>
                            {sending ? "Working..." : "Ready"}
                        </span>
                    </div>
                </div>

                <div style={{ padding: "0 18px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {quickPrompts.map((prompt) => (
                        <button
                            key={prompt}
                            onClick={() => setDraft(prompt)}
                            style={chipButtonStyle}
                        >
                            {prompt}
                        </button>
                    ))}
                </div>

                <div style={{ padding: "0 18px 18px", overflow: "auto" }}>
                    {error && (
                        <div style={{
                            marginBottom: 12,
                            padding: "12px 14px",
                            borderRadius: 14,
                            background: "rgba(248,113,113,0.08)",
                            border: "1px solid rgba(248,113,113,0.28)",
                            color: "#fecaca",
                        }}>
                            {error}
                        </div>
                    )}

                    {lastResult && lastResult.type !== "none" && (
                        <ActionResultCard result={lastResult} />
                    )}

                    {loadingMessages ? (
                        <div style={emptyStateStyle}>Loading conversation…</div>
                    ) : messages.length === 0 ? (
                        <div style={emptyStateStyle}>
                            Ask Max to create a contact, company, or task, or ask to show your latest records.
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {messages.map((message) => (
                                <article
                                    key={message.id}
                                    style={{
                                        alignSelf: message.role === "user" ? "flex-end" : "stretch",
                                        maxWidth: message.role === "user" ? "78%" : "100%",
                                        padding: "14px 16px",
                                        borderRadius: 18,
                                        background: message.role === "user"
                                            ? "linear-gradient(135deg, rgba(34,211,238,0.18), rgba(59,130,246,0.18))"
                                            : "rgba(255,255,255,0.04)",
                                        border: `1px solid ${message.role === "user" ? "rgba(34,211,238,0.28)" : "rgba(255,255,255,0.08)"}`,
                                    }}
                                >
                                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, opacity: 0.58, marginBottom: 8 }}>
                                        {message.role === "user" ? "You" : "Max"}
                                    </div>
                                    <div style={{ lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{message.content}</div>
                                </article>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    padding: 18,
                    background: "rgba(255,255,255,0.02)",
                }}>
                    <div style={{ display: "grid", gap: 10 }}>
                        <textarea
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            rows={3}
                            placeholder="Ask Max to create a contact, company, or follow-up task."
                            style={composerStyle}
                            onKeyDown={(event) => {
                                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "enter") {
                                    event.preventDefault();
                                    submit();
                                }
                            }}
                        />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                            <div style={{ opacity: 0.56, fontSize: 12 }}>Voice and typed chat share the same thread history.</div>
                            <button onClick={submit} disabled={sending} style={primaryButtonStyle}>
                                {sending ? "Working..." : "Send"}
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <section style={{
                ...panelBase,
                display: "flex",
                flexDirection: "column",
                minHeight: compact ? 180 : 0,
                order: compact ? 3 : 0,
            }}>
                <div style={headerStyle}>
                    <div>
                        <div style={eyebrowStyle}>CRM Snapshot</div>
                        <div style={titleStyle}>Counts and recent records</div>
                    </div>
                </div>

                <div style={{ padding: "0 16px 16px", overflow: "auto" }}>
                    {loadingOverview && !overview ? (
                        <div style={emptyStateStyle}>Loading CRM snapshot…</div>
                    ) : !overview ? (
                        <div style={emptyStateStyle}>No CRM data yet.</div>
                    ) : (
                        <div style={{ display: "grid", gap: 14 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                                <MetricCard label="Contacts" value={overview.counts.contacts} accent="#22d3ee" />
                                <MetricCard label="Companies" value={overview.counts.companies} accent="#60a5fa" />
                                <MetricCard label="Open Tasks" value={overview.counts.openTasks} accent="#f59e0b" />
                            </div>

                            <RecordList title="Recent contacts" items={overview.recentContacts} renderItem={(item) => (
                                <>
                                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                                    <div style={subtleLineStyle}>
                                        {[item.email, item.companyName, item.status].filter(Boolean).join(" • ") || "No details yet"}
                                    </div>
                                </>
                            )} />

                            <RecordList title="Recent companies" items={overview.recentCompanies} renderItem={(item) => (
                                <>
                                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                                    <div style={subtleLineStyle}>
                                        {[item.industry, item.website].filter(Boolean).join(" • ") || "No details yet"}
                                    </div>
                                </>
                            )} />

                            <RecordList title="Recent tasks" items={overview.recentTasks} renderItem={(item) => (
                                <>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                        <span style={{ fontWeight: 600 }}>{item.title}</span>
                                        <span style={{ opacity: 0.68, textTransform: "capitalize" }}>{item.status.replace("_", " ")}</span>
                                    </div>
                                    <div style={subtleLineStyle}>
                                        {[item.priority, item.companyName, item.contactName].filter(Boolean).join(" • ") || "No details yet"}
                                    </div>
                                </>
                            )} />
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

function ActionResultCard({ result }: { result: AssistantActionResult }) {
    const heading = result.type === "contact_created"
        ? "Contact created"
        : result.type === "company_created"
            ? "Company created"
            : result.type === "task_created"
                ? "Task created"
                : result.type === "contacts_list"
                    ? `${result.total} contact${result.total === 1 ? "" : "s"}`
                    : result.type === "companies_list"
                        ? `${result.total} compan${result.total === 1 ? "y" : "ies"}`
                        : `${result.total} task${result.total === 1 ? "" : "s"}`;

    const records = result.type === "contacts_list"
        ? result.records
        : result.type === "companies_list"
            ? result.records
            : result.type === "tasks_list"
                ? result.records
                : result.type === "contact_created"
                    ? [result.record]
                    : result.type === "company_created"
                        ? [result.record]
                        : [result.record];

    return (
        <div style={{
            marginBottom: 14,
            padding: 16,
            borderRadius: 18,
            background: "rgba(34,211,238,0.08)",
            border: "1px solid rgba(34,211,238,0.2)",
        }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, opacity: 0.58, marginBottom: 8 }}>
                Latest action
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{heading}</div>
            <div style={{ display: "grid", gap: 8 }}>
                {records.slice(0, 5).map((record) => (
                    <div key={record.id} style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                    }}>
                        {renderRecordSummary(record)}
                    </div>
                ))}
            </div>
        </div>
    );
}

function RecordList<T extends ContactRecord | CompanyRecord | TaskRecord>({
    title,
    items,
    renderItem,
}: {
    title: string;
    items: T[];
    renderItem: (item: T) => ReactNode;
}) {
    return (
        <div>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2, opacity: 0.56, marginBottom: 10 }}>
                {title}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
                {items.length === 0 && <div style={emptyInlineStateStyle}>Nothing yet.</div>}
                {items.map((item) => (
                    <div key={item.id} style={{
                        padding: "12px 12px",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                    }}>
                        {renderItem(item)}
                    </div>
                ))}
            </div>
        </div>
    );
}

function MetricCard({ label, value, accent }: { label: string; value: number; accent: string }) {
    return (
        <div style={{
            padding: 14,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
        }}>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: accent }}>{value}</div>
        </div>
    );
}

function renderRecordSummary(record: ContactRecord | CompanyRecord | TaskRecord) {
    if ("status" in record && "name" in record) {
        return (
            <>
                <div style={{ fontWeight: 600 }}>{record.name}</div>
                <div style={subtleLineStyle}>{[record.email, record.companyName, record.status].filter(Boolean).join(" • ")}</div>
            </>
        );
    }

    if ("title" in record) {
        return (
            <>
                <div style={{ fontWeight: 600 }}>{record.title}</div>
                <div style={subtleLineStyle}>{[record.priority, record.companyName, record.contactName].filter(Boolean).join(" • ")}</div>
            </>
        );
    }

    return (
        <>
            <div style={{ fontWeight: 600 }}>{record.name}</div>
            <div style={subtleLineStyle}>{[record.industry, record.website].filter(Boolean).join(" • ")}</div>
        </>
    );
}

function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

const headerStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    padding: "18px 18px 14px",
};

const eyebrowStyle: CSSProperties = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.4,
    opacity: 0.6,
    marginBottom: 6,
};

const titleStyle: CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.15,
};

const primaryButtonStyle: CSSProperties = {
    appearance: "none",
    border: "1px solid rgba(34,211,238,0.34)",
    background: "linear-gradient(135deg, rgba(34,211,238,0.22), rgba(59,130,246,0.2))",
    color: "#ecfeff",
    padding: "11px 16px",
    borderRadius: 14,
    cursor: "pointer",
    fontWeight: 600,
};

const ghostButtonStyle: CSSProperties = {
    appearance: "none",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    color: "#f3f4f6",
    padding: "9px 12px",
    borderRadius: 12,
    cursor: "pointer",
};

const chipButtonStyle: CSSProperties = {
    appearance: "none",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#e5e7eb",
    borderRadius: 999,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 12,
};

const composerStyle: CSSProperties = {
    width: "100%",
    resize: "vertical",
    minHeight: 88,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#f9fafb",
    padding: "14px 16px",
    outline: "none",
    lineHeight: 1.5,
    font: "15px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

const threadButtonStyle: CSSProperties = {
    width: "100%",
    textAlign: "left",
    appearance: "none",
    marginBottom: 10,
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    color: "#f3f4f6",
    cursor: "pointer",
};

const emptyStateStyle: CSSProperties = {
    padding: "18px 16px",
    borderRadius: 16,
    border: "1px dashed rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.02)",
    color: "rgba(243,244,246,0.72)",
};

const emptyInlineStateStyle: CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px dashed rgba(255,255,255,0.12)",
    color: "rgba(243,244,246,0.62)",
};

const subtleLineStyle: CSSProperties = {
    marginTop: 4,
    opacity: 0.68,
    fontSize: 13,
    lineHeight: 1.45,
};
