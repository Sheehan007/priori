const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY in .env");
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`network:  ${network.name} (chainId ${network.config.chainId})`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`balance:  ${ethers.formatEther(balance)} MON`);

  if (balance === 0n) {
    throw new Error(`Deployer has 0 MON. Fund ${deployer.address} at https://faucet.monad.xyz`);
  }

  const Factory = await ethers.getContractFactory("Priori");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const tx = contract.deploymentTransaction();
  console.log(`\nPriori deployed: ${address}`);
  console.log(`tx:              ${tx?.hash}`);
  console.log(`explorer:        https://testnet.monadvision.com/address/${address}`);

  // Publish address + ABI for the frontend to consume.
  const { abi } = await artifacts.readArtifact("Priori");
  const outDir = path.join(__dirname, "..", "web", "src", "contract");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "priori.json"),
    JSON.stringify(
      {
        address,
        chainId: network.config.chainId,
        deployTx: tx?.hash ?? null,
        deployedAt: new Date().toISOString(),
        abi,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nwrote web/src/contract/priori.json`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
