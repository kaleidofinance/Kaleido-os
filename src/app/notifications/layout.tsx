import Nav from "@/components/v2/Nav"

/**
 * Notifications rides the v2 shell now. It used to mount the legacy Header,
 * which was the last thing keeping that component — and its links to routes
 * that no longer exist — alive.
 */
export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="kaleido-v2">
      <Nav />
      <main className="mx-auto w-full max-w-[900px] px-5 pb-16 pt-2">{children}</main>
    </div>
  )
}
