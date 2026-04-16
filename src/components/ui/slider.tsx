import * as React from "react"
import { Slider } from "radix-ui"
import { SliderControlProps } from "@/constants/types"
import useDataFiltersPanel from "@/hooks/useDataFilterPanel"

const SliderControl: React.FC<SliderControlProps> = ({ min, max = 100, step = 1 }) => {
  const filters = useDataFiltersPanel()

  return (
    <div className="w-full">
      <Slider.Root
        id="slider"
        className="relative flex h-5 w-full touch-none select-none items-center"
        value={[filters.interestRate]}
        onValueChange={filters.updateSliderValue}
        min={min}
        max={max}
        step={step}

        // onClick={() => filters.handleLendInterestFilter(filters.interestRate)}
      >
        <Slider.Track className="relative h-1 flex-grow rounded-full bg-gray-300">
          <Slider.Range className="absolute h-full rounded-full bg-[#FF4D00]" />
        </Slider.Track>
        <Slider.Thumb
          className="block h-5 w-5 cursor-pointer rounded-full border border-[#FF4D00] bg-[#FF4D00] shadow hover:outline-none hover:ring-2 hover:ring-[#FF4D00] focus:outline-none focus:ring-2 focus:ring-[#FF4D00]"
          aria-label="Volume"
          aria-valuenow={filters.interestRate}
        />
      </Slider.Root>
    </div>
  )
}

export default SliderControl
