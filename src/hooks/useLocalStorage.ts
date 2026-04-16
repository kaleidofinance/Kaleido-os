import { useCallback, useState } from "react"

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState(() => {
    try {
      const currentValue = localStorage.getItem(key)
      if (!currentValue) localStorage.setItem(key, JSON.stringify(initialValue))
      return currentValue ? (JSON.parse(currentValue) as T) : initialValue
    } catch (error) {
      return initialValue
    }
  })

  const set = useCallback(
    (newValue: T) => {
      setValue(newValue)
      localStorage.setItem(key, JSON.stringify(newValue))
    },
    [key],
  )

  return [value, set] as const
}
