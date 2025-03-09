import { useState, useEffect } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { getAssociatedTokenAddress, createTransferInstruction, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'

export const useSolanaSystem = world => {
  const { connection } = useConnection()
  const wallet = useWallet()

  // Initialize the Solana system
  useEffect(() => {
    if (!wallet || !connection) return

    console.log('Initializing Solana system (client)')

    // Create a tokens cache with metadata
    const tokens = new Map()
    const metadataRequests = new Map()

    function debug() {
      console.log('mode', 'client')
      console.log('publicKey', wallet.publicKey?.toString() || 'not connected')
      console.log('has wallet', !!wallet)
      console.log('connection', connection)
    }

    // Initialize the Solana system on the world object
    debug()
    world.solana = {
      wallet,
      connection,
      publicKey: wallet.publicKey,
      mode: 'client', // Client mode

      // Match the server-side API
      getBalance: async () => {
        if (!connection || !wallet.publicKey) return 0
        const balance = await connection.getBalance(wallet.publicKey)
        return (balance / 1e9).toFixed(4)
      },

      isWatchMode: () => false,
      isActiveMode: () => true,
      getMode: () => 'client',

      // Programs object with token function that mirrors server implementation
      programs: {
        token: async tokenMint => {
          try {
            let token = tokens.get(tokenMint)
            if (token) return token

            token = {
              decimals: 9, // Default to 9 decimals (SOL standard)
              supply: null,
              name: null,
              symbol: null,
              uri: null,

              // Balance method with same API as server
              balance: async walletAddress => {
                try {
                  const mintPubkey = new PublicKey(tokenMint)
                  const walletPubkey = walletAddress ? new PublicKey(walletAddress) : wallet.publicKey

                  if (!walletPubkey) {
                    throw new Error('No wallet address provided or wallet not connected')
                  }

                  const tokenAccount = await getAssociatedTokenAddress(
                    mintPubkey,
                    walletPubkey,
                    false,
                    TOKEN_PROGRAM_ID
                  )

                  try {
                    const account = await getAccount(connection, tokenAccount, 'confirmed', TOKEN_PROGRAM_ID)
                    return {
                      success: true,
                      balance: Number(account.amount) / 10 ** token.decimals,
                      tokenAccount: tokenAccount.toString(),
                    }
                  } catch (e) {
                    // If account doesn't exist, return 0 balance
                    if (e.message?.includes('could not find account')) {
                      return {
                        success: true,
                        balance: 0,
                        tokenAccount: tokenAccount.toString(),
                      }
                    }
                    throw e
                  }
                } catch (err) {
                  return {
                    success: false,
                    error: err.message || 'Failed to fetch balance',
                  }
                }
              },

              // Transfer method with same API as server
              transfer: async (recipientAddress, amount) => {
                try {
                  // Validate wallet connection
                  if (!wallet.publicKey) {
                    throw new Error('Wallet not connected')
                  }

                  // Convert addresses to PublicKey objects
                  const mintPubkey = new PublicKey(tokenMint)
                  const recipientPubkey = new PublicKey(recipientAddress)
                  const senderPubkey = wallet.publicKey

                  // Get associated token accounts
                  const senderAta = await getAssociatedTokenAddress(mintPubkey, senderPubkey, false, TOKEN_PROGRAM_ID)
                  const recipientAta = await getAssociatedTokenAddress(
                    mintPubkey,
                    recipientPubkey,
                    false,
                    TOKEN_PROGRAM_ID
                  )

                  // Check sender's balance
                  const senderAccount = await getAccount(connection, senderAta, 'confirmed', TOKEN_PROGRAM_ID)

                  const rawAmount = amount * 10 ** token.decimals

                  if (Number(senderAccount.amount) < rawAmount) {
                    throw new Error('Insufficient token balance')
                  }

                  // Create transfer instruction
                  const transferInstruction = createTransferInstruction(
                    senderAta,
                    recipientAta,
                    senderPubkey,
                    rawAmount,
                    [],
                    TOKEN_PROGRAM_ID
                  )

                  // Create and sign transaction
                  const transaction = new Transaction().add(transferInstruction)
                  transaction.feePayer = senderPubkey
                  const { blockhash } = await connection.getLatestBlockhash()
                  transaction.recentBlockhash = blockhash

                  const signed = await wallet.signTransaction(transaction)
                  const signature = await connection.sendRawTransaction(signed.serialize())

                  // Confirm transaction
                  const confirmation = await connection.confirmTransaction(signature)
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
              },
            }

            // Cache the token object (with placeholder metadata)
            tokens.set(tokenMint, token)

            // Request metadata from server if not already requested
            if (!metadataRequests.has(tokenMint)) {
              metadataRequests.set(tokenMint, true)
              requestTokenMetadata(tokenMint)
            }

            return token
          } catch (error) {
            console.error(error)
            return null
          }
        },
      },

      debug,

      tokens: {
        get: tokenMint => tokens.get(tokenMint),
        set: (tokenMint, tokenData) => {
          const token = tokens.get(tokenMint) ?? {}

          //   Object.assign(token, {
          //     decimals: metadata.decimals || token.decimals,
          //     supply: metadata.supply,
          //     name: metadata.name,
          //     symbol: metadata.symbol,
          //     uri: metadata.uri,
          //   })
          Object.assign(token, tokenData)
        },
      },
    }

    // Function to request token metadata from server
    function requestTokenMetadata(tokenMint) {
      console.log(`Requesting metadata for token: ${tokenMint}`)
      world.network.send('requestTokenMetadata', tokenMint)
    }

    // Add handler for server responses with token metadata
    // world.network.on('tokenMetadata', data => {
    //   const { tokenMint, metadata } = data
    //   console.log(`Received metadata for token: ${tokenMint}`, metadata)

    //   // Get the cached token object
    //   const token = tokens.get(tokenMint)
    //   if (!token) return

    //   // Update the token object with the received metadata
    //   Object.assign(token, {
    //     decimals: metadata.decimals || token.decimals,
    //     supply: metadata.supply,
    //     name: metadata.name,
    //     symbol: metadata.symbol,
    //     uri: metadata.uri,
    //   })
    // })

    // setInitialized(true)
  }, [wallet, connection, world])

  // Update player entity when wallet changes
  useEffect(() => {
    if (!world.entities?.player || !wallet) return

    // This will be undefined when disconnected or the key string when connected
    const walletAddress = wallet.publicKey?.toString()

    world.entities.player.modify({ solana: walletAddress })
  }, [wallet.publicKey, world.entities?.player])

  return {
    wallet,
    connection,
  }
}
