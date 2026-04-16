"use client"
import { Spinner } from "@radix-ui/themes"

export const LoadingScreen = () => {
  return (
    <div className="absolute inset-0 z-50 flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black">
      <p className="spaxe-x-2 flex flex-row text-lg text-white">
        <Spinner className="h-5 w-5" />
      </p>
    </div>
  )
}

export default function Loading() {
  return (
    <div className="flex justify-center items-center p-8">
      <Spinner className="h-5 w-5" />
    </div>
  );
}
