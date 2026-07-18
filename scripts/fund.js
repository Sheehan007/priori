/**
 * Move testnet MON from the throwaway deployer to your own wallet, so you can
 * pay gas for seal/reveal transactions.
 *
 *   node scripts/fund.js <your-address> [amount-in-MON]
 *
 * Example: node scripts/fund.js 0x553c...5ff7 2
 */
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";

async function main() {
  const to = process.argv[2];
  const amount = process.argv[3] || "2";

  if (!to || !ethers.isAddress(to)) {
    throw new Error("Usage: node scripts/fund.js <your-address> [amount-in-MON]");
  }
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("DEPLOYER_PRIVATE_KEY missing from .env");
  }

  const provider = new ethers.JsonRpcProvider(RPC, 10143);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  // Guard: a plain MON transfer to a contract reverts (Priori has no receive()).
  // Easy mistake, since the contract address is the one printed everywhere.
  const code = await provider.getCode(to);
  if (code !== "0x") {
    throw new Error(
      `${to} is a CONTRACT, not a wallet — a plain transfer there will revert.\n` +
        `You want your MetaMask account address (shown in the app header), not the Priori contract.`,
    );
  }

  const from = await wallet.getAddress();
  const balance = await provider.getBalance(from);
  const value = ethers.parseEther(amount);

  console.log(`from:   ${from}  (${ethers.formatEther(balance)} MON)`);
  console.log(`to:     ${to}`);
  console.log(`amount: ${amount} MON`);

  if (balance <= value) {
    throw new Error(`Deployer only holds ${ethers.formatEther(balance)} MON — lower the amount.`);
  }

  const tx = await wallet.sendTransaction({ to, value });
  console.log(`\nsent: ${tx.hash}`);
  console.log(`explorer: https://testnet.monadvision.com/tx/${tx.hash}`);
  await tx.wait();

  const after = await provider.getBalance(to);
  console.log(`\nconfirmed. recipient balance: ${ethers.formatEther(after)} MON`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
