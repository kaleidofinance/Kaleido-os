import { Header } from "@/components/shared/Header"

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative mx-auto w-[91%] min-h-screen bg-black text-white">
      <Header />
      <main className="pt-6 sm:pt-4">{children}</main>
    </section>
  )
} 