import { Header } from "@/components/shared/Header"

export default function OtherScreensLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative mx-auto w-[91%] text-white">
      <Header />
      <main className="pt-4">{children}</main>
    </section>
  )
}
