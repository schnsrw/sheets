import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Note: React.StrictMode is intentionally NOT used.
// Univer mounts its own internal React root inside the container we hand it.
// StrictMode's intentional double-invocation of effects in dev unmounts/remounts
// the Univer instance before its first render completes, leaving the DOM in an
// inconsistent state (insertBefore/removeChild on detached nodes). This is the
// same pattern most heavy editor SDKs (Monaco, Univer, Lexical with portals)
// document. Restore StrictMode only at child boundaries that don't host Univer.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
