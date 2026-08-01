"use client";

import React, { useState } from "react";
import { BellIcon, CheckIcon, TrashIcon, MixIcon } from "@radix-ui/react-icons";
import { useNotifications } from "@/context/NotificationsContext";

export default function NotificationsPage() {
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const [levelFilter, setLevelFilter] = useState<
    "all" | "info" | "warning" | "error" | "success"
  >("all");
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  } = useNotifications();

  const getLevelIcon = (level: string) => {
    switch (level) {
      case "success":
        return "✅";
      case "warning":
        return "⚠️";
      case "error":
        return "❌";
      default:
        return "ℹ️";
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  };

  const filteredNotifications = notifications.filter((notification) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "unread" && !notification.read) ||
      (filter === "read" && notification.read);

    const matchesLevel =
      levelFilter === "all" || notification.level === levelFilter;

    return matchesFilter && matchesLevel;
  });

  return (
    <div className="min-h-screen bg-black py-4 sm:py-8">
      <div className="mx-auto max-w-4xl px-3 sm:px-4">
        {/* Header */}
        <div className="mb-4 rounded-lg border border-[#232323] bg-[#18181b] p-4 shadow-sm sm:mb-6 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center space-x-3">
              <BellIcon className="w-8 h-8 text-gray-300" />
              <div>
                <h1 className="text-xl font-bold text-white sm:text-2xl">
                  Notifications
                </h1>
                <p className="text-gray-300">
                  {unreadCount} unread • {notifications.length} total
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#2a2a2a] px-4 py-2 text-sm text-white transition-colors hover:bg-[#333333] sm:text-base"
                >
                  <CheckIcon className="w-4 h-4" />
                  <span>Mark all read</span>
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700 sm:text-base"
                >
                  <TrashIcon className="w-4 h-4" />
                  <span>Clear all</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 rounded-lg border border-[#232323] bg-[#18181b] p-4 shadow-sm sm:mb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex items-center gap-2">
              <MixIcon className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-200">Filter:</span>
            </div>

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="min-h-10 w-full rounded-md border border-gray-700 bg-[#232323] px-3 py-2 text-sm text-white sm:w-auto sm:py-1"
            >
              <option value="all">All notifications</option>
              <option value="unread">Unread only</option>
              <option value="read">Read only</option>
            </select>

            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as any)}
              className="min-h-10 w-full rounded-md border border-gray-700 bg-[#232323] px-3 py-2 text-sm text-white sm:w-auto sm:py-1"
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
            <div className="rounded-lg border border-[#232323] bg-[#18181b] p-8 text-center shadow-sm sm:p-12">
              <BellIcon className="w-12 h-12 text-gray-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                No notifications
              </h3>
              <p className="text-gray-400">
                {notifications.length === 0
                  ? "You'll see notifications here when they arrive."
                  : "No notifications match your current filters."}
              </p>
            </div>
          ) : (
            filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                className={`rounded-lg border border-l-4 border-[#232323] p-4 shadow-sm transition-all hover:shadow-md sm:p-6 ${
                  notification.read ? "opacity-75" : ""
                } ${
                  notification.level === "success"
                    ? "border-l-green-500 bg-green-900/30"
                    : notification.level === "warning"
                      ? "border-l-gray-500 bg-[#2a2a2a]/30"
                      : notification.level === "error"
                        ? "border-l-red-500 bg-red-900/30"
                        : "border-l-gray-500 bg-[#2a2a2a]/30"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2 sm:gap-3">
                      <span className="text-lg">
                        {getLevelIcon(notification.level)}
                      </span>
                      <h3 className="min-w-0 flex-1 font-semibold text-white">
                        {notification.title}
                      </h3>
                      {!notification.read && (
                        <span className="px-2 py-1 bg-[#2a2a2a] text-gray-100 text-xs rounded-full">
                          New
                        </span>
                      )}
                    </div>
                    <p className="mb-3 break-words text-sm text-gray-200 sm:text-base">
                      {notification.body}
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm text-gray-400">
                        {formatTimestamp(notification.timestamp)}
                      </span>
                      <div className="flex w-full flex-wrap gap-3 sm:w-auto sm:gap-2">
                        {!notification.read && (
                          <button
                            onClick={() => markAsRead(notification.id)}
                            className="text-sm text-gray-300 hover:text-gray-300"
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
  );
}
