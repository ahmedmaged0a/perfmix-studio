import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import { ResetPasswordPage } from './components/auth/ResetPasswordPage'
import './style.css'

// Apply saved theme before first render to prevent flash
try {
  const saved = localStorage.getItem('perfmix-theme')
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved)
  }
} catch { /* ignore */ }

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
