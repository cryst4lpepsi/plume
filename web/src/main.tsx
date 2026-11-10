import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './fonts'
import './styles/tokens.css'
import './styles/base.css'
import './styles/globe.css'
import './styles/terminal.css'
import './styles/methods.css'
import { applyFontSystem } from './fonts'
import App from './App'

applyFontSystem().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  )
})
