export type SpeechCapability = 'available' | 'voice_unavailable' | 'speech_not_supported';
export interface ReviewVoice {
  name: string;
  lang: string;
  voice: SpeechSynthesisVoice;
}
export function chooseVoice(
  voices: readonly SpeechSynthesisVoice[],
  language: string,
  preferredName?: string,
): SpeechSynthesisVoice | null {
  const normalized = language.toLowerCase();
  const primary = normalized.split('-')[0];
  const compatible = voices.filter((voice) => {
    const candidate = voice.lang.toLowerCase();
    return candidate === normalized || candidate.split('-')[0] === primary;
  });
  return compatible.find((voice) => voice.name === preferredName) ?? compatible[0] ?? null;
}
export function speechCapability(
  synthesis: SpeechSynthesis | undefined,
  voices: readonly SpeechSynthesisVoice[],
  language: string,
): SpeechCapability {
  if (!synthesis) return 'speech_not_supported';
  return chooseVoice(voices, language) ? 'available' : 'voice_unavailable';
}
export function splitSpeechSegments(text: string, maximum = 1000): string[] {
  const paragraphs = text
    .split(/\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return paragraphs.flatMap((paragraph) => {
    if (paragraph.length <= maximum) return [paragraph];
    const segments: string[] = [];
    for (let offset = 0; offset < paragraph.length; offset += maximum)
      segments.push(paragraph.slice(offset, offset + maximum));
    return segments;
  });
}
