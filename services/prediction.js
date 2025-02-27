const { ethers } = require('ethers');
require('dotenv').config();
const { CONTRACT_ABI } = require('../config/contract');

class Prediction {
    constructor() {
        if (!process.env.PREDICTION_ADDRESS) {
            throw new Error('Contract address not set in environment variable');
        }

        this.provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        this.contract = new ethers.Contract(process.env.PREDICTION_ADDRESS, CONTRACT_ABI, this.wallet);
    }

    async placeBullBet(epoch, amount) {
        try {
            const tx = await this.contract.betBull(epoch, {
                value: amount,
                gasLimit: 500000
            });
            const receipt = await tx.wait();
            return receipt;
        } catch (error) {
            console.error('Error placing bull bet: ', error);
            throw error;
        }
    }

    async placeBearBet(epoch, amount) {
        try {
            const tx = await this.contract.betBear(epoch, {
                value: amount,
                gasLimit: 500000
            });
            const receipt = await tx.wait();
            return receipt;
        } catch (error) {
            console.error('Error placing bull bet: ', error);
            throw error;
        }
    }

    async claim(epochs) {
        try {
            const tx = await this.contract.claim(epochs, {gasLimit: 500000});
            const receipt = await tx.wait();
            return receipt;
        } catch (error) {
            console.error('Error placing claim: ', error);
            throw error;
        }
    }
}

module.exports = Prediction;