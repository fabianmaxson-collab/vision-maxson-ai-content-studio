import { translate } from '../../i18n';
import { useReviewSpeech } from './useReviewSpeech';

export function ReviewReadAloud({ text, language }: { text: string; language: string }) {
  const speech = useReviewSpeech(text, language);
  const message =
    speech.state === 'speech_not_supported'
      ? translate('speech.unsupported')
      : speech.state === 'voice_unavailable'
        ? translate('speech.unavailable')
        : speech.state === 'speaking'
          ? translate('speech.speaking')
          : speech.state === 'paused'
            ? translate('speech.paused')
            : '';
  return (
    <div className="review-speech" data-capability={speech.capability}>
      <button type="button" onClick={speech.play} aria-label={translate('speech.listen')}>
        ▶ {translate('speech.listen')}
      </button>
      {(speech.state === 'speaking' || speech.state === 'paused') && (
        <>
          <button type="button" onClick={speech.pauseResume}>
            {speech.state === 'paused' ? '▶' : '⏸'}{' '}
            {translate(speech.state === 'paused' ? 'speech.resume' : 'speech.pause')}
          </button>
          <button type="button" onClick={speech.stop}>
            ■ {translate('speech.stop')}
          </button>
        </>
      )}
      <label>
        <span className="sr-only">Velocidad</span>
        <select
          aria-label="Velocidad de lectura"
          value={speech.rate}
          onChange={(event) => speech.setRate(Number(event.target.value))}
        >
          {[0.75, 1, 1.25, 1.5].map((value) => (
            <option key={value} value={value}>
              {value}x
            </option>
          ))}
        </select>
      </label>
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
      {message && speech.state !== 'speaking' && speech.state !== 'paused' && (
        <small>{message}</small>
      )}
    </div>
  );
}
