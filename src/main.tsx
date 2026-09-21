import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter ships with the app (no font requests to the network).
import '@fontsource-variable/inter'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
