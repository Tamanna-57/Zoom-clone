"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live captions from the browser's Web Speech API.
 *
 * This is the "AI notetaker" microphone: final results are pushed to the server
 * as transcript segments. Chrome and Edge support it; elsewhere `supported` is
 * false and the meeting simply has no live transcript.
 */

interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognition(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function useSpeechTranscription(onFinal: (text: string) => void) {
  const [supported] = useState(() => Boolean(getRecognition()));
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantedRef = useRef(false);
  const callbackRef = useRef(onFinal);
  // `start` restarts itself from `onend`, so it reaches itself through a ref.
  const startRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    callbackRef.current = onFinal;
  }, [onFinal]);

  const start = useCallback(() => {
    const Recognition = getRecognition();
    if (!Recognition || recognitionRef.current) return;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let pending = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) callbackRef.current(text);
        else pending += ` ${text}`;
      }
      setInterim(pending.trim());
    };
    recognition.onerror = (event) => {
      // "no-speech" and "aborted" fire constantly on a quiet mic; ignore them.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        wantedRef.current = false;
        setListening(false);
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setInterim("");
      // Chrome stops after a pause; restart while the user still wants captions.
      if (wantedRef.current) window.setTimeout(() => startRef.current(), 400);
      else setListening(false);
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch {
      recognitionRef.current = null;
    }
  }, []);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const enable = useCallback(() => {
    wantedRef.current = true;
    start();
  }, [start]);

  const disable = useCallback(() => {
    wantedRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  useEffect(() => () => {
    wantedRef.current = false;
    recognitionRef.current?.stop();
  }, []);

  return { supported, listening, interim, enable, disable };
}
