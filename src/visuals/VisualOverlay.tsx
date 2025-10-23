import { useEffect } from "react";
import { useVisual } from "./VisualProvider";
import { motion, AnimatePresence } from "framer-motion";

export default function VisualOverlay() {
    const { visual, clearVisual } = useVisual();

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && clearVisual();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [clearVisual]);

    if (!visual) return null;

    return (
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={clearVisual}
            >
                <motion.div
                    className="max-w-5xl max-h-[90vh] bg-black rounded-xl shadow-lg overflow-hidden relative"
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.9 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="absolute top-3 right-3 text-white/70 hover:text-white text-2xl"
                        onClick={clearVisual}
                    >
                        ×
                    </button>

                    {visual.type === "image" && (
                        <img src={visual.url} className="max-h-[80vh] object-contain" />
                    )}
                    {visual.type === "video" && (
                        <video src={visual.url} controls className="max-h-[80vh]" />
                    )}
                    {visual.type === "youtube" && (
                        <iframe
                            className="w-[90vw] h-[70vh]"
                            src={`https://www.youtube.com/embed/${visual.id}`}
                            frameBorder="0"
                            allowFullScreen
                        />
                    )}

                    {visual.caption && (
                        <div className="p-3 text-center text-gray-300 text-sm">
                            {visual.caption}
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
