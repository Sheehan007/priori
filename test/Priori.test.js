const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/** Mirrors the contract: keccak256(abi.encode(plaintext, salt)) */
function commitHash(plaintext, salt) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "bytes32"],
    [plaintext, salt],
  );
  return ethers.keccak256(encoded);
}

const HYPOTHESIS = JSON.stringify({
  strategy: "btc-momentum",
  symbol: "BTC-USD",
  lookbackDays: 20,
  thresholdBps: 0,
});

describe("Priori", function () {
  let priori, author, salt;

  beforeEach(async function () {
    [author] = await ethers.getSigners();
    salt = ethers.hexlify(ethers.randomBytes(32));
    const Factory = await ethers.getContractFactory("Priori");
    priori = await Factory.deploy();
    await priori.waitForDeployment();
  });

  it("refuses an evaluation window that is not in the future", async function () {
    const past = (await time.latest()) - 1;
    await expect(
      priori.seal(commitHash(HYPOTHESIS, salt), past, "btc 20d"),
    ).to.be.revertedWithCustomError(priori, "EvaluationMustBeFuture");
  });

  it("seals a prediction without exposing the hypothesis", async function () {
    const evaluateAfter = (await time.latest()) + 3600;
    await expect(priori.seal(commitHash(HYPOTHESIS, salt), evaluateAfter, "btc 20d")).to.emit(
      priori,
      "Sealed",
    );

    expect(await priori.count(author.address)).to.equal(1n);
    const p = await priori.get(author.address, 0);
    expect(p.plaintext).to.equal(""); // hidden until the window closes
    expect(p.revealedAt).to.equal(0n);
    expect(p.label).to.equal("btc 20d");
  });

  it("blocks a reveal before the window closes", async function () {
    const evaluateAfter = (await time.latest()) + 3600;
    await priori.seal(commitHash(HYPOTHESIS, salt), evaluateAfter, "btc 20d");

    await expect(priori.reveal(0, HYPOTHESIS, salt, true, 500)).to.be.revertedWithCustomError(
      priori,
      "TooEarlyToReveal",
    );
  });

  it("rejects a hypothesis retrofitted after the fact", async function () {
    const evaluateAfter = (await time.latest()) + 3600;
    await priori.seal(commitHash(HYPOTHESIS, salt), evaluateAfter, "btc 20d");
    await time.increaseTo(evaluateAfter + 1);

    const retrofitted = JSON.stringify({
      strategy: "btc-momentum",
      symbol: "BTC-USD",
      lookbackDays: 50, // changed after seeing the outcome
      thresholdBps: 0,
    });

    await expect(priori.reveal(0, retrofitted, salt, true, 500)).to.be.revertedWithCustomError(
      priori,
      "HashMismatch",
    );
  });

  it("reveals and records the realized outcome", async function () {
    const evaluateAfter = (await time.latest()) + 3600;
    await priori.seal(commitHash(HYPOTHESIS, salt), evaluateAfter, "btc 20d");
    await time.increaseTo(evaluateAfter + 1);

    await expect(priori.reveal(0, HYPOTHESIS, salt, true, -250)).to.emit(priori, "Revealed");

    const p = await priori.get(author.address, 0);
    expect(p.plaintext).to.equal(HYPOTHESIS);
    expect(p.hit).to.equal(true);
    expect(p.metricBps).to.equal(-250);
    expect(p.revealedAt).to.not.equal(0n);
  });

  it("refuses a second reveal", async function () {
    const evaluateAfter = (await time.latest()) + 3600;
    await priori.seal(commitHash(HYPOTHESIS, salt), evaluateAfter, "btc 20d");
    await time.increaseTo(evaluateAfter + 1);
    await priori.reveal(0, HYPOTHESIS, salt, true, 100);

    await expect(priori.reveal(0, HYPOTHESIS, salt, false, 0)).to.be.revertedWithCustomError(
      priori,
      "AlreadyRevealed",
    );
  });

  it("tracks pending, revealed and abandoned (file-drawer) counts", async function () {
    const now = await time.latest();

    // #0 will be revealed, #1 will be abandoned, #2 stays pending
    await priori.seal(commitHash(HYPOTHESIS, salt), now + 1000, "revealed one");
    await priori.seal(commitHash(HYPOTHESIS, salt), now + 2000, "abandoned one");
    await priori.seal(commitHash(HYPOTHESIS, salt), now + 100000, "pending one");

    await time.increaseTo(now + 2500);
    await priori.reveal(0, HYPOTHESIS, salt, true, 420);

    const [total, revealed, hits, abandoned, pending] = await priori.stats(author.address);
    expect(total).to.equal(3n);
    expect(revealed).to.equal(1n);
    expect(hits).to.equal(1n);
    expect(abandoned).to.equal(1n); // window closed, never revealed
    expect(pending).to.equal(1n);
  });

  it("registers authors for the explore feed", async function () {
    const evaluateAfter = (await time.latest()) + 3600;
    await priori.seal(commitHash(HYPOTHESIS, salt), evaluateAfter, "btc 20d");
    expect(await priori.authors()).to.deep.equal([author.address]);
  });
});
