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
import { 
  updateTokenBalance, 
  getTokenBalancesForWallet, 
  setTokenBalance, 
  withdrawTokenBalance,
  forceWithdrawTokenBalance,
  getTokenSyncState,
  updateTokenSyncState,
  getActiveTokens,
  isTransactionProcessed,
  recordProcessedTransaction,
  getProcessedTransactions,
  recordTokenWithdrawal,
  getTokenBalanceAuditLogs,
  recordBalanceChange
} from '../../server/db'

export class Solana extends System {
  constructor(world) {
    super(world)

    this.connection = new Connection(process.env.PUBLIC_RPC_URL, 'confirmed')

    // Determine if we're in watch mode or active mode
    // this.mode = options.mode || 'active'
    this.mode = process.env.SOLANA_PKEY_ARRAY ? 'active' : 'watch'
    
    // Initialize withdrawal fee settings from environment variables
    this.withdrawalFeeBps = process.env.SOLANA_WITHDRAWAL_FEE_BPS 
      ? parseInt(process.env.SOLANA_WITHDRAWAL_FEE_BPS) 
      : 0
    
    this.feeWalletAddress = process.env.SOLANA_FEE_WALLET_ADDRESS || null

    console.log(`initializing solana system on mode ${this.mode}`)
    console.log(`withdrawal fee: ${this.withdrawalFeeBps} bps, fee wallet: ${this.feeWalletAddress || 'none'}`)

    if (this.mode === 'active') {
      // Active mode - server has a wallet with private key that can sign transactions
      this.wallet = Keypair.fromSecretKey(Buffer.from(JSON.parse(process.env.SOLANA_PKEY_ARRAY)))
      this.publicKey = this.wallet.publicKey
    } else if (this.mode === 'watch') {
      // Watch mode - server only has a public key to observe
      this.wallet = null
      this.publicKey = new PublicKey(process.env.SOLANA_WATCH_ADDRESS)
    } else {
      throw new Error('Invalid mode. Use "active" or "watch".')
    }

    const balance = async ({ tokenMint, walletAddress, decimals = 9 }) => {
      try {
        const mintPubkey = new PublicKey(tokenMint)
        const walletPubkey = new PublicKey(walletAddress || this.publicKey)

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
      // Prevent transfers in watch mode
      if (this.mode === 'watch') {
        console.error('Cannot perform transfers in watch mode')
        return {
          success: false,
          error: 'Cannot perform transfers in watch mode. Switch to active mode to transfer tokens.',
        }
      }

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
        const senderPubkey = this.publicKey
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
          
          // Set up token account watching for the server wallet
          console.log(`Setting up watcher for token: ${tokenMint} and wallet: ${this.publicKey.toString()}`)
          const mintPubkey = new PublicKey(tokenMint)
          
          // Find all token accounts owned by the server wallet for this token
          const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
            this.publicKey,
            { mint: mintPubkey }
          )
          
          console.log(`Found ${tokenAccounts.value.length} token accounts for server wallet`)
          
          // Track token accounts and their listeners
          const accountBalances = new Map()
          const accountListeners = new Map()
          const subscribers = new Set()
          
          // Helper function to extract token balance
          const extractTokenBalance = data => {
            // Token balance is at offset 64, 8 bytes as a little-endian 64-bit number
            return Number(data.readBigUInt64LE(64))
          }
          
          // Function to notify subscribers about transactions
          const notifySubscribers = txInfo => {
            subscribers.forEach(callback => {
              try {
                callback(txInfo)
              } catch (err) {
                console.error('Error in transaction callback:', err)
              }
            })
          }
          
          // Function to fetch and log transaction details
          const fetchTransaction = async (accountPubkey, oldBalance, newBalance) => {
            try {
              console.log(`Fetching recent transaction for account ${accountPubkey}...`)
              
              // Get recent signatures for this account
              const signatures = await this.connection.getSignaturesForAddress(
                new PublicKey(accountPubkey),
                { limit: 1 }
              )
              
              if (signatures.length > 0) {
                // Check if we've already processed this transaction
                const signature = signatures[0].signature
                const alreadyProcessed = await isTransactionProcessed(signature)
                
                if (alreadyProcessed) {
                  console.log(`Transaction ${signature} already processed, skipping...`)
                  return
                }
                
                // Get the most recent transaction details
                const recentTx = await this.connection.getParsedTransaction(
                  signature,
                  { maxSupportedTransactionVersion: 0 }
                )
                
                if (recentTx) {
                  const txInfo = {
                    signature: signature,
                    status: signatures[0].confirmationStatus,
                    token: tokenMint,
                    account: accountPubkey,
                    oldBalance,
                    newBalance,
                    change: newBalance - oldBalance
                  }
                  
                  // Add token balance changes if available
                  if (recentTx.meta && recentTx.meta.postTokenBalances && recentTx.meta.preTokenBalances) {
                    txInfo.balanceChanges = recentTx.meta.postTokenBalances.map(postBalance => {
                      const preBalance = recentTx.meta.preTokenBalances.find(
                        pre => pre.accountIndex === postBalance.accountIndex
                      )
                      
                      if (preBalance) {
                        return {
                          accountIndex: postBalance.accountIndex,
                          accountPubkey: recentTx.transaction.message.accountKeys[postBalance.accountIndex].pubkey.toString(),
                          mint: postBalance.mint,
                          owner: postBalance.owner,
                          preBalance: preBalance.uiTokenAmount.uiAmount,
                          postBalance: postBalance.uiTokenAmount.uiAmount,
                          change: postBalance.uiTokenAmount.uiAmount - preBalance.uiTokenAmount.uiAmount
                        }
                      }
                      return null
                    }).filter(Boolean)
                    
                    // Calculate transaction timestamp
                    const txTimestamp = recentTx.blockTime ? recentTx.blockTime * 1000 : Date.now()
                    
                    // Track incoming transactions to the server wallet
                    // We're looking for token transfers where:
                    // 1. Our account's balance increased (positive change)
                    // 2. The token mint matches the token we're monitoring
                    if (newBalance > oldBalance) {
                      // Calculate actual token amount using decimals
                      const tokenAmount = (newBalance - oldBalance) / (10 ** metadata?.mint?.decimals)
                      
                      // Try to find the sender by analyzing the transaction
                      let senderWallet = null
                      
                      if (recentTx.meta.preTokenBalances && recentTx.meta.postTokenBalances) {
                        // Look for an account whose balance decreased in this transaction
                        for (const preBalance of recentTx.meta.preTokenBalances) {
                          // Skip if not our token mint
                          if (preBalance.mint !== tokenMint) continue
                          
                          const postBalance = recentTx.meta.postTokenBalances.find(
                            post => post.accountIndex === preBalance.accountIndex
                          )
                          
                          if (postBalance && 
                              preBalance.uiTokenAmount.uiAmount > postBalance.uiTokenAmount.uiAmount && 
                              preBalance.owner !== this.publicKey.toString()) {
                            // This account's balance decreased and it's not our wallet - likely the sender
                            senderWallet = preBalance.owner
                            break
                          }
                        }
                      }
                      
                      if (senderWallet) {
                        console.log(`Detected incoming token transfer from ${senderWallet}`)
                        console.log(`Amount: ${tokenAmount} ${metadata?.metadata?.symbol || tokenMint}`)
                        
                        // Update the sender's balance in our database
                        await updateTokenBalance(
                          senderWallet,
                          tokenMint,
                          tokenAmount,
                          signature
                        )
                        
                        // Record the transaction in processedTransactions to prevent duplicate processing
                        await recordProcessedTransaction({
                          signature,
                          tokenMint,
                          type: 'deposit',
                          blockTime: txTimestamp,
                          amount: tokenAmount,
                          senderWallet,
                          success: true
                        })
                        
                        // Update tokenSyncState to track the last processed transaction
                        await updateTokenSyncState(tokenMint, signature, txTimestamp, 1)
                        
                        console.log(`Updated token balance for wallet ${senderWallet}`)
                        console.log(`Recorded transaction in processedTransactions table`)
                        console.log(`Updated tokenSyncState with latest transaction`)
                      } else {
                        console.log(`Detected incoming token transfer, but couldn't identify sender`)
                      }
                    } else if (newBalance < oldBalance) {
                      // This is a withdrawal - also record it to prevent double processing
                      
                      // Check if this is a fee transaction (requires looking for multiple transfers)
                      const serverChanges = txInfo.balanceChanges.filter(
                        change => change.owner === this.publicKey.toString()
                      )
                      
                      // If there are multiple server wallet changes, this might be a fee transaction
                      const isMultiTransfer = serverChanges.length > 1
                      
                      if (isMultiTransfer && this.feeWalletAddress) {
                        // Look for fee transfer
                        const recipientChanges = txInfo.balanceChanges.filter(
                          change => change.owner !== this.publicKey.toString() && change.change > 0
                        )
                        
                        let recipientWallet = null
                        let recipientAmount = 0
                        let feeWallet = null
                        let feeAmount = 0
                        let isFeeTransaction = false
                        
                        // Check for fee transfer pattern
                        for (const change of recipientChanges) {
                          if (change.owner === this.feeWalletAddress) {
                            feeWallet = change.owner
                            feeAmount = change.change
                            isFeeTransaction = true
                          } else {
                            recipientWallet = change.owner
                            recipientAmount = change.change
                          }
                        }
                        
                        if (isFeeTransaction && recipientWallet) {
                          // This is a fee transaction
                          const totalAmount = recipientAmount + feeAmount
                          
                          // Record the transaction
                          await recordProcessedTransaction({
                            signature,
                            tokenMint,
                            type: 'withdrawal_with_fee',
                            blockTime: txTimestamp,
                            amount: totalAmount,
                            feeAmount,
                            netAmount: recipientAmount,
                            recipientWallet,
                            feeWallet,
                            success: true
                          })
                          
                          // Update tokenSyncState to track the last processed transaction
                          await updateTokenSyncState(tokenMint, signature, txTimestamp, 1)
                          
                          console.log(`Recorded fee transaction in processedTransactions table: ${recipientAmount} to ${recipientWallet}, fee ${feeAmount} to ${feeWallet}`)
                          console.log(`Updated tokenSyncState with latest transaction`)
                          return
                        }
                      }
                      
                      // Standard withdrawal
                      const recipientChanges = txInfo.balanceChanges.filter(
                        change => change.owner !== this.publicKey.toString() && change.change > 0
                      )
                      
                      if (recipientChanges.length > 0) {
                        const recipientWallet = recipientChanges[0].owner
                        const amount = Math.abs(newBalance - oldBalance) / (10 ** metadata?.mint?.decimals)
                        
                        // Record the transaction
                        await recordProcessedTransaction({
                          signature,
                          tokenMint,
                          type: 'withdrawal',
                          blockTime: txTimestamp,
                          amount,
                          recipientWallet,
                          success: true
                        })
                        
                        // Update tokenSyncState to track the last processed transaction
                        await updateTokenSyncState(tokenMint, signature, txTimestamp, 1)
                        
                        console.log(`Recorded withdrawal transaction in processedTransactions table: ${amount} tokens to ${recipientWallet}`)
                        console.log(`Updated tokenSyncState with latest transaction`)
                      }
                    }
                  }
                  
                  console.log('Token transaction detected:', txInfo)
                  notifySubscribers(txInfo)
                }
              }
            } catch (err) {
              console.error('Error fetching transaction:', err)
            }
          }
          
          // Watch each token account
          for (const account of tokenAccounts.value) {
            const accountPubkey = account.pubkey
            const accountPubkeyStr = accountPubkey.toString()
            
            // Get initial balance
            const accountInfo = await this.connection.getAccountInfo(accountPubkey)
            const initialBalance = extractTokenBalance(accountInfo.data)
            
            // Store balance
            accountBalances.set(accountPubkeyStr, initialBalance)
            
            console.log(`Watching token account: ${accountPubkeyStr} (initial balance: ${initialBalance})`)
            
            // Set up listener
            const listener = this.connection.onAccountChange(
              accountPubkey,
              (updatedAccountInfo, context) => {
                const newBalance = extractTokenBalance(updatedAccountInfo.data)
                const oldBalance = accountBalances.get(accountPubkeyStr)
                
                // Update stored balance
                accountBalances.set(accountPubkeyStr, newBalance)
                
                // Log the change
                console.log(`Balance change for account: ${accountPubkeyStr}`)
                console.log(`Old: ${oldBalance}, New: ${newBalance}, Change: ${newBalance - oldBalance}`)
                
                // Get transaction details
                fetchTransaction(accountPubkeyStr, oldBalance, newBalance)
              },
              'confirmed'
            )
            
            // Store listener
            accountListeners.set(accountPubkeyStr, listener)
          }
          
          // Set up program listener to catch new token accounts
          const programListener = this.connection.onProgramAccountChange(
            TOKEN_PROGRAM_ID,
            async (accountInfo, context) => {
              try {
                // Check if this is for our target mint
                const accountData = accountInfo.accountInfo.data
                const accountMintKey = new PublicKey(accountData.slice(0, 32))
                
                if (accountMintKey.equals(mintPubkey)) {
                  const accountPubkey = accountInfo.accountId
                  const accountPubkeyStr = accountPubkey.toBase58()
                  
                  // If not already watching
                  if (!accountListeners.has(accountPubkeyStr)) {
                    // Check if owner is our server wallet
                    const ownerOffset = 32 // Owner is at offset 32 in token account data
                    const ownerPubkey = new PublicKey(accountData.slice(ownerOffset, ownerOffset + 32))
                    
                    if (ownerPubkey.equals(this.publicKey)) {
                      console.log(`New token account detected: ${accountPubkeyStr}`)
                      
                      // Get initial balance
                      const initialBalance = extractTokenBalance(accountData)
                      
                      // Store balance
                      accountBalances.set(accountPubkeyStr, initialBalance)
                      
                      console.log(`Watching new token account: ${accountPubkeyStr} (initial balance: ${initialBalance})`)
                      
                      // Set up listener
                      const listener = this.connection.onAccountChange(
                        accountPubkey,
                        (updatedAccountInfo, context) => {
                          const newBalance = extractTokenBalance(updatedAccountInfo.data)
                          const oldBalance = accountBalances.get(accountPubkeyStr)
                          
                          // Update stored balance
                          accountBalances.set(accountPubkeyStr, newBalance)
                          
                          // Log the change
                          console.log(`Balance change for account: ${accountPubkeyStr}`)
                          console.log(`Old: ${oldBalance}, New: ${newBalance}, Change: ${newBalance - oldBalance}`)
                          
                          // Get transaction details
                          fetchTransaction(accountPubkeyStr, oldBalance, newBalance)
                        },
                        'confirmed'
                      )
                      
                      // Store listener
                      accountListeners.set(accountPubkeyStr, listener)
                    }
                  }
                }
              } catch (err) {
                console.error('Error processing program account change:', err)
              }
            },
            'confirmed'
          )

          // Internal method for syncing transactions - not exposed publicly
          const _getTransactionsSince = async (timestamp) => {
            console.log(`Fetching token transactions since ${new Date(timestamp).toISOString()}`)
            
            // Collect all token accounts owned by the server wallet for this token
            const accounts = [...accountBalances.keys()].map(addr => new PublicKey(addr))
            
            // If we don't have any accounts in our cache yet, find them
            if (accounts.length === 0) {
              const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                this.publicKey,
                { mint: mintPubkey }
              )
              
              for (const account of tokenAccounts.value) {
                accounts.push(account.pubkey)
              }
            }
            
            if (accounts.length === 0) {
              console.log('No token accounts found for this wallet and token')
              return []
            }
            
            // Fetch signatures for each account
            const transactions = []
            for (const account of accounts) {
              console.log(`Fetching transactions for account: ${account.toString()}`)
              
              try {
                // Get all signatures without 'until' parameter
                // We'll filter by timestamp later
                const signatures = await this.connection.getSignaturesForAddress(account)
                
                if (signatures.length > 0) {
                  console.log(`Found ${signatures.length} signatures`)
                  
                  // Process each signature, but filter by timestamp
                  for (const signatureInfo of signatures) {
                    // Skip if transaction is older than our cutoff time
                    if (signatureInfo.blockTime && signatureInfo.blockTime * 1000 < timestamp) {
                      continue
                    }
                    
                    // Skip failed transactions
                    if (signatureInfo.err) continue
                    
                    // Check if we already processed this transaction
                    if (transactions.some(tx => tx.signature === signatureInfo.signature)) continue
                    
                    // Get full transaction details
                    const txData = await this.connection.getParsedTransaction(
                      signatureInfo.signature,
                      { maxSupportedTransactionVersion: 0 }
                    )
                    
                    if (txData && txData.meta) {
                      // Extract token balance changes
                      if (txData.meta.postTokenBalances && txData.meta.preTokenBalances) {
                        // Get token balance changes for our token mint
                        const relevantChanges = txData.meta.postTokenBalances
                          .filter(post => {
                            // Check if this is for our mint
                            return post.mint === tokenMint
                          })
                          .map(post => {
                            // Find corresponding pre-balance
                            const pre = txData.meta.preTokenBalances.find(
                              pre => pre.accountIndex === post.accountIndex
                            )
                            
                            if (pre) {
                              return {
                                accountIndex: post.accountIndex,
                                accountPubkey: txData.transaction.message.accountKeys[post.accountIndex].pubkey.toString(),
                                mint: post.mint,
                                owner: post.owner,
                                preBalance: pre.uiTokenAmount.uiAmount,
                                postBalance: post.uiTokenAmount.uiAmount,
                                change: post.uiTokenAmount.uiAmount - pre.uiTokenAmount.uiAmount
                              }
                            }
                            return null
                          })
                          .filter(Boolean)
                        
                        // Only include transactions with relevant changes
                        if (relevantChanges.length > 0) {
                          // Find our wallet's change
                          const ourChanges = relevantChanges.filter(
                            change => change.owner === this.publicKey.toString()
                          )
                          
                          const blockTime = txData.blockTime ? txData.blockTime * 1000 : null
                          
                          transactions.push({
                            signature: signatureInfo.signature,
                            blockTime,
                            timestamp: blockTime ? new Date(blockTime).toISOString() : 'unknown',
                            balanceChanges: relevantChanges,
                            ourChanges,
                            fee: txData.meta.fee
                          })
                        }
                      }
                    }
                  }
                } else {
                  console.log('No transactions found for this account')
                }
              } catch (err) {
                console.error(`Error fetching transactions for account ${account.toString()}:`, err)
              }
            }
            
            // Sort transactions by timestamp (oldest first for chronological processing)
            transactions.sort((a, b) => {
              if (!a.blockTime) return 1
              if (!b.blockTime) return -1
              return a.blockTime - b.blockTime // Changed to ascending order
            })
            
            console.log(`Found ${transactions.length} total token transactions since ${new Date(timestamp).toISOString()}`)
            return transactions
          }

          // Internal method for syncing token balances - not exposed publicly
          const _syncTokenBalances = async (timestamp = null) => {
            console.log(`Syncing token balances for ${tokenMint}...`)
            
            // Default to 30 days if no timestamp provided
            if (!timestamp) {
              timestamp = Date.now() - (30 * 24 * 60 * 60 * 1000) // 30 days ago
            }
            
            try {
              // Get historical transactions
              const transactions = await _getTransactionsSince(timestamp)
              console.log(`Found ${transactions.length} transactions to process`)
              
              // If no transactions found, just update the sync timestamp
              if (transactions.length === 0) {
                await updateTokenSyncState(tokenMint, null, Date.now(), 0)
                return { 
                  processed: 0, 
                  updated: 0,
                  lastSignature: null,
                  lastTimestamp: Date.now()
                }
              }
              
              // Transactions are already sorted oldest-first in getTransactionsSince
              console.log(`Processing transactions in chronological order (oldest first)`)
              
              let processedCount = 0
              let updatedWallets = 0
              let lastSignature = null
              let lastTimestamp = timestamp
              let deposits = 0
              let withdrawals = 0
              
              // Process each transaction
              for (const tx of transactions) {
                // Skip if we've already processed this transaction
                if (await isTransactionProcessed(tx.signature)) {
                  console.log(`Skipping already processed transaction: ${tx.signature}`)
                  lastSignature = tx.signature
                  continue
                }
                
                // Track the last transaction regardless of processing outcome
                if (tx.blockTime) {
                  if (!lastSignature || tx.blockTime > lastTimestamp) {
                    lastSignature = tx.signature
                    lastTimestamp = tx.blockTime
                  }
                }
                
                // Only process transactions with balance changes
                if (!tx.balanceChanges || tx.balanceChanges.length === 0) {
                  continue
                }
                
                console.log(tx.balanceChanges)
                
                processedCount++
                
                // Check for server wallet changes
                const serverWalletChanges = tx.balanceChanges.filter(
                  change => change.owner === this.publicKey.toString()
                )
                
                if (serverWalletChanges.length === 0) {
                  continue
                }
                
                // Process deposits (positive changes to server wallet)
                const depositChanges = serverWalletChanges.filter(change => change.change > 0)
                for (const deposit of depositChanges) {
                  // Find the sender (account with negative change)
                  const senderChange = tx.balanceChanges.find(
                    change => change.owner !== this.publicKey.toString() && change.change < 0
                  )
                  
                  if (senderChange) {
                    const senderWallet = senderChange.owner
                    const amount = deposit.change
                    
                    // Update the sender's token balance
                    await updateTokenBalance(
                      senderWallet,
                      tokenMint,
                      amount,
                      tx.signature
                    )
                    
                    // Record the processed transaction
                    await recordProcessedTransaction({
                      signature: tx.signature,
                      tokenMint,
                      type: 'deposit',
                      blockTime: tx.blockTime,
                      amount,
                      senderWallet,
                      success: true
                    })
                    
                    console.log(`Recorded deposit of ${amount} tokens from ${senderWallet} (tx: ${tx.signature.substring(0, 10)}...)`)
                    updatedWallets++
                    deposits++
                  }
                }
                
                // Process withdrawals (negative changes to server wallet)
                const withdrawalChanges = serverWalletChanges.filter(change => change.change < 0)
                if (withdrawalChanges.length > 0) {
                  // Check if this is a regular withdrawal or a withdrawal with fee
                  // For fee transactions, there will be two negative changes to server wallet:
                  // 1. Main amount to recipient
                  // 2. Fee amount to fee wallet
                  
                  let isFeeTransaction = false
                  let recipientWallet = null
                  let recipientAmount = 0
                  let feeWallet = null
                  let feeAmount = 0
                  
                  // If there are multiple outgoing transfers from server wallet in one tx
                  if (withdrawalChanges.length > 1) {
                    // This might be a withdrawal with fee
                    // Check the fee wallet address
                    const feeWalletPubkey = this.feeWalletAddress ? new PublicKey(this.feeWalletAddress) : null
                    
                    if (feeWalletPubkey) {
                      // Look for transfers to fee wallet
                      for (const withdrawalChange of withdrawalChanges) {
                        // Find recipient for this specific withdrawal
                        const positiveChanges = tx.balanceChanges.filter(
                          change => change.owner !== this.publicKey.toString() && change.change > 0
                        )
                        
                        for (const positiveChange of positiveChanges) {
                          if (positiveChange.owner === this.feeWalletAddress) {
                            // This is the fee transfer
                            isFeeTransaction = true
                            feeWallet = positiveChange.owner
                            feeAmount = Math.abs(withdrawalChange.change)
                          } else {
                            // This is the main recipient transfer
                            recipientWallet = positiveChange.owner
                            recipientAmount = Math.abs(withdrawalChange.change)
                          }
                        }
                      }
                    }
                  }
                  
                  // If not a fee transaction or we couldn't identify the parts properly,
                  // process as a regular withdrawal
                  if (!isFeeTransaction) {
                    for (const withdrawal of withdrawalChanges) {
                      // Find the recipient (account with positive change)
                      const recipientChange = tx.balanceChanges.find(
                        change => change.owner !== this.publicKey.toString() && change.change > 0
                      )
                      
                      if (recipientChange) {
                        const recipientWallet = recipientChange.owner
                        const amount = Math.abs(withdrawal.change)
                        
                        // Check if this was a withdrawal for a user we're tracking
                        // If so, update their balance by reducing it
                        try {
                          const balances = await getTokenBalancesForWallet(recipientWallet)
                          const tokenBalance = balances.find(balance => balance.tokenMint === tokenMint)
                          
                          if (tokenBalance) {
                            // Always process historical withdrawals during sync, even if balance goes negative
                            await forceWithdrawTokenBalance(
                              recipientWallet,
                              tokenMint,
                              amount,
                              tx.signature
                            )
                            
                            // Calculate and log the new balance
                            const currentBalance = Number(tokenBalance.balance)
                            const newBalance = currentBalance - amount
                            console.log(`Updated balance for wallet ${recipientWallet}: ${currentBalance} → ${newBalance} tokens`)
                            
                            // Flag negative balances as potential errors
                            if (newBalance < 0) {
                              console.warn(`⚠️ NEGATIVE BALANCE DETECTED: Wallet ${recipientWallet} has balance ${newBalance} tokens. This may indicate an accounting error.`)
                            }
                          }
                        } catch (err) {
                          console.error(`Error updating balance for recipient ${recipientWallet}:`, err)
                        }
                        
                        // Record the withdrawal transaction
                        await recordProcessedTransaction({
                          signature: tx.signature,
                          tokenMint,
                          type: 'withdrawal',
                          blockTime: tx.blockTime,
                          amount,
                          recipientWallet,
                          success: true
                        })
                        
                        console.log(`Recorded withdrawal of ${amount} tokens to ${recipientWallet} (tx: ${tx.signature.substring(0, 10)}...)`)
                        withdrawals++
                      }
                    }
                  } else {
                    // Process as a fee transaction
                    const totalAmount = recipientAmount + feeAmount
                    
                    // Update the user's balance if they're being tracked
                    try {
                      if (recipientWallet) {
                        const balances = await getTokenBalancesForWallet(recipientWallet)
                        const tokenBalance = balances.find(balance => balance.tokenMint === tokenMint)
                        
                        if (tokenBalance) {
                          // Deduct the FULL amount including fee from virtual balance
                          await forceWithdrawTokenBalance(
                            recipientWallet,
                            tokenMint,
                            totalAmount,
                            tx.signature
                          )
                          
                          // Calculate and log the new balance
                          const currentBalance = Number(tokenBalance.balance)
                          const newBalance = currentBalance - totalAmount
                          console.log(`Updated balance for wallet ${recipientWallet}: ${currentBalance} → ${newBalance} tokens (includes fee)`)
                          
                          // Flag negative balances as potential errors
                          if (newBalance < 0) {
                            console.warn(`⚠️ NEGATIVE BALANCE DETECTED: Wallet ${recipientWallet} has balance ${newBalance} tokens. This may indicate an accounting error.`)
                          }
                        }
                      }
                    } catch (err) {
                      console.error(`Error updating balance for fee transaction recipient ${recipientWallet}:`, err)
                    }
                    
                    // Record the withdrawal with fee transaction
                    await recordProcessedTransaction({
                      signature: tx.signature,
                      tokenMint,
                      type: 'withdrawal_with_fee',
                      blockTime: tx.blockTime,
                      amount: totalAmount,
                      feeAmount,
                      netAmount: recipientAmount,
                      recipientWallet,
                      feeWallet,
                      success: true
                    })
                    
                    console.log(`Recorded withdrawal with fee: ${recipientAmount} tokens to ${recipientWallet}, fee: ${feeAmount} tokens to ${feeWallet} (tx: ${tx.signature.substring(0, 10)}...)`)
                    withdrawals++
                  }
                }
              }
              
              // Update the sync state in the database
              await updateTokenSyncState(tokenMint, lastSignature, lastTimestamp || Date.now(), processedCount)
              
              console.log(`Token balance sync complete. Processed ${processedCount} transactions.`)
              console.log(`Updated ${updatedWallets} wallets, recorded ${deposits} deposits and ${withdrawals} withdrawals.`)
              
              return { 
                processed: processedCount, 
                updated: updatedWallets,
                deposits,
                withdrawals,
                lastSignature,
                lastTimestamp: lastTimestamp || Date.now()
              }
            } catch (err) {
              console.error(`Error syncing token balances: ${err.message}`)
              
              // Still update the sync state to avoid retrying the same failing range
              await updateTokenSyncState(tokenMint, null, Date.now(), 0)
              
              return {
                processed: 0,
                updated: 0,
                deposits: 0,
                withdrawals: 0,
                error: err.message,
                lastSignature: null,
                lastTimestamp: Date.now()
              }
            }
          }

          // Create the token object with public methods only
          token = {
            decimals: metadata?.mint?.decimals,
            supply: metadata?.mint?.supply,
            name: metadata?.metadata?.name,
            symbol: metadata?.metadata?.symbol,
            uri: metadata?.metadata?.uri,
            balance: walletAddress => balance({ tokenMint, walletAddress, decimals: token.decimals }),
            transfer: (recipientAddress, amount) =>
              transfer({ tokenMint, recipientAddress, amount, decimals: token.decimals }),
            onTransaction: callback => {
              subscribers.add(callback)
              return {
                unsubscribe: () => {
                  subscribers.delete(callback)
                  console.log(`Removed transaction callback for token: ${tokenMint}`)
                  
                  // If no subscribers left and no references to token, clean up
                  if (subscribers.size === 0 && !tokens.has(tokenMint)) {
                    // Remove all account listeners
                    for (const [accountStr, listenerID] of accountListeners.entries()) {
                      this.connection.removeAccountChangeListener(listenerID)
                      console.log(`Stopped watching token account: ${accountStr}`)
                    }
                    
                    // Remove program listener
                    this.connection.removeProgramAccountChangeListener(programListener)
                    
                    console.log(`Stopped watching token: ${tokenMint}`)
                  }
                }
              }
            },
            getServerBalance: async (playerId) => {
              try {
                // Get the player entity from the world
                const player = this.world.entities.get(playerId)
                if (!player) {
                  console.error(`Player with ID ${playerId} not found`)
                  return 0
                }

                // Get the player's wallet address
                const walletAddress = player.data?.solana
                if (!walletAddress) {
                  console.error(`Player ${playerId} has no wallet address`)
                  return 0
                }

                // Fetch the token balance for this wallet
                const balances = await getTokenBalancesForWallet(walletAddress)
                
                // Find the balance for this specific token
                const tokenBalance = balances.find(balance => balance.tokenMint === tokenMint)
                
                // Return the balance or 0 if not found
                return tokenBalance ? Number(tokenBalance.balance) : 0
              } catch (err) {
                console.error(`Error fetching server balance for player ${playerId}:`, err)
                return 0
              }
            },
            updateServerBalance: async (playerId, newBalance, options = {}) => {
              try {
                // Get the player entity from the world
                const player = this.world.entities.get(playerId)
                if (!player) {
                  console.error(`Player with ID ${playerId} not found`)
                  return { success: false, error: 'Player not found' }
                }

                // Get the player's wallet address
                const walletAddress = player.data?.solana
                if (!walletAddress) {
                  console.error(`Player ${playerId} has no wallet address`)
                  return { success: false, error: 'Player has no wallet address' }
                }

                // Ensure positive balance
                if (newBalance < 0) {
                  return { success: false, error: 'Balance cannot be negative' }
                }

                // Get the current balance to calculate change amount
                const balances = await getTokenBalancesForWallet(walletAddress)
                const tokenBalance = balances.find(balance => balance.tokenMint === tokenMint)
                const currentBalance = tokenBalance ? Number(tokenBalance.balance) : 0
                const changeAmount = newBalance - currentBalance
                
                // Determine the reason and initiator from options
                const reason = options.reason || `Balance adjusted to ${newBalance}`
                const initiatedBy = options.initiatedBy || 'admin'

                // Update the database
                const success = await setTokenBalance(walletAddress, tokenMint, newBalance)
                
                // Record the balance change in audit log
                if (success) {
                  await recordBalanceChange({
                    walletAddress,
                    tokenMint,
                    previousBalance: currentBalance,
                    newBalance,
                    changeAmount,
                    changeType: 'adjustment',
                    txSignature: null,
                    initiatedBy,
                    reason
                  })
                  
                  console.log(`Updated server balance for player ${playerId} to ${newBalance} ${metadata?.metadata?.symbol || tokenMint}`)
                  return { 
                    success: true, 
                    balance: newBalance,
                    message: `Balance updated to ${newBalance}`
                  }
                } else {
                  return { success: false, error: 'Database update failed' }
                }
              } catch (err) {
                console.error(`Error updating server balance for player ${playerId}:`, err)
                return { success: false, error: err.message }
              }
            },
            getBalanceAuditLogs: async (options = {}) => {
              try {
                // Always filter by this token mint
                const filterOptions = {
                  ...options,
                  tokenMint
                }
                
                return await getTokenBalanceAuditLogs(filterOptions)
              } catch (err) {
                console.error(`Error fetching balance audit logs for token ${tokenMint}:`, err)
                return {
                  logs: [],
                  pagination: {
                    total: 0,
                    limit: options.limit || 100,
                    offset: options.offset || 0,
                    hasMore: false
                  },
                  error: err.message
                }
              }
            },
            getPlayerBalanceAuditLogs: async (playerId, options = {}) => {
              try {
                // Get the player entity from the world
                const player = this.world.entities.get(playerId)
                if (!player) {
                  throw new Error(`Player with ID ${playerId} not found`)
                }

                // Get the player's wallet address
                const walletAddress = player.data?.solana
                if (!walletAddress) {
                  throw new Error(`Player ${playerId} has no wallet address`)
                }
                
                // Filter by player wallet and token mint
                const filterOptions = {
                  ...options,
                  walletAddress,
                  tokenMint
                }
                
                return await getTokenBalanceAuditLogs(filterOptions)
              } catch (err) {
                console.error(`Error fetching balance audit logs for player ${playerId}:`, err)
                return {
                  logs: [],
                  pagination: {
                    total: 0,
                    limit: options.limit || 100,
                    offset: options.offset || 0,
                    hasMore: false
                  },
                  error: err.message
                }
              }
            },
            withdrawTokens: async (playerId, amount) => {
              try {
                // Input validation
                if (!amount || amount <= 0) {
                  return { success: false, error: 'Invalid amount for withdrawal' }
                }

                // Get the player entity from the world
                const player = this.world.entities.get(playerId)
                if (!player) {
                  return { success: false, error: 'Player not found' }
                }

                // Get the player's wallet address
                const walletAddress = player.data?.solana
                if (!walletAddress) {
                  return { success: false, error: 'Player has no wallet address' }
                }

                // Verify the player has sufficient virtual balance
                const balances = await getTokenBalancesForWallet(walletAddress)
                const tokenBalance = balances.find(balance => balance.tokenMint === tokenMint)
                
                if (!tokenBalance || Number(tokenBalance.balance) < amount) {
                  return { 
                    success: false, 
                    error: 'Insufficient balance',
                    currentBalance: tokenBalance ? Number(tokenBalance.balance) : 0,
                    requested: amount
                  }
                }

                // Check if the server has enough actual tokens
                // Get server's token account
                const serverTokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                  this.publicKey,
                  { mint: new PublicKey(tokenMint) }
                )

                if (serverTokenAccounts.value.length === 0) {
                  return { success: false, error: 'Server has no token account for this token' }
                }

                // Calculate total server balance
                let serverBalance = 0
                for (const account of serverTokenAccounts.value) {
                  serverBalance += account.account.data.parsed.info.tokenAmount.uiAmount
                }

                if (serverBalance < amount) {
                  return { 
                    success: false, 
                    error: 'Server has insufficient tokens',
                    serverBalance,
                    requested: amount
                  }
                }

                // All checks passed, execute the transfer
                console.log(`Processing withdrawal of ${amount} tokens to ${walletAddress}`)

                // Calculate fee if applicable
                let feeAmount = 0
                if (this.withdrawalFeeBps > 0 && this.feeWalletAddress) {
                  // Calculate fee (bps = basis points, 1 bps = 0.01%)
                  feeAmount = (amount * this.withdrawalFeeBps) / 10000
                  
                  // Ensure fee has at least the minimum precision for this token
                  const minPrecision = 1 / (10 ** metadata?.mint?.decimals)
                  feeAmount = Math.max(feeAmount, minPrecision)
                  
                  // Round to token decimal places to avoid precision issues
                  feeAmount = parseFloat(feeAmount.toFixed(metadata?.mint?.decimals))
                  
                  console.log(`Applying withdrawal fee: ${feeAmount} tokens (${this.withdrawalFeeBps} bps)`)
                  console.log(`Fee recipient: ${this.feeWalletAddress}`)
                }

                // Calculate amount after fee that user will receive
                const amountAfterFee = amount - feeAmount
                
                // Calculate raw amounts based on decimals
                const rawAmountAfterFee = Math.floor(amountAfterFee * (10 ** metadata?.mint?.decimals))
                const rawFeeAmount = Math.floor(feeAmount * (10 ** metadata?.mint?.decimals))
                
                // Prepare the transaction
                const mintPubkey = new PublicKey(tokenMint)
                const recipientPubkey = new PublicKey(walletAddress)
                
                // Get token accounts
                const senderAta = await getOrCreateAssociatedTokenAccount(
                  this.connection,
                  this.wallet,
                  mintPubkey,
                  this.publicKey
                )
                
                // Get or create recipient token account
                const recipientAta = await getOrCreateAssociatedTokenAccount(
                  this.connection,
                  this.wallet,
                  mintPubkey,
                  recipientPubkey
                )
                
                // Create transaction
                const transaction = new Transaction()
                transaction.feePayer = this.publicKey
                
                // Add transfer instruction for the recipient
                transaction.add(
                  createTransferInstruction(
                    senderAta.address,
                    recipientAta.address,
                    this.publicKey,
                    rawAmountAfterFee,
                    [],
                    TOKEN_PROGRAM_ID
                  )
                )
                
                // If there's a fee, transfer it to the fee wallet
                if (feeAmount > 0 && this.feeWalletAddress) {
                  try {
                    const feeWalletPubkey = new PublicKey(this.feeWalletAddress)
                    
                    // Get or create fee wallet token account
                    const feeWalletAta = await getOrCreateAssociatedTokenAccount(
                      this.connection,
                      this.wallet,
                      mintPubkey,
                      feeWalletPubkey
                    )
                    
                    // Add fee transfer instruction
                    transaction.add(
                      createTransferInstruction(
                        senderAta.address,
                        feeWalletAta.address,
                        this.publicKey,
                        rawFeeAmount,
                        [],
                        TOKEN_PROGRAM_ID
                      )
                    )
                    
                    console.log(`Added fee transfer instruction: ${rawFeeAmount} raw units to ${feeWalletAta.address.toString()}`)
                  } catch (err) {
                    console.error(`Error setting up fee transfer: ${err.message}`)
                    // Continue with the main transfer even if fee transfer setup fails
                  }
                }
                
                // Get recent blockhash
                const { blockhash } = await this.connection.getLatestBlockhash()
                transaction.recentBlockhash = blockhash
                
                // Send transaction
                const signature = await this.connection.sendTransaction(transaction, [this.wallet])
                
                // Confirm transaction
                const confirmation = await this.connection.confirmTransaction(signature)
                
                if (confirmation.value.err) {
                  console.error('Transaction failed:', confirmation.value.err)
                  return { success: false, error: 'Transaction failed', signature }
                }
                
                // Record the transaction type based on whether there was a fee
                const transactionType = feeAmount > 0 ? 'withdrawal_with_fee' : 'withdrawal'
                const txTimestamp = Date.now()
                
                // Update the database to reduce the virtual balance - deduct the FULL amount
                // This is important as the user is withdrawing their full balance
                const dbUpdateSuccess = await withdrawTokenBalance(
                  walletAddress, 
                  tokenMint, 
                  amount, // Deduct the full amount including fee
                  signature,
                  true // Enable warnings for negative balance but allow the withdrawal to proceed
                )
                
                // Record the balance change in audit trail
                // We do this separately from withdrawTokenBalance's internal audit to ensure we have
                // the complete context and can add more details
                await recordBalanceChange({
                  walletAddress,
                  tokenMint,
                  previousBalance: Number(tokenBalance.balance),
                  newBalance: Number(tokenBalance.balance) - amount,
                  changeAmount: -amount,
                  changeType: 'withdrawal',
                  txSignature: signature,
                  initiatedBy: 'user',
                  reason: `Token withdrawal to on-chain wallet (Fee: ${feeAmount > 0 ? feeAmount : 0})`
                })
                
                // Record the withdrawal in the processed transactions table
                await recordProcessedTransaction({
                  signature,
                  tokenMint,
                  type: transactionType,
                  blockTime: txTimestamp,
                  amount: amount, // Full withdrawal amount
                  recipientWallet: walletAddress,
                  feeAmount: feeAmount > 0 ? feeAmount : undefined,
                  feeWallet: feeAmount > 0 ? this.feeWalletAddress : undefined,
                  netAmount: amountAfterFee, // Amount after fee
                  success: true
                })
                
                // Update tokenSyncState to track the last processed transaction
                await updateTokenSyncState(tokenMint, signature, txTimestamp, 1)
                
                if (!dbUpdateSuccess) {
                  console.error('Failed to update database after successful withdrawal')
                  return { 
                    success: true, 
                    warning: 'Transaction completed but database failed to update',
                    signature,
                    amount,
                    feeAmount: feeAmount > 0 ? feeAmount : undefined,
                    netAmount: amountAfterFee
                  }
                }
                
                console.log(`Withdrawal successful: ${amountAfterFee} tokens sent to ${walletAddress}`)
                if (feeAmount > 0) {
                  console.log(`Fee: ${feeAmount} tokens sent to ${this.feeWalletAddress}`)
                }
                console.log(`Updated tokenSyncState with latest transaction`)
                
                return {
                  success: true,
                  signature,
                  amount, // Full withdrawal amount
                  feeAmount: feeAmount > 0 ? feeAmount : undefined,
                  netAmount: amountAfterFee, // Amount after fee
                  message: `Successfully withdrawn ${amountAfterFee} tokens to wallet ${walletAddress}${feeAmount > 0 ? ` (fee: ${feeAmount})` : ''}`
                }
              } catch (err) {
                console.error('Error processing withdrawal:', err)
                return { success: false, error: err.message }
              }
            }
          }

