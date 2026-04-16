import Image from "next/image"
import { Gradients } from "../shared/Gradients"
import { OrderCardProps } from "@/constants/types"
import { ADDRESS_1, USDR } from "@/constants/utils/addresses"
import { ethers, parseUnits, formatUnits } from "ethers"

export const OrderCard = ({
  id,
  type,
  amount,
  token,
  date,
  icon1,
  icon2,
  isSelected,
  style,
  cardGradient,
}: OrderCardProps) => {
  return (
    <div
      className="h-full w-full overflow-hidden rounded-2xl border border-black bg-[#E5E5E5] font-[family-name:var(--font-outfit)]"
      style={style}
    >
      <div className="flex h-full flex-col">
        <div className="relative h-2/6">
          <div className="">
            <Gradients cardGradient={cardGradient} />
          </div>
          <div className="absolute left-4 top-2">
            <Image src={"/Union.svg"} alt="icon" width={17} height={17} priority quality={100} />
          </div>
        </div>

        <div className="h-4/6 rounded-b-2xl bg-white text-[#111111]">
          <div className="flex h-5/6 flex-col justify-between pl-4 pt-4">
            <div className="space-y-1 font-medium">
              <p className="text-[10px] text-[#111111]/60">ID: {id}</p>
              <h4 className="text-lg font-medium">{type} Order</h4>
            </div>

            <div>
              <div className="flex items-center gap-1">
                <h4 className="text-lg font-medium">{amount}</h4>
                <Image src={token} alt="token" width={15} height={15} priority quality={100} />
              </div>
              <p className="text-sm font-light">
                Exp <span className="pl-1 font-medium">{date}</span>
              </p>
            </div>
          </div>

          <div className="relative flex h-1/6 items-start justify-end space-x-[-8px] pr-4">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1F1E29]">
              <Image src={icon1 || ""} alt="icon" width={12} height={12} priority quality={100} />
            </div>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1F1E29]">
              <Image src={icon2 || ""} alt="icon" width={12} height={12} priority quality={100} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
