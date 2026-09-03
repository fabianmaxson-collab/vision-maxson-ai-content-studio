import { describe, expect, it } from 'vitest';
import { chooseVoice, speechCapability, splitSpeechSegments } from './browser-speech';

const voice = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;
describe('Review Read-Aloud browser adapter', () => {
  it('selects voice by artifact language rather than UI locale', () => {
    expect(chooseVoice([voice('Español', 'es-ES'), voice('Deutsch', 'de-DE')], 'de-DE')?.name).toBe(
      'Deutsch',
    );
  });
  it('reports unsupported and unavailable capabilities honestly', () => {
    expect(speechCapability(undefined, [], 'es')).toBe('speech_not_supported');
    expect(speechCapability({} as SpeechSynthesis, [], 'es')).toBe('voice_unavailable');
  });
  it('segments long text for cancellable ordered playback', () => {
    expect(splitSpeechSegments('a'.repeat(2001), 1000)).toHaveLength(3);
  });
});
