"use client"
import { useState, useEffect } from "react"
import { getERC20Contract } from "@/config/contracts"
import { getProviderByChainId, getUsdcAddressByChainId } from "@/constants/utils/getUsdcBalance"
import { getContractAddressesByChainId } from "@/config/getContractByChain"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { USDR, kfUSD_ADDRESS, USDT_ADDRESS } from "@/constants/utils/addresses"

const useCheckAllowance = () => {
  const [val, setVal] = useState(0)
  const [usdrVal, setUsdrVal] = useState(0)
  const [kfusdVal, setKfusdVal] = useState(0)
  const [usdtVal, setUsdtVal] = useState(0)
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const address = activeAccount?.address

  useEffect(() => {
    const usdcAddress = getUsdcAddressByChainId(chainId)
    const provider = getProviderByChainId(chainId)
    const destination = getContractAddressesByChainId(chainId)
    // console.log("DESTINATION", destination);
    // console.log("usdcAddress", usdcAddress);

    const usdcContract = getERC20Contract(provider, usdcAddress)
    const usdrContract = getERC20Contract(provider, USDR)
    const kfusdContract = getERC20Contract(provider, kfUSD_ADDRESS)
    const usdtContract = getERC20Contract(provider, USDT_ADDRESS)

    usdcContract
      .allowance(address, destination)
      .then((res) => {
        // console.log("RESPONSESSSS", res);
        setVal(Number(res))
      })
      .catch((err) => {
        // console.error("error allowance status: ", err)
        setVal(0)
      })

    usdrContract
      .allowance(address, destination)
      .then((res) => {
        // console.log("RESPONSESSSS", res);
        setUsdrVal(Number(res))
      })
      .catch((err) => {
        // console.error("error allowance status: ", err)
        setUsdrVal(0)
      })
    
     kfusdContract
      .allowance(address, destination)
      .then((res) => {
        setKfusdVal(Number(res))
      })
      .catch((err) => {
        setKfusdVal(0)
      })

    usdtContract
      .allowance(address, destination)
      .then((res) => {
        setUsdtVal(Number(res))
      })
      .catch((err) => {
        setUsdtVal(0)
      })
  }, [address, chainId])

  return { val, usdrVal, kfusdVal, usdtVal }
}

export default useCheckAllowance
