import { create } from 'zustand'

type Toast = {
  id: string
  message: string
  tone: 'success' | 'info' | 'error'
}

type ToastStore = {
  toasts: Toast[]
  pushToast: (message: string, tone?: Toast['tone']) => void
  removeToast: (id: string) => void
}

function buildToastId() {
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  pushToast: (message, tone = 'info') => {
    const id = buildToastId()
    set({ toasts: [...get().toasts, { id, message, tone }] })
    window.setTimeout(() => {
      get().removeToast(id)
    }, 2800)
  },
  removeToast: (id) => {
    set({ toasts: get().toasts.filter((item) => item.id !== id) })
  },
}))
