import { Header } from "@/components/shared/Header"

export default function OtherScreensLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative mx-auto w-full max-w-[1600px] px-3 text-white sm:px-4 md:w-[91%] md:px-0">
      <Header />
      <main className="min-w-0 pt-3 sm:pt-4">{children}</main>
    </section>
  )
}
