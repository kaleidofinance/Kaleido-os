import { ethers } from "ethers";
import { diamondAbi } from "./abi/ProtocolFacet.js";
import dotenv from "dotenv";
dotenv.config();

async function test() {
    console.log("Testing candidate Diamond address...");
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const contractAddress = "0x2aC60481a9EA2e67D80CdfBF587c63c88A5874ac";
    console.log(`RPC: ${process.env.RPC_URL}`);
    console.log(`Contract: ${contractAddress}`);
    
    const contract = new ethers.Contract(contractAddress, diamondAbi, provider);
    
    try {
        const maxId = await contract.getListingId();
        console.log(`✅ Success! Max Listing ID: ${maxId}`);
    } catch (error) {
        console.error("❌ Error calling getListingId:");
        console.error(error.message || error);
    }
}

test();
