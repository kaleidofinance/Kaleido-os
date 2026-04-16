"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { Cross2Icon } from "@radix-ui/react-icons"
import Image from "next/image"
import Link from "next/link"
import { useEffect, useState } from "react"
import screens from "../ui/screen"
import { shareTechMono, zenDots } from "@/lib/font"

export const WelcomeDialog = () => {
  const [open, setOpen] = useState(false);
  const [screenIndex, setScreenIndex] = useState(0);

  useEffect(() => {
    const hasSeenModal = localStorage.getItem("kaleido_seen_welcome");
    if (hasSeenModal === "true") {
      setOpen(false);
    } else {
      setOpen(true);
    }
  }, []);

  const handleClose = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      localStorage.setItem("kaleido_seen_welcome", "true");
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('kaleido_welcome_closed'));
      }
    }
  };

  const nextScreen = () => {
    if (screenIndex < screens.length - 1) {
      setScreenIndex((prev) => prev + 1)
    }
  }

  const prevScreen = () => {
    if (screenIndex > 0) {
      setScreenIndex((prev) => prev - 1)
    }
  }

  const { headline, body, action } = screens[screenIndex]

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 z-40 bg-black/80`} />
        <Dialog.Content
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className={`${shareTechMono.className} ${zenDots.variable} fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#36b169] bg-[#0e0e0e] px-6 py-4 shadow-lg`}
        >
          <Dialog.Title />
          {/* Header */}
          <div className="mb-4 flex items-center justify-between border-b border-[#36b169] pb-2">
            <h2 className="text-sm font-semibold text-white">Get Started</h2>
            <Dialog.Close className="text-[#36b169] transition hover:text-white focus:outline-none">
              <Cross2Icon />
            </Dialog.Close>
          </div>

          {/* Logo */}
          <div className="mb-4 flex justify-center">
            <Image src="/newkal.png" alt="Kaleido Logo" height={100} width={106} priority quality={100} />
          </div>

          {/* Headline */}
          <h1 className="mb-4 text-center text-xl font-bold text-[#36b169]">{headline}</h1>

          {/* Body */}
          <p className="mb-6 text-center text-sm leading-relaxed text-gray-300">{body}</p>

          {/* Action */}
          <p className="mb-6 text-center text-sm text-gray-400">{action}</p>

          {/* Navigation */}
          <div className="flex justify-center gap-4">
            <button
              onClick={prevScreen}
              disabled={screenIndex === 0}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#36b169] bg-[#1a1a1a] text-white hover:bg-[#36b169]/20 disabled:opacity-30"
            >
              &lt;
            </button>
            <button
              onClick={nextScreen}
              disabled={screenIndex === screens.length - 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#36b169] font-bold text-black hover:bg-[#2e9e56] disabled:opacity-30"
            >
              &gt;
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
