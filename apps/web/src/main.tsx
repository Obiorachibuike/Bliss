import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClipShipApp } from '@clipship/ui';
createRoot(document.getElementById('root')!).render(<StrictMode><ClipShipApp /></StrictMode>);
