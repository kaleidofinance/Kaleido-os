"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ReactNode } from "react";

interface DialogProps {
  children: ReactNode;
}

interface DialogTriggerProps extends DialogProps {
  asChild?: boolean;
}

interface DialogContentProps extends DialogProps {
  className?: string;
}

interface DialogHeaderProps extends DialogProps {}

interface DialogTitleProps extends DialogProps {}

export const DialogRoot = Dialog.Root;
export const DialogTrigger = ({ children, asChild = false }: DialogTriggerProps) => (
  <Dialog.Trigger asChild={asChild}>{children}</Dialog.Trigger>
);

export const DialogContent = ({ children, className = "" }: DialogContentProps) => (
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
    <Dialog.Content
      className={`fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/95 backdrop-blur-sm border border-[#00ff99]/40 p-6 shadow-lg ${className}`}
    >
      {children}
    </Dialog.Content>
  </Dialog.Portal>
);

export const DialogHeader = ({ children }: DialogHeaderProps) => (
  <div className="mb-4">{children}</div>
);

export const DialogTitle = ({ children }: DialogTitleProps) => (
  <Dialog.Title className="text-lg font-semibold text-white">{children}</Dialog.Title>
);
