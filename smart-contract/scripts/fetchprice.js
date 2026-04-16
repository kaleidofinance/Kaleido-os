const { ethers } = require("ethers");
const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

async function fetchPriceUpdate(priceFeedId) {
    // Construct the Hermes URL
    const hermesUrl = `https://hermes.pyth.network/api/latest_price_feeds?ids[]=${priceFeedId}`;

    try {
        // Make the GET request to fetch the data
        const response = await axios.get(hermesUrl, {
            headers: {
                'Content-Type': 'application/json',
            }
        });

        // Assuming the response data contains the price update
        const updateData = response.data;

        // Log the response data
        console.log("Response Data:", updateData);

        // Convert the response data into a hex string
        const hex = Buffer.from(JSON.stringify(updateData)).toString('hex');
        console.log("Hex Data:", hex);

        // Convert hex string back to byte array for contract interaction
        const byteArray = Buffer.from(hex, 'hex');
        console.log("Byte Array:", byteArray);

        // Now you can pass this byte array to the smart contract method
        await interactWithContract(byteArray);
        
    } catch (err) {
        console.error("Error fetching price update:", err.message);
        throw err;
    }
}

async function interactWithContract(byteArray) {
    // Abstract Testnet RPC URL (replace with the actual URL)
    const providerUrl = 'https://api.testnet.abs.xyz';
    
    // Use your private key to create a new Wallet instance for signing the transaction
    const privateKey = "9e5345ca0415a07573d5b63737e0126382daceb88286d6947055b3d49270c139"; // Make sure to store your private key securely
    const wallet = new ethers.Wallet(privateKey);

    // Connect the wallet to the provider (Abstract Testnet)
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const signer = wallet.connect(provider);

    // Define the contract address and ABI
    const contractAddress = "0x040487e2Ff00c61ad347E0c9a9E66ed4e4dda829"; // Contract deployed on Abstract Testnet
    const abi = [
        {
            "inputs": [
                {
                    "internalType": "bytes[]",
                    "name": "priceUpdate",
                    "type": "bytes[]"
                }
            ],
            "name": "exampleMethod",
            "outputs": [],
            "stateMutability": "payable",
            "type": "function"
        }
    ];

    // Create the contract instance with the signer
    const contract = new ethers.Contract(contractAddress, abi, signer);

    try {
        // Send the transaction to the contract with the byte array
        const tx = await contract.exampleMethod([byteArray]);  // Pass the byte array to the contract
        console.log("Transaction Sent: ", tx.hash);

        // Wait for the transaction to be mined
        await tx.wait();
        console.log("Transaction Mined: ", tx.hash);
    } catch (error) {
        console.error("Error interacting with contract:", error);
    }
}

// Fetch and process price update from Hermes
fetchPriceUpdate("0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace");
