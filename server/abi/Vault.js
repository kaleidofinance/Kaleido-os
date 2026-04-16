export const vaultAbi = [
    {
      "inputs": [],
      "name": "OwnableUnauthorizedAccount",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "OwnableInvalidOwner",
      "type": "error"
    },
      {
          "inputs": [],
          "name": "EthAmountMismatch",
          "type": "error"
      },
      {
          "inputs": [],
          "name": "EthTransferFailed",
          "type": "error"
      },
      {
          "inputs": [],
          "name": "InvalidFeeAmount",
          "type": "error"
      },
      {
          "inputs": [],
          "name": "InvalidRecipient",
          "type": "error"
      },
      {
          "inputs": [],
          "name": "InvalidTokenAddress",
          "type": "error"
      },
      {
          "inputs": [
              {
                  "internalType": "address",
                  "name": "owner",
                  "type": "address"
              }
          ],
          "name": "OwnableInvalidOwner",
          "type": "error"
      },
      {
          "inputs": [
              {
                  "internalType": "address",
                  "name": "account",
                  "type": "address"
              }
          ],
          "name": "OwnableUnauthorizedAccount",
          "type": "error"
      },
      {
          "inputs": [],
          "name": "ReentrancyGuardReentrantCall",
          "type": "error"
      },
      {
          "inputs": [
              {
                  "internalType": "address",
                  "name": "token",
                  "type": "address"
              }
          ],
          "name": "SafeERC20FailedOperation",
          "type": "error"
      },
      {
          "inputs": [],
          "name": "VaultNotPaused",
          "type": "error"
      },
      {
          "inputs": [],
          "name": "VaultPaused",
          "type": "error"
      },
      {
          "anonymous": false,
          "inputs": [
              {
                  "indexed": true,
                  "internalType": "address",
                  "name": "user",
                  "type": "address"
              },
              {
                  "indexed": true,
                  "internalType": "address",
                  "name": "token",
                  "type": "address"
              },
              {
                  "indexed": false,
                  "internalType": "uint256",
                  "name": "amount",
                  "type": "uint256"
              }
          ],
          "name": "Deposit",
          "type": "event"
      },
      {
          "anonymous": false,
          "inputs": [
              {
                  "indexed": true,
                  "internalType": "address",
                  "name": "previousOwner",
                  "type": "address"
              },
              {
                  "indexed": true,
                  "internalType": "address",
                  "name": "newOwner",
                  "type": "address"
              }
          ],
          "name": "OwnershipTransferred",
          "type": "event"
      },
      {
          "anonymous": false,
          "inputs": [
              {
                  "indexed": true,
                  "internalType": "address",
                  "name": "admin",
                  "type": "address"
              }
          ],
          "name": "Paused",
          "type": "event"
      },
      {
          "anonymous": false,
          "inputs": [
              {
                  "indexed": false,
                  "internalType": "address[]",
                  "name": "tokens",
                  "type": "address[]"
              }
          ],
          "name": "TokensAdded",
          "type": "event"
      },
      {
          "anonymous": false,
          "inputs": [
              {
                  "indexed": true,
                  "internalType": "address",
                  "name": "admin",
                  "type": "address"
              }
          ],
          "name": "Unpaused",
          "type": "event"
      },
      {
          "anonymous": false,
          "inputs": [
              {
                  "indexed": true,
                  "internalType": "address",
                  "name": "to",
                  "type": "address"
              },
              {
                  "indexed": true,
                  "internalType": "address",
                  "name": "token",
                  "type": "address"
              },
              {
                  "indexed": false,
                  "internalType": "uint256",
                  "name": "amount",
                  "type": "uint256"
              }
          ],
          "name": "Withdraw",
          "type": "event"
      },
      {
          "inputs": [],
          "name": "NATIVE_TOKEN",
          "outputs": [
              {
                  "internalType": "address",
                  "name": "",
                  "type": "address"
              }
          ],
          "stateMutability": "view",
          "type": "function"
      },
      {
          "inputs": [
              {
                  "internalType": "address[]",
                  "name": "tokens",
                  "type": "address[]"
              }
          ],
          "name": "addTokens",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
      },
      {
          "inputs": [
              {
                  "internalType": "address",
                  "name": "token",
                  "type": "address"
              },
              {
                  "internalType": "uint256",
                  "name": "amount",
                  "type": "uint256"
              }
          ],
          "name": "depositFees",
          "outputs": [],
          "stateMutability": "payable",
          "type": "function"
      },
      {
          "inputs": [],
          "name": "getAcceptedTokens",
          "outputs": [
              {
                  "internalType": "address[]",
                  "name": "",
                  "type": "address[]"
              }
          ],
          "stateMutability": "view",
          "type": "function"
      },
      {
          "inputs": [
              {
                  "internalType": "address",
                  "name": "",
                  "type": "address"
              }
          ],
          "name": "isAcceptedToken",
          "outputs": [
              {
                  "internalType": "bool",
                  "name": "",
                  "type": "bool"
              }
          ],
          "stateMutability": "view",
          "type": "function"
      },
      {
          "inputs": [],
          "name": "owner",
          "outputs": [
              {
                  "internalType": "address",
                  "name": "",
                  "type": "address"
              }
          ],
          "stateMutability": "view",
          "type": "function"
      },
      {
          "inputs": [],
          "name": "pause",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
      },
      {
          "inputs": [],
          "name": "renounceOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
      },
      {
          "inputs": [
              {
                  "internalType": "address",
                  "name": "newOwner",
                  "type": "address"
              }
          ],
          "name": "transferOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
      },
      {
          "inputs": [],
          "name": "unpause",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
      },
      {
          "inputs": [
              {
                  "internalType": "address",
                  "name": "token",
                  "type": "address"
              },
              {
                  "internalType": "uint256",
                  "name": "amount",
                  "type": "uint256"
              },
              {
                  "internalType": "address payable",
                  "name": "to",
                  "type": "address"
              }
          ],
          "name": "withdrawFees",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
      },
      {
          "stateMutability": "payable",
          "type": "receive"
      }
    
  ]