import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { App } from './main.jsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Windline UI', () => {
  it('surfaces upstream failure instead of inventing metrics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:false, status:502, json:async()=>({detail:'Elexon unavailable in test'})}));
    render(<App />);
    expect(await screen.findByText('Data unavailable')).toBeTruthy();
    expect(screen.getByText(/No sample values are substituted/)).toBeTruthy();
    expect(screen.queryByText('Mean absolute error')).toBeNull();
  });
});
