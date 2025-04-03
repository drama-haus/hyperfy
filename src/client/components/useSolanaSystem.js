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
    const accountListeners = new Map()
    const balanceCache = new Map() // Cache for token balances

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

      // Sign message function
      sign: async (message) => {
        try {
          if (!wallet.publicKey) {
            throw new Error('Wallet not connected')
          }
          
          // Convert message to Uint8Array if it's a string
          const messageBytes = typeof message === 'string' 
            ? new TextEncoder().encode(message) 
            : message

          // Request signature from user's wallet
          const signature = await wallet.signMessage(messageBytes)
          
          return {
            success: true,
            signature: Buffer.from(signature).toString('base64'),
            message: 'Message signed successfully'
          }
        } catch (err) {
          return {
            success: false,
            error: err.message || 'Failed to sign message'
          }
        }
      },

      // Programs object with token function that mirrors server implementation
      programs: {
        token: async tokenMint => {
          try {
            let token = tokens.get(tokenMint)
            if (token) return token

            // Helper function to extract token balance
            const extractTokenBalance = data => {
              // Token balance is at offset 64, 8 bytes as a little-endian 64-bit number
              return Number(data.readBigUInt64LE(64))
            }

            // Set up token account watching for the wallet
            console.log(`Setting up watcher for token: ${tokenMint} and client wallet`)
            const subscribers = new Set()

            // Function to update balance cache and notify subscribers
            const updateBalanceCache = (walletAddress, rawBalance, decimals) => {
              const tokenAmount = rawBalance / (10 ** (decimals || 9))
              const cacheKey = `${walletAddress}:${tokenMint}`
              
              // Update cache
              balanceCache.set(cacheKey, {
                balance: tokenAmount,
                rawBalance,
                lastUpdated: Date.now(),
                tokenAccount: null // Will be set when needed
              })
              
              return tokenAmount
            }

            // Function to notify subscribers about balance changes
            const notifySubscribers = info => {
              subscribers.forEach(callback => {
                try {
                  callback(info)
                } catch (err) {
                  console.error('Error in balance change callback:', err)
                }
              })
            }

            // Watch the user's token account
            const setupTokenAccountWatcher = async () => {
              if (!wallet.publicKey) return

              try {
                const mintPubkey = new PublicKey(tokenMint)
                const walletPubkey = wallet.publicKey
                const walletAddress = walletPubkey.toString()
                
                // Get the associated token address
                const tokenAta = await getAssociatedTokenAddress(
                  mintPubkey,
                  walletPubkey,
                  false,
                  TOKEN_PROGRAM_ID
                )
                
                const tokenAtaStr = tokenAta.toString()
                const cacheKey = `${walletAddress}:${tokenMint}`
                
                // Check if account exists before setting up listener
                let accountExists = false
                let initialBalance = 0
                
                try {
                  const accountInfo = await connection.getAccountInfo(tokenAta)
                  if (accountInfo) {
                    accountExists = true
                    initialBalance = extractTokenBalance(accountInfo.data)
                    
                    // Initialize cache with fetched balance
                    const tokenAmount = updateBalanceCache(walletAddress, initialBalance, token.decimals)
                    
                    // Also cache the token account
                    balanceCache.get(cacheKey).tokenAccount = tokenAtaStr
                    
                    console.log(`Initial token balance: ${tokenAmount}`)
                  }
                } catch (err) {
                  console.log(`Token account does not exist yet: ${tokenAtaStr}`)
                  
                  // Initialize with zero balance
                  updateBalanceCache(walletAddress, 0, token.decimals)
                }
                
                if (accountExists) {
                  // If we already have a listener for this account, remove it
                  if (accountListeners.has(tokenAtaStr)) {
                    await connection.removeAccountChangeListener(accountListeners.get(tokenAtaStr))
                  }
                  
                  // Set up listener for balance changes
                  const listenerId = connection.onAccountChange(
                    tokenAta,
                    (updatedAccountInfo, context) => {
                      const newBalance = extractTokenBalance(updatedAccountInfo.data)
                      const tokenAmount = updateBalanceCache(walletAddress, newBalance, token.decimals)
                      
                      console.log(`Balance changed for token ${tokenMint}: ${tokenAmount}`)
                      
                      notifySubscribers({
                        token: tokenMint,
                        tokenAccount: tokenAtaStr,
                        rawBalance: newBalance,
                        balance: tokenAmount,
                        decimals: token.decimals || 9
                      })
                    },
                    'confirmed'
                  )
                  
                  accountListeners.set(tokenAtaStr, listenerId)
                  console.log(`Watching token account: ${tokenAtaStr}`)
                } else {
                  // Set up a program listener to detect when this account is created
                  const programListenerId = connection.onProgramAccountChange(
                    TOKEN_PROGRAM_ID,
                    async (accountInfo, context) => {
                      try {
                        // Check if this is our token account
                        if (accountInfo.accountId.equals(tokenAta)) {
                          console.log(`Token account created: ${tokenAtaStr}`)
                          await setupTokenAccountWatcher()
                        }
                      } catch (err) {
                        console.error('Error in program account listener:', err)
                      }
                    },
                    'confirmed'
                  )
                  
                  // Store this listener too
                  accountListeners.set('program-' + tokenMint, programListenerId)
                }
              } catch (err) {
                console.error('Error setting up token account watcher:', err)
              }
            }
            
            token = {
              decimals: 9, // Default to 9 decimals (SOL standard)
              supply: null,
              name: null,
              symbol: null,
              uri: null,

              // Synchronous balance getter that returns cached value
              get balance() {
                if (!wallet.publicKey) return 0
                
                const walletAddress = wallet.publicKey.toString()
                const cacheKey = `${walletAddress}:${tokenMint}`
                
                // Return cached balance if available
                if (balanceCache.has(cacheKey)) {
                  return balanceCache.get(cacheKey).balance
                }
                
                // Return 0 if no cached value available
                return 0
              },

              // Async balance method with same API as server (renamed to fetchBalance)
              fetchBalance: async walletAddress => {
                try {
                  const mintPubkey = new PublicKey(tokenMint)
                  const walletPubkey = walletAddress ? new PublicKey(walletAddress) : wallet.publicKey

                  if (!walletPubkey) {
                    throw new Error('No wallet address provided or wallet not connected')
                  }
                  
                  const walletStr = walletPubkey.toString()
                  const cacheKey = `${walletStr}:${tokenMint}`

                  const tokenAccount = await getAssociatedTokenAddress(
                    mintPubkey,
                    walletPubkey,
                    false,
                    TOKEN_PROGRAM_ID
                  )

                  try {
                    const account = await getAccount(connection, tokenAccount, 'confirmed', TOKEN_PROGRAM_ID)
                    const tokenAmount = Number(account.amount) / 10 ** token.decimals
                    
                    // Update cache
                    balanceCache.set(cacheKey, {
                      balance: tokenAmount,
                      rawBalance: Number(account.amount),
                      lastUpdated: Date.now(),
                      tokenAccount: tokenAccount.toString()
                    })
                    
                    return {
                      success: true,
                      balance: tokenAmount,
                      tokenAccount: tokenAccount.toString(),
                    }
                  } catch (e) {
                    // If account doesn't exist, return 0 balance
                    if (e.message?.includes('could not find account')) {
                      // Update cache with zero balance
                      balanceCache.set(cacheKey, {
                        balance: 0,
                        rawBalance: 0,
                        lastUpdated: Date.now(),
                        tokenAccount: tokenAccount.toString()
                      })
                      
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

              // For backwards compatibility, provide the old balance method as well
              // balance: async walletAddress => {
              //   return await token.fetchBalance(walletAddress)
              // },

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
              
              // Add onBalance change method similar to server's onTransaction
              onBalanceChange: callback => {
                subscribers.add(callback)
                return {
                  unsubscribe: () => {
                    subscribers.delete(callback)
                    console.log(`Removed balance change callback for token: ${tokenMint}`)
                    
                    // If no subscribers left and no references to token, clean up
                    if (subscribers.size === 0 && !tokens.has(tokenMint)) {
                      // Remove all account listeners
                      for (const [accountStr, listenerID] of accountListeners.entries()) {
                        if (accountStr.startsWith(tokenMint) || accountStr === 'program-' + tokenMint) {
                          connection.removeAccountChangeListener(listenerID)
                          accountListeners.delete(accountStr)
                          console.log(`Stopped watching token account: ${accountStr}`)
                        }
                      }
                      
                      console.log(`Stopped watching token: ${tokenMint}`)
                    }
                  }
                }
              }
            }

            // Cache the token object (with placeholder metadata)
            tokens.set(tokenMint, token)

            // Request metadata from server if not already requested
            if (!metadataRequests.has(tokenMint)) {
              metadataRequests.set(tokenMint, true)
              requestTokenMetadata(tokenMint)
            }
            
            // Set up the token account watcher
            if (wallet.publicKey) {
              setupTokenAccountWatcher()
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

    // Clean up listeners when component unmounts
    return () => {
      // Remove all account listeners
      for (const [accountStr, listenerID] of accountListeners.entries()) {
        try {
          connection.removeAccountChangeListener(listenerID)
          console.log(`Removed listener for account: ${accountStr}`)
        } catch (err) {
          console.error(`Error removing listener for ${accountStr}:`, err)
        }
      }
    }
  }, [wallet.publicKey, connection, world])

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
