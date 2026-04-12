import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'

export function useBootstrap(enabled: boolean) {
  const data = useAppStore((state) => state.data)
  const isLoading = useAppStore((state) => state.isLoading)
  const error = useAppStore((state) => state.error)
  const loadData = useAppStore((state) => state.loadData)

  useEffect(() => {
    if (enabled && !data && !isLoading && !error) {
      void loadData()
    }
  }, [enabled, data, isLoading, error, loadData])

  return { data, isLoading, error }
}
