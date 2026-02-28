import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { CapstoneProject } from "../target/types/capstone_project";
import {ConfirmOptions, Keypair, LAMPORTS_PER_SOL, PublicKey} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccount, createMint, getAccount, getAssociatedTokenAddressSync, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";


const confirmOpts: ConfirmOptions = {commitment: "confirmed"};

describe("capstone-project", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.capstoneProject as Program<CapstoneProject>;
  const connection = provider.connection;

  const maker = Keypair.generate();
  const taker = Keypair.generate();
  let mintA: PublicKey;
  let mintB: PublicKey;
  let makerAtaA: PublicKey;
  let takerAtaB: PublicKey;

  const seed = new BN(1234);
  const depositAmount = new BN(10_000_000);
  const receiveAmount = new BN(5_000_000);
  const decimals = 6;

  async function airdrop(to:PublicKey, amount: number) {
    const latestBlockhash = await connection.getLatestBlockhash();
    const sig = await connection.requestAirdrop(to, amount);
    await connection.confirmTransaction(
      {signature:sig, ...latestBlockhash}, "confirmed"
    );
  }

  function getEscrowPda(makerKey: PublicKey, escrowSeed:BN): PublicKey{
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        makerKey.toBuffer(),
        escrowSeed.toArrayLike(Buffer,"le", 8),
      ],
      program.programId
    )[0];
  }

  function getVaultAta(escrow:PublicKey, mint: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(mint, escrow, true, TOKEN_PROGRAM_ID);
  }

  before(async () => {
    await airdrop(maker.publicKey, 10 * LAMPORTS_PER_SOL);
    await airdrop(taker.publicKey, 10 * LAMPORTS_PER_SOL);

    mintA = await createMint(connection, maker, maker.publicKey, null, decimals, undefined, confirmOpts);
    mintB = await createMint(connection, taker, taker.publicKey, null, decimals, undefined, confirmOpts);

    makerAtaA = await createAssociatedTokenAccount(connection, maker, mintA,maker.publicKey, confirmOpts);
    takerAtaB = await createAssociatedTokenAccount(connection, taker, mintB,taker.publicKey, confirmOpts);

    await mintTo(connection, maker, mintA, makerAtaA, maker, 100_000_000, undefined, confirmOpts);
    await mintTo(connection, taker, mintB, takerAtaB, taker, 100_000_000, undefined, confirmOpts);
  });

  it("make", async () => {
    const escrow = getEscrowPda(maker.publicKey, seed);
    const vault = getVaultAta(escrow, mintA);

    const currentTime = Math.floor(Date.now()/1000);
    const deadline = new BN(currentTime + (1 * 60)) //1min from deposit time (7 * 24 * 60 * 60) for 7days

    await program.methods
      .make(seed, depositAmount, receiveAmount, deadline)
      .accountsPartial({
        maker: maker.publicKey,
        mintA, mintB, makerAtaA, escrow, vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([maker])
      .rpc(confirmOpts);
    
    const escrowAccount = await program.account.escrow.fetch(escrow);
    expect(escrowAccount.seed.toNumber()).to.equal(seed.toNumber());
    expect(escrowAccount.maker.toBase58()).to.equal(maker.publicKey.toBase58());
    expect(escrowAccount.mintA.toBase58()).to.equal(mintA.toBase58());
    expect(escrowAccount.mintB.toBase58()).to.equal(mintB.toBase58());
    expect(escrowAccount.recieve.toNumber()).to.equal(receiveAmount.toNumber());
    expect(escrowAccount.deadline.toNumber()).to.equal(deadline.toNumber());

    const vaultAccount = await getAccount(connection, vault);
    expect(Number(vaultAccount.amount)).to.equal(depositAmount.toNumber());
  });

  it("take", async () => {
    const escrow = getEscrowPda(maker.publicKey, seed);
    const vault = getVaultAta(escrow, mintA);

    const takerAtaA = getAssociatedTokenAddressSync(mintA, taker.publicKey);
    const makerAtaB = getAssociatedTokenAddressSync(mintB, maker.publicKey);

    const takerAtaBBefore = await getAccount(connection, takerAtaB);
    const makerBalanceBefore = await connection.getBalance(maker.publicKey);

    await program.methods
      .take()
      .accountsPartial({
        taker: taker.publicKey,
        maker: maker.publicKey,
        mintA,
        mintB,
        takerAtaA,
        takerAtaB,
        makerAtaB,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([taker])
      .rpc(confirmOpts);

    const takerAtaAAccount = await getAccount(connection, takerAtaA);
    expect(Number(takerAtaAAccount.amount)).to.equal(depositAmount.toNumber());

    const makerAtaBAccount = await getAccount(connection, makerAtaB);
    expect(Number(makerAtaBAccount.amount)).to.equal(receiveAmount.toNumber());

    const takerAtaBAfter = await getAccount(connection, takerAtaB);
    expect(Number(takerAtaBBefore.amount) - Number(takerAtaBAfter.amount)).to.equal(receiveAmount.toNumber());

    const escrowAccount = await connection.getAccountInfo(escrow);
    expect(escrowAccount).to.be.null;

    const vaultAccount = await connection.getAccountInfo(vault);
    expect(vaultAccount).to.be.null;

    const makerBalanceAfter = await connection.getBalance(maker.publicKey);
    expect(makerBalanceAfter).to.be.greaterThan(makerBalanceBefore);
  });

  describe("refund", () => {
    const refundSeed = new anchor.BN(2);

    before(async () => {
      const escrow = getEscrowPda(maker.publicKey, refundSeed);
      const vault = getVaultAta(escrow, mintA);

      const pastDeadline = new anchor.BN(Math.floor(Date.now() / 1000) - 1);

      await program.methods
       .make(refundSeed, depositAmount, receiveAmount, pastDeadline)
       .accountsPartial({
        maker: maker.publicKey, mintA, mintB, makerAtaA, escrow,vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
       })
       .signers([maker])
       .rpc(confirmOpts);
    });

    it("refund", async () => {
      const escrow = getEscrowPda(maker.publicKey, refundSeed);
      const vault = getVaultAta(escrow, mintA);

      const makerAtaABefore = await getAccount(connection, makerAtaA);
      const makerSolBalanceBefore = await connection.getBalance(maker.publicKey);

      await program.methods
        .refund()
        .accountsPartial({
          maker: maker.publicKey, mintA, makerAtaA, escrow, vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([maker])
        .rpc(confirmOpts);

      const makerAtaAAfter = await getAccount(connection, makerAtaA);
      expect(Number(makerAtaAAfter.amount) - Number(makerAtaABefore.amount)).to.equal(depositAmount.toNumber());

      const escrowAccount = await connection.getAccountInfo(escrow);
      expect(escrowAccount).to.be.null;

      const vaultAccount = await connection.getAccountInfo(vault);
      expect(vaultAccount).to.be.null;

      const makerSolBalanceAfter = await connection.getBalance(maker.publicKey);
      expect(makerSolBalanceAfter).to.be.greaterThan(makerSolBalanceBefore);

    })
  })
});