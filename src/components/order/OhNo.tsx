import Image from "next/image";
import Link from "next/link";
import { Btn } from "../shared/Btn";

interface OhNoProps {
  onCreateOrder?: () => void;
}

const OhNo = ({ onCreateOrder }: OhNoProps) => {
  return (
    <div>
      <div className="flex flex-col items-center gap-1 text-white/50">
        <div>
          <Image
            src={"/Eye.svg"}
            alt="nothig"
            width={56}
            height={56}
            priority
            quality={100}
          />
        </div>

        <div className="text-center text-3xl sm:text-[70px]">
          <h3>uh-oh!</h3>
        </div>

        <div className="text-center text-base sm:text-3xl">
          <p>There&apos;s nothing here.</p>
        </div>

        <div className="mt-3 text-center text-sm leading-relaxed sm:mt-4 sm:text-3xl">
          <p>
            Let's get things rolling—create your <br />
            first order now and start your
            <br />
            lending adventure!
          </p>
        </div>

        <div className="mt-5 flex flex-col items-center gap-3 text-white sm:mt-6 sm:flex-row sm:gap-4">
          {onCreateOrder ? (
            <>
              <button
                onClick={onCreateOrder}
                className="w-fit p-2 rounded-lg cursor-pointer bg-[#21c17f] text-xs flex items-center gap-3"
              >
                Create Borrow Order
                <Image
                  src={"/plusBtn.svg"}
                  alt="btn"
                  width={16}
                  height={16}
                  priority
                  quality={100}
                />
              </button>

              <button
                onClick={onCreateOrder}
                className="w-fit p-2 rounded-lg cursor-pointer bg-[#24b25a] text-xs flex items-center gap-3"
              >
                Create Lend Order
                <Image
                  src={"/plusBtn.svg"}
                  alt="btn"
                  width={16}
                  height={16}
                  priority
                  quality={100}
                />
              </button>
            </>
          ) : (
            <>
              <Link
                href={"/create-order"}
                className="w-fit p-2 rounded-lg cursor-pointer bg-[#21c17f] text-xs flex items-center gap-3"
              >
                Create Borrow Order
                <Image
                  src={"/plusBtn.svg"}
                  alt="btn"
                  width={16}
                  height={16}
                  priority
                  quality={100}
                />
              </Link>

              <Link
                href={"/create-order"}
                className="w-fit p-2 rounded-lg cursor-pointer bg-[#24b25a] text-xs flex items-center gap-3"
              >
                Create Lend Order
                <Image
                  src={"/plusBtn.svg"}
                  alt="btn"
                  width={16}
                  height={16}
                  priority
                  quality={100}
                />
              </Link>
            </>
          )}
        </div>

        <div className="mt-6">
          <Image
            src={"/white-logo-horizontal.png"}
            alt="logo"
            width={220}
            height={43}
            priority
            quality={100}
          />
        </div>
      </div>
    </div>
  );
};

export default OhNo;
