"use client"

import React, { useState } from 'react'
import { BellIcon, CheckIcon, TrashIcon, MixIcon } from '@radix-ui/react-icons'
import { useNotifications } from '@/context/NotificationsContext'

export default function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [levelFilter, setLevelFilter] = useState<'all' | 'info' | 'warning' | 'error' | 'success'>('all')
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification, clearAll } = useNotifications()

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'success': return 'bg-green-100 border-green-500 text-green-800'
      case 'warning': return 'bg-yellow-100 border-yellow-500 text-yellow-800'
      case 'error': return 'bg-red-100 border-red-500 text-red-800'
      default: return 'bg-blue-100 border-blue-500 text-blue-800'
    }
  }

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'success': return '✅'
      case 'warning': return '⚠️'
      case 'error': return '❌'
      default: return 'ℹ️'
    }
  }

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  const filteredNotifications = notifications.filter(notification => {
    const matchesFilter = filter === 'all' || 
      (filter === 'unread' && !notification.read) ||
      (filter === 'read' && notification.read)
    
    const matchesLevel = levelFilter === 'all' || notification.level === levelFilter
    
    return matchesFilter && matchesLevel
  })

  return (
    <div className="min-h-screen bg-black py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="bg-[#18181b] rounded-lg shadow-sm p-6 mb-6 border border-[#232323]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <BellIcon className="w-8 h-8 text-blue-400" />
              <div>
                <h1 className="text-2xl font-bold text-white">Notifications</h1>
                <p className="text-gray-300">
                  {unreadCount} unread • {notifications.length} total
                </p>
              </div>
            </div>
            <div className="flex space-x-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <CheckIcon className="w-4 h-4" />
                  <span>Mark all read</span>
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <TrashIcon className="w-4 h-4" />
                  <span>Clear all</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-[#18181b] rounded-lg shadow-sm p-4 mb-6 border border-[#232323]">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <MixIcon className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-200">Filter:</span>
            </div>
            
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="px-3 py-1 border border-gray-700 rounded-md text-sm bg-[#232323] text-white"
            >
              <option value="all">All notifications</option>
              <option value="unread">Unread only</option>
              <option value="read">Read only</option>
            </select>

            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as any)}
              className="px-3 py-1 border border-gray-700 rounded-md text-sm bg-[#232323] text-white"
            >
              <option value="all">All levels</option>
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>

        {/* Notifications List */}
        <div className="space-y-4">
          {filteredNotifications.length === 0 ? (
            <div className="bg-[#18181b] rounded-lg shadow-sm p-12 text-center border border-[#232323]">
              <BellIcon className="w-12 h-12 text-gray-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">No notifications</h3>
              <p className="text-gray-400">
                {notifications.length === 0 
                  ? "You'll see notifications here when they arrive."
                  : "No notifications match your current filters."
                }
              </p>
            </div>
          ) : (
            filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                className={`rounded-lg shadow-sm p-6 border-l-4 transition-all hover:shadow-md border border-[#232323] ${
                  notification.read ? 'opacity-75' : ''
                } ${
                  notification.level === 'success' ? 'border-l-green-500 bg-green-900/30' :
                  notification.level === 'warning' ? 'border-l-yellow-500 bg-yellow-900/30' :
                  notification.level === 'error' ? 'border-l-red-500 bg-red-900/30' :
                  'border-l-blue-500 bg-blue-900/30'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <span className="text-lg">{getLevelIcon(notification.level)}</span>
                      <h3 className="font-semibold text-white">{notification.title}</h3>
                      {!notification.read && (
                        <span className="px-2 py-1 bg-blue-800 text-blue-100 text-xs rounded-full">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-gray-200 mb-3">{notification.body}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">
                        {formatTimestamp(notification.timestamp)}
                      </span>
                      <div className="flex space-x-2">
                        {!notification.read && (
                          <button
                            onClick={() => markAsRead(notification.id)}
                            className="text-sm text-blue-300 hover:text-blue-500"
                          >
                            Mark read
                          </button>
                        )}
                        <button
                          onClick={() => deleteNotification(notification.id)}
                          className="text-sm text-red-400 hover:text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
} 