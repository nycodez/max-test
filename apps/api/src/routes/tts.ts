import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { google } from "googleapis";

const execAsync = promisify(exec);

type TtsInput = {
    text?: string;
    voice?: string;
    rate?: number;
    pitch?: number;
    provider?: "google" | "native" | "eleven";
    allowFallback?: boolean;
};

function normalizeRate(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0.25, Math.min(4, parsed));
}

function normalizePitch(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(-20, Math.min(20, parsed));
}

async function synthesizeGoogleSpeech(input: Required<Pick<TtsInput, "text">> & Omit<TtsInput, "text">): Promise<Buffer> {
    const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = google.texttospeech({
        version: "v1",
        auth,
    });

    const languageCode = process.env.GOOGLE_TTS_LANGUAGE_CODE || "en-US";
    const preferredVoice = input.voice?.trim() || process.env.GOOGLE_TTS_VOICE_NAME || "en-US-Neural2-F";
    const fallbackVoice = process.env.GOOGLE_TTS_FALLBACK_VOICE_NAME || "en-US-Standard-F";
    const candidateVoices = Array.from(new Set([preferredVoice, fallbackVoice].filter(Boolean)));
    const speakingRate = normalizeRate(input.rate, Number(process.env.GOOGLE_TTS_SPEAKING_RATE || 1));
    const pitch = normalizePitch(input.pitch, Number(process.env.GOOGLE_TTS_PITCH || 0));

    let lastError: unknown = null;
    for (const voiceName of candidateVoices) {
        try {
            const response = await client.text.synthesize({
                requestBody: {
                    input: { text: input.text },
                    voice: {
                        languageCode,
                        name: voiceName,
                    },
                    audioConfig: {
                        audioEncoding: "MP3",
                        speakingRate,
                        pitch,
                    },
                },
            });

            const audioContent = response.data.audioContent;
            if (!audioContent) {
                throw new Error("Google TTS response did not include audioContent");
            }

            return Buffer.from(audioContent, "base64");
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error("Google TTS failed");
}

async function synthesizeNativeSpeech(input: Required<Pick<TtsInput, "text">> & Omit<TtsInput, "text">): Promise<{ buffer: Buffer; contentType: string }> {
    const tempDir = os.tmpdir();
    const tempId = Date.now() + Math.random();
    const wavFile = path.join(tempDir, `tts_${tempId}.wav`);
    const aiffFile = path.join(tempDir, `tts_${tempId}.aiff`);
    const mp3File = path.join(tempDir, `tts_${tempId}.mp3`);

    try {
        let ttsCommand = "";
        const platform = process.platform;

        if (platform === "darwin") {
            const voiceParam = input.voice ? `-v "${input.voice}"` : "";
            const rateParam = input.rate ? `-r ${Math.max(80, Math.min(400, Math.round(input.rate * 175)))}` : "";
            ttsCommand = `say ${voiceParam} ${rateParam} -o "${aiffFile}" "${input.text.replace(/"/g, '\\"')}"`;
        } else if (platform === "win32") {
            const voiceParam = input.voice ? `-Voice "${input.voice}"` : "";
            const rateParam = input.rate ? `-Rate ${Math.max(-10, Math.min(10, Math.round((input.rate - 1) * 10)))}` : "";
            ttsCommand = `powershell -Command "Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voiceParam} ${rateParam} $synth.SetOutputToWaveFile('${wavFile}'); $synth.Speak('${input.text.replace(/'/g, "''")}'); $synth.Dispose()"`;
        } else {
            const voiceParam = input.voice ? `-v ${input.voice}` : "";
            const rateParam = input.rate ? `-s ${Math.max(80, Math.min(450, Math.round(input.rate * 175)))}` : "";
            const pitchParam = input.pitch ? `-p ${Math.max(0, Math.min(99, Math.round(50 + input.pitch * 2)))}` : "";
            ttsCommand = `espeak ${voiceParam} ${rateParam} ${pitchParam} -w "${wavFile}" "${input.text.replace(/"/g, '\\"')}"`;
        }

        await execAsync(ttsCommand);

        if (platform === "darwin") {
            if (!fs.existsSync(aiffFile)) {
                throw new Error("Native TTS generation failed - no AIFF file created");
            }
            try {
                await execAsync(`ffmpeg -i "${aiffFile}" "${wavFile}"`);
            } catch {
                await execAsync(`afconvert -f WAVE -d LEI16 "${aiffFile}" "${wavFile}"`);
            }
        }

        if (!fs.existsSync(wavFile)) {
            throw new Error("Native TTS generation failed - no output file created");
        }

        try {
            await execAsync(`ffmpeg -i "${wavFile}" -codec:a mp3 -b:a 128k "${mp3File}"`);
            if (fs.existsSync(mp3File)) {
                return { buffer: fs.readFileSync(mp3File), contentType: "audio/mpeg" };
            }
        } catch {
            // Fall back to wav below.
        }

        return { buffer: fs.readFileSync(wavFile), contentType: "audio/wav" };
    } finally {
        try {
            if (fs.existsSync(wavFile)) fs.unlinkSync(wavFile);
            if (fs.existsSync(aiffFile)) fs.unlinkSync(aiffFile);
            if (fs.existsSync(mp3File)) fs.unlinkSync(mp3File);
        } catch (cleanupError) {
            console.warn("Failed to clean up temporary TTS files:", cleanupError);
        }
    }
}

export default function ttsRoutes() {
    const router = Router();

    router.post("/speak", async (req, res) => {
        const payload = (req.body ?? {}) as TtsInput;
        const text = String(payload.text || "").trim();
        if (!text) return res.status(400).json({ error: "Missing text" });

        const provider = payload.provider || "google";
        const allowFallback = payload.allowFallback !== false;

        if (provider === "native") {
            try {
                const nativeAudio = await synthesizeNativeSpeech({ ...payload, text });
                res.setHeader("Content-Type", nativeAudio.contentType);
                res.setHeader("Cache-Control", "no-store");
                res.setHeader("X-TTS-Provider", "native");
                return res.send(nativeAudio.buffer);
            } catch (error) {
                return res.status(500).json({
                    error: "Native TTS error",
                    details: error instanceof Error ? error.message : String(error),
                    platform: process.platform,
                });
            }
        }

        if (provider === "eleven") {
            return res.status(400).json({ error: "ElevenLabs is no longer the default TTS provider for Max." });
        }

        try {
            const buffer = await synthesizeGoogleSpeech({ ...payload, text });
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-TTS-Provider", "google");
            return res.send(buffer);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!allowFallback) {
                return res.status(502).json({ error: "Google TTS error", details: message });
            }

            try {
                const nativeAudio = await synthesizeNativeSpeech({ ...payload, text });
                res.setHeader("Content-Type", nativeAudio.contentType);
                res.setHeader("Cache-Control", "no-store");
                res.setHeader("X-TTS-Provider", "native-fallback");
                return res.send(nativeAudio.buffer);
            } catch (nativeError) {
                return res.status(502).json({
                    error: "Google and native TTS failed",
                    details: {
                        google: message,
                        native: nativeError instanceof Error ? nativeError.message : String(nativeError),
                    },
                });
            }
        }
    });

    return router;
}
