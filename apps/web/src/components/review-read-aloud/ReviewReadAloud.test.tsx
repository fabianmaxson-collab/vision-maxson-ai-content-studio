import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewReadAloud } from './ReviewReadAloud';

describe('Review Read-Aloud startup safety', () => {
  it('renders safely and reports unsupported when SpeechSynthesis is absent', async () => {
    render(<ReviewReadAloud text="Texto real de revisión" language="es" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Escuchar' }));
    expect(
      await screen.findAllByText('Este navegador no admite lectura en voz alta.'),
    ).toHaveLength(2);
  });
});
