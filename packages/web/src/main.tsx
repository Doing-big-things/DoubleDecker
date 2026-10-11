import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { camera } from './map/camera';
import { useDeck } from './state/store';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A small handle for end-to-end tests and for poking at the map from the console.
declare global {
  interface Window {
    __decker: { store: typeof useDeck; camera: typeof camera };
  }
}
window.__decker = { store: useDeck, camera };
