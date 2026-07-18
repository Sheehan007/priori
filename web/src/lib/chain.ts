import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Address,
} from "viem";
import priori from "../contract/priori.json";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
});

const CHAIN_ID_HEX = "0x279f"; // 10143

export const CONTRACT_ADDRESS = priori.address as Address;
export const PRIORI_ABI = priori.abi;
export const DEPLOY_TX: string | null = (priori as any).deployTx ?? null;
export const IS_DEPLOYED =
  /^0x[0-9a-fA-F]{40}$/.test(priori.address) &&
  priori.address !== "0x0000000000000000000000000000000000000000";

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
});

function eth(): any {
  const provider = (window as any).ethereum;
  if (!provider) throw new Error("No injected wallet found — install MetaMask to continue.");
  return provider;
}

export function hasWallet(): boolean {
  return Boolean((window as any).ethereum);
}

export async function ensureMonad(): Promise<void> {
  const provider = eth();
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err: any) {
    if (err?.code === 4902 || /unrecognized chain/i.test(err?.message ?? "")) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: "Monad Testnet",
            nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
            rpcUrls: ["https://testnet-rpc.monad.xyz"],
            blockExplorerUrls: ["https://testnet.monadvision.com"],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function connect(): Promise<Address> {
  const provider = eth();
  const accounts: Address[] = await provider.request({ method: "eth_requestAccounts" });
  await ensureMonad();
  return accounts[0];
}

export async function currentAccount(): Promise<Address | null> {
  if (!hasWallet()) return null;
  const accounts: Address[] = await eth().request({ method: "eth_accounts" });
  return accounts[0] ?? null;
}

export function getWalletClient(account: Address) {
  return createWalletClient({ account, chain: monadTestnet, transport: custom(eth()) });
}

export const explorerTx = (hash: string) => `${monadTestnet.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddress = (addr: string) =>
  `${monadTestnet.blockExplorers.default.url}/address/${addr}`;

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
