import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

export default function ttsRoutes() {
    const router = Router();

    router.post("/eleven", async (req, res, next) => {
        try {
            const { text, voiceId, modelId, voice_settings } = (req.body ?? {}) as {
                text?: string;
                voiceId?: string;
                modelId?: string;
                voice_settings?: {
                    stability?: number;
                    similarity_boost?: number;
                    style?: number;
                    use_speaker_boost?: boolean;
                };
            };
            if (!text || !text.trim()) return res.status(400).json({ error: "Missing text" });

            const apiKey = process.env.ELEVEN_API_KEY;
            if (!apiKey) return res.status(500).json({ error: "Missing ELEVEN_API_KEY" });

            const vid = voiceId || process.env.ELEVEN_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel
            const model = modelId || process.env.ELEVEN_MODEL || "eleven_multilingual_v2";

            const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}?optimize_streaming_latency=2&output_format=mp3_44100_128`;

            const r = await fetch(url, {
                method: "POST",
                headers: {
                    "xi-api-key": apiKey,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg",
                },
                body: JSON.stringify({
                    text,
                    model_id: model,
                    voice_settings,
                }),
            });

            if (!r.ok || !r.body) {
                let details = "";
                try { details = await r.text(); } catch {}
                return res.status(502).json({
                    error: "ElevenLabs error",
                    upstreamStatus: r.status,
                    upstreamStatusText: r.statusText,
                    details,
                });
            }

            // Convert response to buffer
            const arrayBuffer = await r.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "no-store");
            res.send(buffer);
        } catch (e) {
            next(e);
        }
    });

    router.post("/native", async (req, res, next) => {
        try {
            const { text, voice, rate, pitch } = (req.body ?? {}) as {
                text?: string;
                voice?: string;
                rate?: number;
                pitch?: number;
            };

            if (!text || !text.trim()) return res.status(400).json({ error: "Missing text" });

            // Create temporary file paths
            const tempDir = os.tmpdir();
            const tempId = Date.now() + Math.random();
            const wavFile = path.join(tempDir, `tts_${tempId}.wav`);
            const aiffFile = path.join(tempDir, `tts_${tempId}.aiff`);
            const mp3File = path.join(tempDir, `tts_${tempId}.mp3`);

            try {
                // Platform-specific TTS command
                let ttsCommand = "";
                const platform = process.platform;

                if (platform === "darwin") {
                    // macOS - use built-in say command (creates AIFF, then convert to WAV)
                    const voiceParam = voice ? `-v "${voice}"` : "";
                    const rateParam = rate ? `-r ${Math.max(80, Math.min(400, rate))}` : "";
                    ttsCommand = `say ${voiceParam} ${rateParam} -o "${aiffFile}" "${text.replace(/"/g, '\\"')}"`;
                } else if (platform === "win32") {
                    // Windows - use PowerShell with SAPI
                    const voiceParam = voice ? `-Voice "${voice}"` : "";
                    const rateParam = rate ? `-Rate ${Math.max(-10, Math.min(10, rate || 0))}` : "";
                    ttsCommand = `powershell -Command "Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voiceParam} ${rateParam} $synth.SetOutputToWaveFile('${wavFile}'); $synth.Speak('${text.replace(/'/g, "''")}'); $synth.Dispose()"`;
                } else {
                    // Linux - use espeak or festival
                    const voiceParam = voice ? `-v ${voice}` : "";
                    const rateParam = rate ? `-s ${Math.max(80, Math.min(450, rate || 175))}` : "";
                    const pitchParam = pitch ? `-p ${Math.max(0, Math.min(99, pitch || 50))}` : "";
                    ttsCommand = `espeak ${voiceParam} ${rateParam} ${pitchParam} -w "${wavFile}" "${text.replace(/"/g, '\\"')}"`;
                }

                // Execute TTS command
                await execAsync(ttsCommand);

                // For macOS, convert AIFF to WAV
                if (platform === "darwin") {
                    if (!fs.existsSync(aiffFile)) {
                        throw new Error("TTS generation failed - no AIFF file created");
                    }
                    // Convert AIFF to WAV using ffmpeg or afconvert
                    try {
                        await execAsync(`ffmpeg -i "${aiffFile}" "${wavFile}"`);
                    } catch (ffmpegError) {
                        // Fallback to macOS built-in afconvert
                        await execAsync(`afconvert -f WAVE -d LEI16 "${aiffFile}" "${wavFile}"`);
                    }
                }

                // Check if WAV file was created
                if (!fs.existsSync(wavFile)) {
                    throw new Error("TTS generation failed - no output file created");
                }

                // Convert WAV to MP3 using ffmpeg (if available)
                let audioBuffer: Buffer;
                try {
                    await execAsync(`ffmpeg -i "${wavFile}" -codec:a mp3 -b:a 128k "${mp3File}"`);
                    if (fs.existsSync(mp3File)) {
                        audioBuffer = fs.readFileSync(mp3File);
                        res.setHeader("Content-Type", "audio/mpeg");
                    } else {
                        throw new Error("FFmpeg conversion failed");
                    }
                } catch (ffmpegError) {
                    // Fallback to WAV if ffmpeg is not available
                    audioBuffer = fs.readFileSync(wavFile);
                    res.setHeader("Content-Type", "audio/wav");
                }

                res.setHeader("Cache-Control", "no-store");
                res.send(audioBuffer);

            } finally {
                // Clean up temporary files
                try {
                    if (fs.existsSync(wavFile)) fs.unlinkSync(wavFile);
                    if (fs.existsSync(aiffFile)) fs.unlinkSync(aiffFile);
                    if (fs.existsSync(mp3File)) fs.unlinkSync(mp3File);
                } catch (cleanupError) {
                    console.warn("Failed to clean up temporary files:", cleanupError);
                }
            }

        } catch (e) {
            res.status(500).json({
                error: "Native TTS error",
                details: e instanceof Error ? e.message : String(e),
                platform: process.platform
            });
        }
    });

    return router;
}