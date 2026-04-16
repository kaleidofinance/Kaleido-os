"use client"

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react"
import { v4 as uuidv4 } from "uuid"

// Play notification sound function (copied from notification service to avoid circular imports)
const playNotificationSound = (): void => {
  try {
    // Create a notification sound using Web Audio API
    if (typeof window !== "undefined" && "AudioContext" in window) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

      // Create a pleasant notification sound (two-tone chime)
      const playTone = (frequency: number, duration: number, delay: number = 0) => {
        setTimeout(() => {
          const oscillator = audioContext.createOscillator()
          const gainNode = audioContext.createGain()

          oscillator.connect(gainNode)
          gainNode.connect(audioContext.destination)

          oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime)
          oscillator.type = "sine"

          // Smooth fade in and out to avoid clicking sounds
          gainNode.gain.setValueAtTime(0, audioContext.currentTime)
          gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01)
          gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + duration - 0.01)
          gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration)

          oscillator.start(audioContext.currentTime)
          oscillator.stop(audioContext.currentTime + duration)
        }, delay)
      }

      // Play a pleasant two-tone notification sound
      playTone(800, 0.15, 0) // First tone (higher)
      playTone(600, 0.2, 100) // Second tone (lower) with slight delay

      // console.log("🔊 Notification sound played")
    }
  } catch (error) {
    // console.warn("Could not play notification sound:", error)
  }
}

interface Notification {
  id: string
  title: string
  body: string
  level: "info" | "warning" | "error" | "success"
  timestamp: number
  read: boolean
}

