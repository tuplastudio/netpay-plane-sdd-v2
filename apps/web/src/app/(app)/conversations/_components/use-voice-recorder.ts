"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Graba una nota de voz con el micrófono (MediaRecorder). Misma mecánica
 * que el chat web (`chat/page.tsx`), extraída para que el panel del hilo la
 * reutilice sin copiar el manejo del stream.
 *
 * `onRecorded` recibe el audio ya en base64 y el mimetype real que produjo
 * el navegador (audio/webm en Chrome/Firefox, audio/mp4 en Safari).
 *
 * Expone `elapsedMs` (cronómetro visible mientras se graba) y `cancel`
 * (descarta la grabación en curso sin llamar a `onRecorded`, para poder
 * arrepentirse antes de enviar).
 */
export function useVoiceRecorder(onRecorded: (audio: { base64: string; mimetype: string }) => void) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  // `stop()` (enviar) y `cancel()` (descartar) llaman los dos a
  // `MediaRecorder.stop()`; esta bandera es lo único que distingue, dentro
  // de `onstop`, si debe correr `onRecorded` o tirar el audio.
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const stopInternal = useCallback((cancelled: boolean) => {
    cancelledRef.current = cancelled;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const stop = useCallback(() => stopInternal(false), [stopInternal]);
  /** Descarta la nota en curso: no se sube ni se manda. */
  const cancel = useCallback(() => stopInternal(true), [stopInternal]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const wasCancelled = cancelledRef.current;
        cancelledRef.current = false;
        if (wasCancelled) return;
        const mimetype = (recorder.mimeType || "audio/webm").split(";")[0] ?? "audio/webm";
        const blob = new Blob(chunks, { type: mimetype });
        if (blob.size === 0) return;
        onRecorded({ base64: await blobToBase64(blob), mimetype });
      };
      recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setRecording(true);
    } catch {
      setError("No pude usar el micrófono. Revisa los permisos del navegador.");
    }
  }, [onRecorded]);

  const toggle = useCallback(() => {
    if (recording) stop();
    else void start();
  }, [recording, start, stop]);

  // Cronómetro: se actualiza mientras se graba, para que la persona vea
  // cuánto lleva antes de mandar (o descartar) la nota.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250);
    return () => clearInterval(id);
  }, [recording]);

  // Si el panel se cierra a media grabación, se suelta el micrófono.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return { recording, error, elapsedMs, toggle, stop, cancel };
}

/** `mm:ss` a partir de milisegundos, para el cronómetro de la grabación. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Blob -> base64 sin `btoa(String.fromCharCode(...bytes))`: con archivos de
 * varios MB esa forma revienta el límite de argumentos de la llamada.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}
