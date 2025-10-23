import { useEffect, useState } from "react";
import SplashScreen from "./SplashScreen";

type Props = {
    children: React.ReactNode;
    accentHex?: string;
    apiBase?: string;            // e.g., import.meta.env.VITE_API_URL
};

export default function SplashGate({ children, accentHex = "#22D3EE", apiBase = "" }: Props) {
    const [show, setShow] = useState(() => !sessionStorage.getItem("splashSeen"));

    useEffect(() => {
        if (!show) return;

        // try a quick bootstrap/health fetch; fall back to time limit
        let done = false;
        const timeLimit = setTimeout(() => {
            if (!done) { finish(); }
        }, 1800); // fallback max wait

        const endpoint = apiBase
            ? `${apiBase}/runtime/bootstrap`
            : `${window.location.origin.replace(/:\d+$/, ":8080")}/__health`; // tries API on :8080 if VITE_API_URL not set

        fetch(endpoint, { method: "GET" })
            .then(() => { done = true; finish(); })
            .catch(() => {/* ignore; fallback timer will take it */});

        function finish() {
            sessionStorage.setItem("splashSeen", "1");
            setShow(false);
            clearTimeout(timeLimit);
        }

        return () => clearTimeout(timeLimit);
    }, [show, apiBase]);

    if (show) return <SplashScreen accentHex={accentHex} onDone={() => {
        sessionStorage.setItem("splashSeen", "1");
        setShow(false);
    }} />;

    return <>{children}</>;
}
