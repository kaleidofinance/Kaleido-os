import { ClosedOrder } from "./CloseOrder"
import { CreateOrder } from "./CreateOrder"
import { FilledOrder } from "./FilledOrder"
import { OpenOrder } from "./OpenOrder"
import { useMemo } from "react"

interface Order {
  status: string
  max_Amount: number
  returnDate: number
}

const OrdersDetails = ({ orderSample }: any) => {
  // console.log("OrderSAMPLE", orderSample);

  const now = Date.now()

  const filledOrders = useMemo(
    () => orderSample.filter((order: { status: string }) => order.status === "SERVICED"),
    [orderSample],
  )

  const openOrders = useMemo(
    () =>
      orderSample.filter(
        (order: { status: string; returnDate: number; max_amount: number }) => order.status === "OPEN",
      ),
    [orderSample, now],
  )

  const closedOrders = useMemo(
    () => orderSample.filter((order: { status: string }) => order.status === "CLOSED"),
    [orderSample],
  )

  // console.log("filledOrders", filledOrders)
  // console.log("openOrders", openOrders)

  return (
    <div className="u-class-shadow-2 min-h-[70vh] w-full bg-black/90 px-2 py-6 md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:gap-6">
        {/* Orders column */}
        <div className="flex w-full flex-col gap-6 md:w-3/4">
          <div className="rounded-2xl bg-[#101014] px-2 py-4 shadow-lg md:px-6">
            <FilledOrder orderSample={filledOrders} />
          </div>
          <div className="rounded-2xl bg-[#13131a] px-2 py-4 shadow-lg md:px-6">
            <OpenOrder orderSample={openOrders} />
          </div>
          <div className="rounded-2xl bg-[#101014] px-2 py-4 shadow-lg md:px-6">
            <ClosedOrder orderSample={closedOrders} />
          </div>
        </div>

        {/* Create Order card */}
        <div className="mt-2 flex w-full items-start justify-center md:mt-0 md:w-1/4">
          <div className="w-full max-w-xs">
            <CreateOrder />
          </div>
        </div>
      </div>
    </div>
  )
}

export default OrdersDetails
