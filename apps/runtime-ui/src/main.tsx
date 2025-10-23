import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const root = document.getElementById("root");
if (!root) {
    // visible fallback in case root is missing
    const div = document.createElement('div');
    div.textContent = "Root element #root not found.";
    document.body.appendChild(div);
} else {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}
