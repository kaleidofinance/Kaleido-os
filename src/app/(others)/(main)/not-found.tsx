import React from "react"
import Link from "next/link"

const NotFoundPage = () => {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black">
      {/* Not found message */}
      <div className="relative z-10 flex flex-col items-center">
        <h1 className="mb-4 text-3xl font-bold text-green-400 drop-shadow-lg md:text-4xl">Not found</h1>
        <p className="mb-8 text-lg text-green-200">The page you are looking for does not exist.</p>
        <Link href="/">
          <button className="rounded bg-green-500 px-6 py-2 font-semibold text-black transition hover:bg-green-400">
            Return to Dashboard
          </button>
        </Link>
      </div>
    </div>
  )
}

export default NotFoundPage
