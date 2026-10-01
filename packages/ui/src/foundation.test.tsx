import { render, screen } from '@testing-library/react';
import { ClipShipApp } from './index';

describe('foundation status screen', () => {
  it('discloses that the integrated clipping workflow is unfinished', () => {
    render(<ClipShipApp />);
    expect(screen.getByRole('heading', { name: 'Implementation draft' })).toBeInTheDocument();
    expect(screen.getByText(/This build cannot import, analyze or export/)).toBeInTheDocument();
  });
  it('distinguishes future browser uploads from desktop local processing', () => {
    render(<ClipShipApp />);
    expect(screen.getByText(/Browser processing is not on-device desktop processing/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Release checklist/ })).toHaveAttribute('rel', 'noreferrer');
  });
});
