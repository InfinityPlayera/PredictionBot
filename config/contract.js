const CONTRACT_ABI = [
    // Events
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "sender",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "epoch",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "BetBear",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "sender",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "uint256",
                "name": "epoch",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
            }
        ],
        "name": "BetBull",
        "type": "event"
    },

    // View Functions
    {
        "inputs": [],
        "name": "currentEpoch",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "name": "rounds",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "epoch",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "startTimestamp",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "lockTimestamp",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "closeTimestamp",
                "type": "uint256"
            },
            {
                "internalType": "int256",
                "name": "lockPrice",
                "type": "int256"
            },
            {
                "internalType": "int256",
                "name": "closePrice",
                "type": "int256"
            },
            {
                "internalType": "uint256",
                "name": "totalAmount",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "bullAmount",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "bearAmount",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "rewardBaseCalAmount",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "rewardAmount",
                "type": "uint256"
            },
            {
                "internalType": "bool",
                "name": "oracleCalled",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "epoch",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "user",
                "type": "address"
            }
        ],
        "name": "claimable",
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

    // State Changing Functions
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "epoch",
                "type": "uint256"
            }
        ],
        "name": "betBear",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "epoch",
                "type": "uint256"
            }
        ],
        "name": "betBull",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256[]",
                "name": "epochs",
                "type": "uint256[]"
            }
        ],
        "name": "claim",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

module.exports = {
    CONTRACT_ABI
};
