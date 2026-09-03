import { useCallback, useEffect, useMemo, useState } from 'react';
import { chooseVoice, speechCapability, splitSpeechSegments } from './browser-speech';

export type PlaybackState =
  'idle' | 'speaking' | 'paused' | 'voice_unavailable' | 'speech_not_supported';
export function useReviewSpeech(text: string, language: string) {
  const synthesis = typeof window === 'undefined' ? undefined : window.speechSynthesis;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [state, setState] = useState<PlaybackState>('idle');
  const [rate, setRate] = useState(1);
  useEffect(() => {
    if (!synthesis) return;
    const load = () => setVoices(synthesis.getVoices());
    load();
    synthesis.addEventListener('voiceschanged', load);
    return () => {
      synthesis.removeEventListener('voiceschanged', load);
      synthesis.cancel();
    };
  }, [synthesis]);
  const capability = useMemo(
    () => speechCapability(synthesis, voices, language),
    [synthesis, voices, language],
  );
  const stop = useCallback(() => {
    synthesis?.cancel();
    setState('idle');
  }, [synthesis]);
  const play = useCallback(() => {
    if (!synthesis) return setState('speech_not_supported');
    const voice = chooseVoice(voices, language);
    if (!voice) return setState('voice_unavailable');
    synthesis.cancel();
    const segments = splitSpeechSegments(text);
    let index = 0;
    const next = () => {
      const segment = segments[index++];
      if (!segment) return setState('idle');
      const utterance = new SpeechSynthesisUtterance(segment);
      utterance.lang = language;
      utterance.voice = voice;
      utterance.rate = rate;
      utterance.onend = next;
      utterance.onerror = () => setState('idle');
      synthesis.speak(utterance);
    };
    setState('speaking');
    next();
  }, [language, rate, synthesis, text, voices]);
  const pauseResume = useCallback(() => {
    if (!synthesis) return;
    if (synthesis.paused) {
      synthesis.resume();
      setState('speaking');
    } else {
      synthesis.pause();
      setState('paused');
    }
  }, [synthesis]);
  return { capability, state, rate, setRate, play, pauseResume, stop };
}
