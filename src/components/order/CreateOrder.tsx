import Image from "next/image"
import Link from "next/link"

export const CreateOrder = () => {
  return (
    <div className="flex px-4">
      <Link
        href="/create-order"
        className="group relative flex h-40 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#00ff99]/30 bg-white text-gray-900 shadow-md transition-transform hover:scale-105 hover:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-400 md:min-h-screen lg:w-48"
        aria-label="Create New Order"
      >
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#00ff99]/30 transition-colors group-hover:border-indigo-600">
          <Image src="/plus.svg" alt="Add new order" width={28} height={28} priority quality={100} />
        </div>
        <div className="select-none space-y-0.5 text-center text-lg font-semibold leading-tight">
          <p>Create</p>
          <p>New</p>
          <p>Order</p>
        </div>
        {/* Optional subtle overlay on hover */}
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-indigo-50 opacity-0 transition-opacity group-hover:opacity-20"></div>
      </Link>
    </div>
  )
}