interface NotificationsContextType {
  notifications: Notification[]
  unreadCount: number
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  deleteNotification: (id: string) => void
  clearAll: () => void
  addNotification: (notification: Notification | Omit<Notification, "id" | "timestamp" | "read">) => void
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)

  // Load notifications from localStorage on startup
  const loadLocalNotifications = () => {
    try {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("kaleido_notifications")
        if (stored) {
          const parsedNotifications = JSON.parse(stored)
          // console.log("Loaded notifications from localStorage:", parsedNotifications.length)
          setNotifications(parsedNotifications)
          setUnreadCount(parsedNotifications.filter((n: Notification) => !n.read).length)
          return parsedNotifications
        }
      }
    } catch (error) {
      // console.error("Error loading notifications from localStorage:", error)
    }
    return []
  }

  // Save notifications to localStorage
  const saveLocalNotifications = (notifications: Notification[]) => {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("kaleido_notifications", JSON.stringify(notifications))
        // console.log("Saved notifications to localStorage:", notifications.length)
      }
    } catch (error) {
      // console.error("Error saving notifications to localStorage:", error)
    }
  }

  // Fetch notifications from server on startup
  const fetchNotificationsFromServer = async (isPeriodicSync = false, userAddress?: string) => {
    try {
      const backendHost =
        process.env.NEXT_PUBLIC_API_BASE ||
        (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000")

      // Include user filter if address is provided
      const url = userAddress
        ? `${backendHost}/notifications/history?user_address=${encodeURIComponent(userAddress)}`
        : `${backendHost}/notifications/history`

      const response = await fetch(url)
      if (response.ok) {
        const responseData = await response.json()
        const serverNotifications = responseData.notifications || []
        // console.log(
        //   `Fetched ${serverNotifications.length} notifications from server${userAddress ? ` for user ${userAddress}` : ""}`,
        // )

        // For periodic sync and initial load, merge with existing state to preserve read status
        setNotifications((prev) => {
          // Convert server format to our format
          const formattedNotifications: Notification[] = serverNotifications.map((notif: any) => {
            // Check if this notification already exists locally
            const existingNotif = prev.find((p) => p.id === (notif.id || notif.uuid))

            return {
              id: notif.id || notif.uuid || uuidv4(),
              title: notif.title || "",
              body: notif.body || "",
              level: notif.level || "info",
              timestamp: notif.timestamp || Date.now(),
              read: existingNotif ? existingNotif.read : false, // Preserve read status if exists, otherwise unread
            }
          })

          // For periodic sync, only update if there are actual changes
          if (isPeriodicSync) {
            const hasNewNotifications = formattedNotifications.some((notif) => !prev.some((p) => p.id === notif.id))
            const hasRemovedNotifications = prev.some((p) => !formattedNotifications.some((notif) => notif.id === p.id))

            if (!hasNewNotifications && !hasRemovedNotifications) {
              // console.log("Periodic sync: no changes detected")
              return prev // No changes, keep existing state
            }

            // console.log("Periodic sync detected changes, updating notifications")
          } else {
            // console.log("Initial load: setting notifications from server")
          }

          // Update unread count based on merged notifications
          const unreadCount = formattedNotifications.filter((n) => !n.read).length
          // console.log("Notification count update:", {
          //   totalNotifications: formattedNotifications.length,
          //   unreadCount: unreadCount,
          //   readCount: formattedNotifications.filter((n) => n.read).length,
          // })

          setUnreadCount(unreadCount)

          // Save to localStorage for persistence across refreshes
          saveLocalNotifications(formattedNotifications)

          return formattedNotifications
        })
      }
    } catch (error) {
      // console.error("Failed to fetch notifications from server:", error)
    }
  }

  useEffect(() => {
    // Track cleanup intervals
    let syncIntervalId: NodeJS.Timeout | null = null

    // Get user address from localStorage (faster than waiting for wallet connection)
    const getUserAddress = () => {
      try {
        const kaleidoAddress = localStorage.getItem("kaleidoAddress")
        if (kaleidoAddress) {
          // console.log("Using kaleidoAddress from localStorage:", kaleidoAddress)
          // Also set it in window object for WebSocket filtering consistency
          ;(window as any).kaleido_current_user_address = kaleidoAddress
          return kaleidoAddress
        }

        // console.log("No kaleidoAddress found - wallet not connected")
        return null
      } catch (error) {
        // console.error("Error getting user address:", error)
        return null
      }
    }

    // Check if wallet is connected
    const currentUserAddress = getUserAddress()

    if (currentUserAddress) {
      // console.log("Wallet connected, loading notifications for:", currentUserAddress)

      // Load notifications from localStorage for instant display
      loadLocalNotifications()

      // Fetch from server with user filter
      fetchNotificationsFromServer(false, currentUserAddress)

      // Set up periodic sync with user filter
      syncIntervalId = setInterval(() => {
        // Re-check address in case wallet disconnected
        const userAddress = getUserAddress()
        if (userAddress) {
          // console.log("Performing periodic notification sync for user:", userAddress)
          fetchNotificationsFromServer(true, userAddress)
        } else {
          // console.log("Wallet disconnected during sync, clearing notifications")
          setNotifications([])
          setUnreadCount(0)
          // Clear localStorage notifications since wallet is disconnected
          saveLocalNotifications([])
        }
      }, 60000) // Sync every minute

      // Connect to WebSocket immediately
      connectWebSocket()
    } else {
      // console.log("No wallet connected, not loading notifications")
      // Clear any existing notifications since wallet is not connected
      setNotifications([])
      setUnreadCount(0)
      // Clear localStorage notifications
      saveLocalNotifications([])
    }

    // Connect to WebSocket for real-time notifications
    function connectWebSocket() {
      const backendHost =
        process.env.NEXT_PUBLIC_API_BASE ||
        (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000")

      // Load notifications from localStorage first for instant display
      const localNotifications = loadLocalNotifications()

      // Get current user address from window object (set by Header)
      const currentUserAddress = (window as any).kaleido_current_user_address

      // Then fetch from server to get any new notifications (filtered by user if available)
      fetchNotificationsFromServer(false, currentUserAddress)

      // Set up periodic sync to catch any missed notifications
      const syncInterval = setInterval(() => {
        // console.log("Performing periodic notification sync...")
        const userAddress = (window as any).kaleido_current_user_address
        fetchNotificationsFromServer(true, userAddress)
      }, 60000) // Sync every minute

      // Connect to WebSocket for real-time notifications
      const connectWebSocket = () => {
        const backendHost =
          process.env.NEXT_PUBLIC_API_BASE ||
          (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000")

        // Convert HTTP to WebSocket protocol - use wss for https
        let wsHost = backendHost.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
        const ws = new WebSocket(wsHost + "/ws/receiver")

        // console.log("Attempting WebSocket connection to:", wsHost + "/ws/receiver")

        ws.onopen = () => {
          // console.log("WebSocket connected for notifications")
        }

        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data)

            // Handle different notification actions
            if (data.action === "delete") {
              // console.log("Delete command received:", data)
              // console.log("Looking for notification with target_id:", data.target_id)
              // Delete notification by ID - now we can use direct ID matching
              setNotifications((prev) => {
                // console.log(
                //   "Current notification IDs:",
                //   prev.map((n) => ({ id: n.id, title: n.title })),
                // )
                const updatedNotifications = prev.filter((n) => {
                  // Try direct ID matching first (now that IDs are synchronized)
                  if (data.target_id && n.id === data.target_id) {
                    // console.log("Deleting notification by ID match:", { id: n.id, title: n.title })
                    return false // Remove this notification
                  }

                  // Fallback to content-based matching for backward compatibility
                  if (data.target_id) {
                    const hasMatchingContent =
                      (n.title && data.original_title && n.title === data.original_title) ||
                      (n.body && data.original_body && n.body === data.original_body)

                    if (hasMatchingContent) {
                      // console.log("Deleting notification by content match:", { title: n.title, body: n.body })
                      return false // Remove this notification
                    }
                  }

                  return true // Keep this notification
                })
                // Update unread count
                const deletedCount = prev.length - updatedNotifications.length
                setUnreadCount((count) => Math.max(0, count - deletedCount))
                // console.log(`Delete command processed: ${deletedCount} notifications removed`)

                // Save to localStorage
                saveLocalNotifications(updatedNotifications)

                return updatedNotifications
              })
              // console.log("Notification deleted via WebSocket command")
            } else if (data.action === "modify") {
              // Modify existing notification with ID-based matching
              setNotifications((prev) => {
                let modified = false
                const updated = prev.map((n) => {
                  // Try direct ID matching first (now that IDs are synchronized)
                  if (!modified && data.target_id && n.id === data.target_id && data.modifications) {
                    // console.log("Modifying notification by ID match:", { id: n.id, title: n.title })
                    modified = true
                    return {
                      ...n,
                      title: data.modifications.title || n.title,
                      body: data.modifications.body || n.body,
                      timestamp: Date.now(), // Update timestamp to show it was modified
                    }
                  }

                  // Fallback to content-based matching for backward compatibility
                  if (!modified && data.modifications) {
                    const contentMatches =
                      (data.original_title && n.title === data.original_title) ||
                      (data.original_body && n.body === data.original_body)

                    if (contentMatches) {
                      // console.log("Modifying notification by content match:", { title: n.title, body: n.body })
                      modified = true
                      return {
                        ...n,
                        title: data.modifications.title || n.title,
                        body: data.modifications.body || n.body,
                        timestamp: Date.now(), // Update timestamp to show it was modified
                      }
                    }
                  }
                  return n
                })

                if (!modified) {
                  // console.warn("No matching notification found for modification:", data.target_id)
                } else {
                  // Save to localStorage only if modification was successful
                  saveLocalNotifications(updated)
                }

                return updated
              })
              // console.log("Notification modified via WebSocket command")
            } else if (data && data.title) {
              // Default: Add new notification (but check for duplicates with server-fetched notifications)
              // Filter user-specific notifications

              const currentUserAddress = (window as any).kaleido_current_user_address

              // console.log("🔍 Notification filtering debug:", {
              //   notificationTitle: data.title,
              //   notificationTargetUser: data.metadata?.target_user || data.target_user,
              //   currentUserAddress: currentUserAddress,
              //   metadataUserAddress: data.metadata?.user_address,
              //   actionType: data.metadata?.action_type || data.action_type,
              // })

              // Hardened Filter: If this signal has a target_user, it MUST match the current wallet
              const targetUser = data.metadata?.target_user || data.target_user
              if (targetUser) {
                // Block if no wallet is connected OR if it's the wrong wallet
                if (!currentUserAddress || targetUser.toLowerCase() !== currentUserAddress.toLowerCase()) {
                  // console.log("🔒 Security block: signal for another user or no auth")
                  return
                }
              } else {
                // console.log("General notification (no target_user) - showing to all users")
              }

              const newNotification: Notification = {
                id: data.id || uuidv4(), // Use provided ID or generate new one
                title: data.title,
                body: data.body || "",
                level: data.level || "info",
                timestamp: Date.now(),
                read: false,
              }

              // Check if this notification already exists (from server fetch)
              setNotifications((prev) => {
                const exists = prev.some(
                  (n) =>
                    n.id === newNotification.id ||
                    (n.title === newNotification.title && n.body === newNotification.body),
                )

                if (exists) {
                  // console.log("Duplicate notification detected, skipping:", newNotification.title)
                  return prev
                }

                // console.log("Adding new real-time notification:", newNotification.title)

                // Play notification sound for new notifications
                playNotificationSound()

                setUnreadCount((count) => count + 1)
                const updated = [newNotification, ...prev.slice(0, 49)]
                saveLocalNotifications(updated)
                return updated
              })

              // Show browser notification
              if (typeof window !== "undefined" && "Notification" in window) {
                if (Notification.permission === "granted") {
                  new Notification(data.title, { body: data.body || "" })
                } else if (Notification.permission !== "denied") {
                  Notification.requestPermission().then((permission) => {
                    if (permission === "granted") {
                      new Notification(data.title, { body: data.body || "" })
                    }
                  })
                }
              }
            }
          } catch (err) {
            // console.error("WebSocket parse error:", err)
          }
        }

        ws.onerror = (e) => {
          // console.error("WebSocket error:", e)
        }

        ws.onclose = () => {
          // console.log("WebSocket disconnected, attempting to reconnect...")
          setTimeout(connectWebSocket, 5000)
        }

        wsRef.current = ws
      }

      connectWebSocket()

      return () => {
        if (wsRef.current) {
          wsRef.current.close()
        }
        if (syncIntervalId) {
          clearInterval(syncIntervalId)
        }
      }
    }
  }, [])

  const addNotification = (notification: Notification | Omit<Notification, "id" | "timestamp" | "read">) => {
    setNotifications((prev) => {
      // Handle both full Notification objects and partial ones
      const fullNotification: Notification =
        "id" in notification
          ? notification
          : {
              ...notification,
              id: uuidv4(),
              timestamp: Date.now(),
              read: false,
            }

      // Check for duplicates by ID or content
      if (
        prev.some(
          (n) =>
            n.id === fullNotification.id ||
            (n.title === fullNotification.title &&
              n.body === fullNotification.body &&
              n.level === fullNotification.level &&
              !n.read),
        )
      ) {
        return prev // Don't add duplicate
      }

      setUnreadCount((count) => count + 1)
      const updated = [fullNotification, ...prev.slice(0, 49)]
      saveLocalNotifications(updated)
      return updated
    })
  }

  const markAsRead = (id: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      saveLocalNotifications(updated)
      return updated
    })
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }

  const markAllAsRead = () => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }))
      saveLocalNotifications(updated)
      return updated
    })
    setUnreadCount(0)
  }

  const deleteNotification = (id: string) => {
    setNotifications((prev) => {
      const notification = prev.find((n) => n.id === id)
      if (notification && !notification.read) {
        setUnreadCount((count) => Math.max(0, count - 1))
      }
      const updated = prev.filter((n) => n.id !== id)
      saveLocalNotifications(updated)
      return updated
    })
  }

  const clearAll = () => {
    setNotifications([])
    setUnreadCount(0)
    saveLocalNotifications([])
  }

  const value: NotificationsContextType = {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    addNotification,
  }

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications() {
  const context = useContext(NotificationsContext)
  if (context === undefined) {
    throw new Error("useNotifications must be used within a NotificationsProvider")
  }
  return context
}
