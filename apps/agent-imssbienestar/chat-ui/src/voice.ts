import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "./agent";

export type VoiceState = "idle" | "requesting" | "recording" | "transcribing";
const MAX_SECONDS = 60;

// Chrome/Firefox graban webm/opus; Safari, mp4. Whisper acepta ambos.
function pickMime(): { mime: string; ext: string } {
  const opciones = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  return opciones.find((o) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(o.mime)) ?? opciones[0];
}

/** Graba una nota de voz, la transcribe con el agente y entrega el texto. */
export function useVoiceRecorder(opts: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const cancelled = useRef(false);
  const cb = useRef(opts);
  cb.current = opts;

  const release = useCallback(() => {
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return cb.current.onError("Este navegador no permite grabar audio.");
    }
    cancelled.current = false;
    setState("requesting"); // el navegador puede estar mostrando el aviso de permiso
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelled.current) return release(); // canceló mientras se decidía el permiso
    } catch {
      setState("idle");
      return cb.current.onError("No tengo permiso para usar el micrófono. Actívalo en el navegador o escribe tu mensaje.");
    }
    const { mime, ext } = pickMime();
    chunks.current = [];
    const rec = new MediaRecorder(stream.current, { mimeType: mime });
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = async () => {
      release();
      if (cancelled.current || chunks.current.length === 0) return setState("idle");
      setState("transcribing");
      try {
        const text = await transcribeAudio(new Blob(chunks.current, { type: mime }), `nota.${ext}`);
        if (text.length < 2) cb.current.onError("No alcancé a entender el audio. Intenta de nuevo o escribe tu mensaje.");
        else cb.current.onText(text);
      } catch (e) {
        cb.current.onError(`${(e as Error).message}. Puedes escribir tu mensaje.`);
      } finally {
        setState("idle");
      }
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setState("recording");
    timer.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) rec.state === "recording" && rec.stop();
        return s + 1;
      });
    }, 1000);
  }, [release]);

  const stop = useCallback(() => recorder.current?.state === "recording" && recorder.current.stop(), []);
  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    else release();
    setState("idle");
  }, [release]);

  return { state, seconds, start, stop, cancel };
}
