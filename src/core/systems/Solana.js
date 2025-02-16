import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createTransferInstruction,
} from '@solana/spl-token'

import { System } from './System'

export class Solana extends System {
  constructor(world) {
    super(world)
    if (world.network.isClient) {
      this.wallet = null
      this.connection = null
      this.serverAddress = process.env.SOLANA_SERVER_ADDRESS
    }

    if (world.network.isServer) {
      this.connection = new Connection(process.env.PUBLIC_RPC_URL, 'confirmed')
      this.wallet = Keypair.fromSecretKey(Buffer.from(JSON.parse(process.env.SOLANA_PKEY_ARRAY)))

      const balance = async ({ tokenMint, walletAddress, decimals = 9 }) => {
        try {
          const mintPubkey = new PublicKey(tokenMint)
          const walletPubkey = new PublicKey(walletAddress || this.wallet.publicKey)

          const tokenAccount = await this.connection.getTokenAccountsByOwner(walletPubkey, {
            mint: mintPubkey,
          })

          if (tokenAccount.value.length === 0) {
            return {
              success: true,
              balance: 0,
              tokenAccount: null,
            }
          }

          const accountInfo = await getAccount(
            this.connection,
            tokenAccount.value[0].pubkey,
            'confirmed',
            TOKEN_PROGRAM_ID
          )

          return {
            success: true,
            balance: Number(accountInfo.amount) / 10 ** decimals,
            tokenAccount: tokenAccount.value[0].pubkey.toString(),
          }
        } catch (err) {
          return {
            success: false,
            error: err.message || 'Failed to fetch balance',
          }
        }
      }

      const transfer = async ({ tokenMint, recipientAddress, amount, decimals = 9 }) => {
        try {
          const mintPubkey = new PublicKey(tokenMint)
          const recipientPubkey = new PublicKey(recipientAddress)
          const senderPubkey = this.wallet.publicKey

          // Get associated token accounts
          const senderAta = await getOrCreateAssociatedTokenAccount(
            this.connection,
            this.wallet,
            mintPubkey,
            senderPubkey
          )

          const recipientAta = await getOrCreateAssociatedTokenAccount(
            this.connection,
            this.wallet,
            mintPubkey,
            recipientPubkey
          )

          // Check sender's balance
          const senderAccount = await getAccount(this.connection, senderAta.address, 'confirmed', TOKEN_PROGRAM_ID)

          const rawAmount = amount * 10 ** decimals
          if (Number(senderAccount.amount) < rawAmount) {
            throw new Error('Insufficient token balance')
          }

          // Create transfer instruction
          const transferInstruction = createTransferInstruction(
            senderAta.address,
            recipientAta.address,
            senderPubkey,
            rawAmount,
            [],
            TOKEN_PROGRAM_ID
          )

          // Create and sign transaction
          const transaction = new Transaction().add(transferInstruction)
          transaction.feePayer = senderPubkey
          const { blockhash } = await this.connection.getLatestBlockhash()
          transaction.recentBlockhash = blockhash

          // Sign and send transaction
          const signature = await this.connection.sendTransaction(transaction, [this.wallet])
          const confirmation = await this.connection.confirmTransaction(signature)

          if (confirmation.value.err) {
            throw new Error('Transaction failed')
          }

          return {
            success: true,
            signature,
            message: `Successfully sent ${amount} tokens`,
          }
        } catch (err) {
          return {
            success: false,
            error: err.message || 'Failed to send tokens',
          }
        }
      }

      this.programs = {
        token: {
          balance,
          transfer,
        },
      }
    }
  }

  async getBalance() {
    if (!this.wallet || !this.connection) return 0
    const balance = await this.connection.getBalance(this.wallet.publicKey)
    return (balance / 1e9).toFixed(4)
  }

  debug() {
    console.log('wallet', this.wallet)
    console.log('connection', this.connection)
  }
}
