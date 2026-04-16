"use client"

import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { ReactNode, useState } from "react"

type DropdownProps = {
  trigger: ReactNode
  children: ReactNode
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  sideOffset?: number
}

export default function Dropdown({
  trigger,
  children,
  side = "bottom",
  align = "start",
  sideOffset = 8,
}: DropdownProps) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="rounded-lg border border-[#404040] bg-[#2a2a2a] p-4 shadow-xl"
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
