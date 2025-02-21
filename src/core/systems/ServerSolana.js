import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createTransferInstruction,
} from '@solana/spl-token'

import { System } from './System'

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplTokenMetadata, fetchDigitalAsset } from '@metaplex-foundation/mpl-token-metadata'

export class Solana extends System {
  constructor(world) {
    super(world)

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
      console.log('=== Starting token transfer ===')
      console.log('Input parameters:', {
        tokenMint,
        recipientAddress,
        amount,
        decimals,
      })

      try {
        console.log('Creating PublicKey instances...')
        const mintPubkey = new PublicKey(tokenMint)
        const recipientPubkey = new PublicKey(recipientAddress)
        const senderPubkey = this.wallet.publicKey
        console.log('PublicKeys created:', {
          mint: mintPubkey.toString(),
          recipient: recipientPubkey.toString(),
          sender: senderPubkey.toString(),
        })

        // Get associated token accounts
        console.log('Fetching sender associated token account...')
        const senderAta = await getOrCreateAssociatedTokenAccount(
          this.connection,
          this.wallet,
          mintPubkey,
          senderPubkey
        )
        console.log('Sender ATA:', {
          address: senderAta.address.toString(),
          owner: senderAta.owner.toString(),
        })

        console.log('Fetching recipient associated token account...')
        const recipientAta = await getOrCreateAssociatedTokenAccount(
          this.connection,
          this.wallet,
          mintPubkey,
          recipientPubkey
        )
        console.log('Recipient ATA:', {
          address: recipientAta.address.toString(),
          owner: recipientAta.owner.toString(),
        })

        // Check sender's balance
        console.log('Fetching sender account details...')
        const senderAccount = await getAccount(this.connection, senderAta.address, 'confirmed', TOKEN_PROGRAM_ID)
        console.log('Sender account state:', {
          balance: senderAccount.amount.toString(),
          delegate: senderAccount.delegate?.toString() || 'none',
          isFrozen: senderAccount.isFrozen,
        })

        const rawAmount = amount * 10 ** decimals
        console.log('Transfer amount:', {
          displayAmount: amount,
          rawAmount: rawAmount.toString(),
          decimals,
        })

        if (Number(senderAccount.amount) < rawAmount) {
          console.error('Insufficient balance:', {
            required: rawAmount.toString(),
            available: senderAccount.amount.toString(),
          })
          throw new Error('Insufficient token balance')
        }

        // Create transfer instruction
        console.log('Creating transfer instruction...')
        const transferInstruction = createTransferInstruction(
          senderAta.address,
          recipientAta.address,
          senderPubkey,
          rawAmount,
          [],
          TOKEN_PROGRAM_ID
        )
        console.log('Transfer instruction created')

        // Create and sign transaction
        console.log('Building transaction...')
        const transaction = new Transaction().add(transferInstruction)
        transaction.feePayer = senderPubkey
        const { blockhash } = await this.connection.getLatestBlockhash()
        transaction.recentBlockhash = blockhash
        console.log('Transaction built:', {
          feePayer: transaction.feePayer.toString(),
          recentBlockhash: blockhash,
        })

        // Sign and send transaction
        console.log('Sending transaction...')
        const signature = await this.connection.sendTransaction(transaction, [this.wallet])
        console.log('Transaction sent:', {
          signature,
          status: 'awaiting confirmation',
        })

        console.log('Awaiting transaction confirmation...')
        const confirmation = await this.connection.confirmTransaction(signature)
        console.log('Transaction confirmation received:', {
          err: confirmation.value.err,
          slot: confirmation.context.slot,
        })

        if (confirmation.value.err) {
          console.error('Transaction failed:', confirmation.value.err)
          throw new Error('Transaction failed')
        }

        console.log('=== Transfer completed successfully ===')
        return {
          success: true,
          signature,
          message: `Successfully sent ${amount} tokens`,
        }
      } catch (err) {
        console.error('=== Transfer failed ===')
        console.error('Error details:', {
          message: err.message,
          stack: err.stack,
          name: err.name,
        })
        return {
          success: false,
          error: err.message || 'Failed to send tokens',
        }
      }
    }

    const umi = createUmi(process.env.PUBLIC_RPC_URL).use(mplTokenMetadata())

    const tokens = new Map()
    this.programs = {
      token: async tokenMint => {
        try {
          let token = tokens.get(tokenMint)
          if (token) return token

          const metadata = await fetchDigitalAsset(umi, tokenMint)

          token = {
            decimals: metadata?.mint?.decimals,
            supply: metadata?.mint?.supply,
            name: metadata?.metadata?.name,
            symbol: metadata?.metadata?.symbol,
            uri: metadata?.metadata?.uri,
            balance: walletAddress => balance({ tokenMint, walletAddress, decimals: tokenData.decimals }),
            transfer: (recipientAddress, amount) =>
              transfer({ tokenMint, recipientAddress, amount, decimals: tokenData.decimals }),
          }

          tokens.set(tokenMint, token)

          return token
        } catch (error) {
          console.error(error)
        }
      },
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