          // Store the token in the cache
          tokens.set(tokenMint, token)
          
          // Auto-sync if in active mode
          if (this.mode === 'active') {
            // Get the sync state from the database
            const syncState = await getTokenSyncState(tokenMint)
            let timestamp = null
            
            if (syncState?.lastTxTimestamp) {
              // Use the last transaction timestamp as the starting point
              timestamp = Number(syncState.lastTxTimestamp)
              console.log(`Found existing sync state for ${tokenMint}, syncing from ${new Date(timestamp).toISOString()}`)
            } else {
              // Default to 30 days if no sync state exists
              timestamp = Date.now() - (30 * 24 * 60 * 60 * 1000)
              console.log(`No existing sync state for ${tokenMint}, syncing from ${new Date(timestamp).toISOString()}`)
            }
            
            // Perform the sync in the background
            setTimeout(async () => {
              try {
                console.log(`Starting automatic sync for token ${tokenMint}...`)
                const result = await _syncTokenBalances(timestamp)
                console.log(`Automatic sync complete: processed ${result.processed} transactions, updated ${result.updated} balances`)
              } catch (err) {
                console.error(`Error during automatic token sync: ${err.message}`)
              }
            }, 100)
          }

          return token
        } catch (error) {
          console.error(error)
        }
      },
    }
  }

  async init() {
    // Inject Solana functionality into apps
    const self = this
    self.world.apps.inject({
      app: {
        solana() {
          return self.world.solana || self
        },
      },
    })
    
    // Sync all tokens on startup
    if (this.mode === 'active') {
      // Run it after a short delay to ensure the system is fully initialized
      setTimeout(() => {
        this.syncAllTokensOnStartup()
      }, 3500)
    }
  }

  async syncAllTokensOnStartup() {
    if (this.mode !== 'active') {
      console.log('Skipping token sync in watch mode')
      return
    }

    console.log('Starting token sync process on startup...')
    
    try {
      // Get all active tokens from the database
      const activeTokens = await getActiveTokens()
      console.log(`Found ${activeTokens.length} active tokens to sync`)
      
      if (activeTokens.length === 0) {
        console.log('No active tokens found. Startup sync complete.')
        return
      }
      
      // Process each token
      for (const tokenState of activeTokens) {
        try {
          console.log(`Syncing token: ${tokenState.tokenMint}`)
          
          // Get the token instance - this will automatically trigger sync
          // No need to manually call sync anymore
          const token = await this.programs.token(tokenState.tokenMint)
          if (!token) {
            console.error(`Failed to get token instance for ${tokenState.tokenMint}`)
            continue
          }
          
          console.log(`Token ${tokenState.tokenMint} initialized and sync initiated`)
          
          // Add a delay between token inits to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (err) {
          console.error(`Error syncing token ${tokenState.tokenMint}:`, err)
        }
      }
      
      console.log('Startup token sync completed')
    } catch (err) {
      console.error('Error during startup token sync:', err)
    }
  }

  async getBalance() {
    if (!this.connection) return 0
    const balance = await this.connection.getBalance(this.publicKey)
    return (balance / 1e9).toFixed(4)
  }

  isWatchMode() {
    return this.mode === 'watch'
  }

  isActiveMode() {
    return this.mode === 'active'
  }

  getMode() {
    return this.mode
  }

  // Validate a signature against a message and wallet address
  async validateSignature(walletAddress, message, signature) {
    try {
      // Convert wallet address to PublicKey
      const publicKey = new PublicKey(walletAddress)
      
      // Convert message to Uint8Array if it's a string
      const messageBytes = typeof message === 'string' 
        ? new TextEncoder().encode(message) 
        : message
      
      // Convert signature from base64 to Uint8Array if it's in base64 format
      let signatureBytes
      if (typeof signature === 'string') {
        signatureBytes = Buffer.from(signature, 'base64')
      } else {
        signatureBytes = signature
      }
      
      // Use nacl for verification as recommended in Solana docs
      const isValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKey.toBytes()
      )
      
      return {
        success: true,
        isValid,
        message: isValid ? 'Signature is valid' : 'Invalid signature'
      }
    } catch (err) {
      console.error('Error validating signature:', err)
      return {
        success: false,
        isValid: false,
        error: err.message || 'Failed to validate signature'
      }
    }
  }

  // New method to get token balance audit logs
  async getTokenBalanceAuditLogs(options = {}) {
    try {
      return await getTokenBalanceAuditLogs(options)
    } catch (err) {
      console.error('Error fetching token balance audit logs:', err)
      return {
        logs: [],
        pagination: {
          total: 0,
          limit: options.limit || 100,
          offset: options.offset || 0,
          hasMore: false
        },
        error: err.message
      }
    }
  }

  debug() {
    console.log('mode', this.mode)
    console.log('publicKey', this.publicKey.toString())
    if (this.wallet) {
      console.log('has wallet', true)
    } else {
      console.log('has wallet', false)
    }
    console.log('connection', this.connection)
  }
}
