import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';
import './styles/layout.css';
import './styles/net.css';
import './styles/detail.css';
import './styles/body.css';
import './styles/modal.css';
import './styles/guide.css';
import './styles/ui.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
