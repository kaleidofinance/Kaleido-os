export function SwapBanner() {
  return (
    <header className="w-full rounded-lg border border-[#1a9443] bg-black sm:px-10">
      <div className="flex w-full flex-col items-start justify-between p-4 lg:flex-row lg:items-center lg:p-0">
        {/* Title and Description */}
        <div className="w-full text-start lg:w-2/3">
          <h3 className="text-2xl font-bold sm:text-3xl lg:text-[40px]">Trade Tokens Instantly</h3>
          <p className="mt-2 text-sm sm:text-base lg:text-[15px]">
            Swap between different tokens on the Abstract blockchain with low fees and fast execution.
          </p>
        </div>
      </div>
    </header>
  );
}
