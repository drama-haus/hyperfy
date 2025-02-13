import { useState, useCallback } from 'react'
import { getAssociatedTokenAddress, createTransferInstruction, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import { useConnection } from '@solana/wallet-adapter-react'

export const useSplTransfer = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [signature, setSignature] = useState(null)
  const { connection } = useConnection()

  const transfer = useCallback(async ({ tokenMint, recipientAddress, amount, decimals = 9, onSuccess, onError }) => {
    setIsLoading(true)
    setError(null)
    setSignature(null)

    try {
      // Validate wallet connection
      if (!window.solana?.publicKey) {
        throw new Error('Wallet not connected')
      }

      // Convert addresses to PublicKey objects
      const mintPubkey = new PublicKey(tokenMint)
      const recipientPubkey = new PublicKey(recipientAddress)
      const senderPubkey = window.solana.publicKey

      // Get associated token accounts
      const senderAta = await getAssociatedTokenAddress(mintPubkey, senderPubkey, false, TOKEN_PROGRAM_ID)

      const recipientAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey, false, TOKEN_PROGRAM_ID)

      console.log({ connection: connection, senderAta, TOKEN_PROGRAM_ID })
      // Check sender's balance
      const senderAccount = await getAccount(connection, senderAta, 'confirmed', TOKEN_PROGRAM_ID)

      if (Number(senderAccount.amount) < amount) {
        throw new Error('Insufficient token balance')
      }

      // Create transfer instruction
      const transferInstruction = createTransferInstruction(
        senderAta,
        recipientAta,
        senderPubkey,
        amount,
        [],
        TOKEN_PROGRAM_ID
      )

      // Create and sign transaction
      const transaction = new Transaction().add(transferInstruction)
      transaction.feePayer = senderPubkey

      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash

      const signed = await window.solana.signTransaction(transaction)
      const txSignature = await connection.sendRawTransaction(signed.serialize())

      // Confirm transaction
      const confirmation = await connection.confirmTransaction(txSignature)

      if (confirmation.value.err) {
        throw new Error('Transaction failed')
      }

      setSignature(txSignature)
      onSuccess?.({
        signature: txSignature,
        amount: amount / 10 ** decimals,
      })

      return {
        success: true,
        signature: txSignature,
        message: `Successfully sent ${amount / 10 ** decimals} tokens`,
      }
    } catch (err) {
      const errorMessage = err.message || 'Failed to send tokens'
      setError(errorMessage)
      onError?.(errorMessage)

      return {
        success: false,
        error: errorMessage,
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    transfer,
    isLoading,
    error,
    signature,
    resetState: () => {
      setError(null)
      setSignature(null)
    },
  }
}