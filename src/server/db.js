import Knex from 'knex'
import moment from 'moment'

let db

export async function getDB(path) {
  if (!db) {
    db = Knex({
      client: 'better-sqlite3',
      connection: {
        filename: path,
      },
      useNullAsDefault: true,
    })
    await migrate(db)
  }
  return db
}

// Function to handle token transfers to the server wallet
export async function updateTokenBalance(walletAddress, tokenMint, amount, txSignature) {
  const now = moment().toISOString()
  
  try {
    // Check if entry exists
    const entry = await db('tokenBalances')
      .where({ walletAddress, tokenMint })
      .first()
    
    const previousBalance = entry ? Number(entry.balance) : 0;
    const newBalance = previousBalance + amount;
    
    if (entry) {
      // Update existing entry
      await db('tokenBalances')
        .where({ walletAddress, tokenMint })
        .update({
          balance: db.raw(`balance + ${amount}`),
          lastTxAt: now,
          lastTxSignature: txSignature
        })
    } else {
      // Create new entry
      await db('tokenBalances').insert({
        walletAddress,
        tokenMint,
        balance: amount,
        firstTxAt: now,
        lastTxAt: now,
        lastTxSignature: txSignature
      })
    }
    
    // Record the change in audit log
    await recordBalanceChange({
      walletAddress,
      tokenMint,
      previousBalance,
      newBalance,
      changeAmount: amount,
      changeType: 'deposit',
      txSignature,
      initiatedBy: 'system',
      reason: 'Transaction deposit'
    });
    
    return true
  } catch (error) {
    console.error('Error updating token balance:', error)
    return false
  }
}

// Function to get token balances for a wallet
export async function getTokenBalancesForWallet(walletAddress) {
  try {
    return await db('tokenBalances')
      .where({ walletAddress })
      .select('*')
  } catch (error) {
    console.error('Error fetching token balances:', error)
    return []
  }
}

// Function to get all wallets with token balances
export async function getWalletsWithTokenBalances(tokenMint) {
  try {
    return await db('tokenBalances')
      .where({ tokenMint })
      .select('*')
  } catch (error) {
    console.error('Error fetching wallets with token balances:', error)
    return []
  }
}

// Function to directly set a token balance (for script use)
export async function setTokenBalance(walletAddress, tokenMint, amount) {
  const now = moment().toISOString()
  
  try {
    // Check if entry exists
    const entry = await db('tokenBalances')
      .where({ walletAddress, tokenMint })
      .first()
    
    const previousBalance = entry ? Number(entry.balance) : 0;
    const changeAmount = amount - previousBalance;
    
    if (entry) {
      // Update existing entry
      await db('tokenBalances')
        .where({ walletAddress, tokenMint })
        .update({
          balance: amount,
          lastTxAt: now
        })
    } else {
      // Create new entry
      await db('tokenBalances').insert({
        walletAddress,
        tokenMint,
        balance: amount,
        firstTxAt: now,
        lastTxAt: now
      })
    }
    
    // Record the change in audit log
    await recordBalanceChange({
      walletAddress,
      tokenMint,
      previousBalance,
      newBalance: amount,
      changeAmount,
      changeType: 'adjustment',
      txSignature: null,
      initiatedBy: 'admin',
      reason: 'Manual balance adjustment'
    });
    
    return true
  } catch (error) {
    console.error('Error setting token balance:', error)
    return false
  }
}

// Function to withdraw tokens (reduce balance)
export async function withdrawTokenBalance(walletAddress, tokenMint, amount, txSignature, warningIfInsufficientBalance = false) {
  const now = moment().toISOString()
  
  try {
    // Start a transaction to ensure atomicity
    await db.transaction(async trx => {
      // Get current balance
      const entry = await trx('tokenBalances')
        .where({ walletAddress, tokenMint })
        .first()
        
      if (!entry) {
        throw new Error('No balance record found')
      }
      
      const currentBalance = Number(entry.balance)

      // Check if sufficient balance (if not in warning mode)
      if (!warningIfInsufficientBalance && currentBalance < amount) {
        throw new Error('Insufficient balance')
      }
      
      // Calculate new balance
      const newBalance = currentBalance - amount
      
      // If it would go negative and we're only warning, log the warning
      if (newBalance < 0 && warningIfInsufficientBalance) {
        console.warn(`WARNING: Withdrawal of ${amount} from wallet ${walletAddress} causes negative balance: ${newBalance}`)
      }
      
      // Update the balance
      await trx('tokenBalances')
        .where({ walletAddress, tokenMint })
        .update({
          balance: newBalance,
          lastTxAt: now,
          lastTxSignature: txSignature
        })
        
      // Record the change in audit log
      await trx('tokenBalanceAuditLog').insert({
        walletAddress,
        tokenMint,
        previousBalance: currentBalance,
        newBalance,
        changeAmount: -amount,
        changeType: 'withdrawal',
        txSignature,
        initiatedBy: 'system',
        reason: 'Token withdrawal',
        timestamp: now
      });
    })
    
    return true
  } catch (error) {
    console.error('Error withdrawing token balance:', error)
    return false
  }
}

// Function to withdraw tokens without balance check (for sync operations)
export async function forceWithdrawTokenBalance(walletAddress, tokenMint, amount, txSignature) {
  const now = moment().toISOString()
  
  try {
    // Start a transaction to ensure atomicity
    await db.transaction(async trx => {
      // Get current balance
      const entry = await trx('tokenBalances')
        .where({ walletAddress, tokenMint })
        .first()
      
      let currentBalance = 0;
      let newBalance = 0;
      
      if (!entry) {
        // No balance entry exists yet, create one with negative balance
        newBalance = -amount;
        await trx('tokenBalances').insert({
          walletAddress,
          tokenMint,
          balance: newBalance, // Allow negative balance
          firstTxAt: now,
          lastTxAt: now,
          lastTxSignature: txSignature
        })
      } else {
        // Calculate new balance, allowing it to go negative
        currentBalance = Number(entry.balance)
        newBalance = currentBalance - amount
      
        // Update the balance
        await trx('tokenBalances')
          .where({ walletAddress, tokenMint })
          .update({
            balance: newBalance,
            lastTxAt: now,
            lastTxSignature: txSignature
          })
      }
      
      // Record the change in audit log
      await trx('tokenBalanceAuditLog').insert({
        walletAddress,
        tokenMint,
        previousBalance: currentBalance,
        newBalance,
        changeAmount: -amount,
        changeType: 'forced_withdrawal',
        txSignature,
        initiatedBy: 'system',
        reason: 'Forced token withdrawal during sync',
        timestamp: now
      });
    })
    
    return true
  } catch (error) {
    console.error('Error force withdrawing token balance:', error)
    return false
  }
}

// Function to get the sync state for a token
export async function getTokenSyncState(tokenMint) {
  try {
    const syncState = await db('tokenSyncState')
      .where({ tokenMint })
      .first()
    
    return syncState || null
  } catch (error) {
    console.error(`Error getting sync state for token ${tokenMint}:`, error)
    return null
  }
}

// Function to update the sync state for a token
export async function updateTokenSyncState(tokenMint, lastTxSignature, lastTxTimestamp, processedCount = 1) {
  const now = moment().toISOString()
  
  try {
    // Check if entry exists
    const exists = await db('tokenSyncState')
      .where({ tokenMint })
      .first()
    
    if (exists) {
      // Update existing entry
      await db('tokenSyncState')
        .where({ tokenMint })
        .update({
          lastTxSignature,
          lastTxTimestamp,
          lastSyncAt: now,
          processedTxCount: db.raw(`processedTxCount + ${processedCount}`),
          isActive: true
        })
    } else {
      // Create new entry
      await db('tokenSyncState').insert({
        tokenMint,
        lastTxSignature,
        lastTxTimestamp,
        lastSyncAt: now,
        processedTxCount: processedCount,
        isActive: true
      })
    }
    
    return true
  } catch (error) {
    console.error(`Error updating sync state for token ${tokenMint}:`, error)
    return false
  }
}

// Function to mark a token as inactive
export async function deactivateTokenSync(tokenMint) {
  try {
    await db('tokenSyncState')
      .where({ tokenMint })
      .update({ isActive: false })
    
    return true
  } catch (error) {
    console.error(`Error deactivating token sync for ${tokenMint}:`, error)
    return false
  }
}

// Function to get all active tokens
export async function getActiveTokens() {
  try {
    return await db('tokenSyncState')
      .where({ isActive: true })
      .select('*')
  } catch (error) {
    console.error('Error fetching active tokens:', error)
    return []
  }
}

// Check if a transaction has already been processed
export async function isTransactionProcessed(signature) {
  try {
    const exists = await db('processedTransactions')
      .where({ signature })
      .first()
    
    return !!exists
  } catch (error) {
    console.error(`Error checking if transaction is processed: ${error.message}`)
    return false
  }
}

// Record a processed transaction
export async function recordProcessedTransaction(transaction) {
  const now = moment().toISOString()
  
  try {
    await db('processedTransactions').insert({
      signature: transaction.signature,
      tokenMint: transaction.tokenMint,
      type: transaction.type,
      processedAt: now,
      blockTime: transaction.blockTime,
      amount: transaction.amount,
      senderWallet: transaction.senderWallet,
      recipientWallet: transaction.recipientWallet,
      success: transaction.success
    })
    
    return true
  } catch (error) {
    console.error(`Error recording processed transaction: ${error.message}`)
    return false
  }
}

// Get all processed transactions for a token
export async function getProcessedTransactions(tokenMint, type = null, limit = 100, offset = 0) {
  try {
    let query = db('processedTransactions')
      .where({ tokenMint })
      .orderBy('blockTime', 'desc')
      .limit(limit)
      .offset(offset)
    
    if (type) {
      query = query.where({ type })
    }
    
    return await query
  } catch (error) {
    console.error(`Error fetching processed transactions: ${error.message}`)
    return []
  }
}

// Record a token withdrawal transaction
export async function recordTokenWithdrawal(tokenMint, amount, recipientWallet, signature, blockTime) {
  const now = moment().toISOString()
  
  try {
    await db('processedTransactions').insert({
      signature,
      tokenMint,
      type: 'withdrawal',
      processedAt: now,
      blockTime,
      amount,
      recipientWallet,
      success: true
    })
    
    return true
  } catch (error) {
    console.error(`Error recording token withdrawal: ${error.message}`)
    return false
  }
}

// New function to record token balance changes in audit log
export async function recordBalanceChange(params) {
  const {
    walletAddress,
    tokenMint,
    previousBalance,
    newBalance,
    changeAmount,
    changeType,
    txSignature,
    initiatedBy,
    reason
  } = params;
  
  const now = moment().toISOString();
  
  try {
    await db('tokenBalanceAuditLog').insert({
      walletAddress,
      tokenMint,
      previousBalance: previousBalance || 0,
      newBalance: newBalance || 0,
      changeAmount,
      changeType, // 'deposit', 'withdrawal', 'adjustment', 'initialization'
      txSignature,
      initiatedBy: initiatedBy || 'system', // 'system', 'admin', 'user', etc.
      reason: reason || '',
      timestamp: now
    });
    
    return true;
  } catch (error) {
    console.error('Error recording balance audit log:', error);
    return false;
  }
}

// Get token balance audit logs with various filtering options
export async function getTokenBalanceAuditLogs(options = {}) {
  try {
    const {
      walletAddress,
      tokenMint,
      changeType,
      initiatedBy,
      startTime,
      endTime,
      limit = 100,
      offset = 0,
      sortBy = 'timestamp',
      sortDirection = 'desc'
    } = options;
    
    let query = db('tokenBalanceAuditLog');
    
    // Apply filters
    if (walletAddress) {
      query = query.where('walletAddress', walletAddress);
    }
    
    if (tokenMint) {
      query = query.where('tokenMint', tokenMint);
    }
    
    if (changeType) {
      // Handle array of change types or single type
      if (Array.isArray(changeType)) {
        query = query.whereIn('changeType', changeType);
      } else {
        query = query.where('changeType', changeType);
      }
    }
    
    if (initiatedBy) {
      query = query.where('initiatedBy', initiatedBy);
    }
    
    if (startTime) {
      query = query.where('timestamp', '>=', startTime);
    }
    
    if (endTime) {
      query = query.where('timestamp', '<=', endTime);
    }
    
    // Apply sorting
    query = query.orderBy(sortBy, sortDirection);
    
    // Apply pagination
    query = query.limit(limit).offset(offset);
    
    // Get total count for pagination
    const countQuery = db('tokenBalanceAuditLog');
    
    // Apply the same filters to count query
    if (walletAddress) {
      countQuery.where('walletAddress', walletAddress);
    }
    
    if (tokenMint) {
      countQuery.where('tokenMint', tokenMint);
    }
    
    if (changeType) {
      if (Array.isArray(changeType)) {
        countQuery.whereIn('changeType', changeType);
      } else {
        countQuery.where('changeType', changeType);
      }
    }
    
    if (initiatedBy) {
      countQuery.where('initiatedBy', initiatedBy);
    }
    
    if (startTime) {
      countQuery.where('timestamp', '>=', startTime);
    }
    
    if (endTime) {
      countQuery.where('timestamp', '<=', endTime);
    }
    
    const totalCount = await countQuery.count('id as count').first();
    
    // Get the audit logs
    const logs = await query;
    
    return {
      logs,
      pagination: {
        total: totalCount ? totalCount.count : 0,
        limit,
        offset,
        hasMore: (offset + limit) < (totalCount ? totalCount.count : 0)
      }
    };
  } catch (error) {
    console.error('Error fetching token balance audit logs:', error);
    return {
      logs: [],
      pagination: {
        total: 0,
        limit,
        offset: 0,
        hasMore: false
      },
      error: error.message
    };
  }
}

async function migrate(db) {
  // ensure we have our config table
  const exists = await db.schema.hasTable('config')
  if (!exists) {
    await db.schema.createTable('config', table => {
      table.string('key').primary()
      table.string('value')
    })
    await db('config').insert({ key: 'version', value: '0' })
  }
  // get current version
  const versionRow = await db('config').where('key', 'version').first()
  let version = parseInt(versionRow.value)
  // run missing migrations
  for (let i = version; i < migrations.length; i++) {
    console.log(`running migration #${i + 1}...`)
    await migrations[i](db)
    await db('config')
      .where('key', 'version')
      .update('value', (i + 1).toString())
    version = i + 1
  }
}

/**
 * NOTE: always append new migrations and never modify pre-existing ones!
 */
const migrations = [
  // add users table
  async db => {
    await db.schema.createTable('users', table => {
      table.string('id').primary()
      table.string('name').notNullable()
      table.string('roles').notNullable()
      table.timestamp('createdAt').notNullable()
    })
  },
  // add blueprints & entities tables
  async db => {
    await db.schema.createTable('blueprints', table => {
      table.string('id').primary()
      table.text('data').notNullable()
      table.timestamp('createdAt').notNullable()
      table.timestamp('updatedAt').notNullable()
    })
    await db.schema.createTable('entities', table => {
      table.string('id').primary()
      table.text('data').notNullable()
      table.timestamp('createdAt').notNullable()
      table.timestamp('updatedAt').notNullable()
    })
  },
  // add blueprint.version field
  async db => {
    const now = moment().toISOString()
    const blueprints = await db('blueprints')
    for (const blueprint of blueprints) {
      const data = JSON.parse(blueprint.data)
      if (data.version === undefined) {
        data.version = 0
        await db('blueprints')
          .where('id', blueprint.id)
          .update({
            data: JSON.stringify(data),
            updatedAt: now,
          })
      }
    }
  },
  // add user.vrm field
  async db => {
    await db.schema.alterTable('users', table => {
      table.string('vrm').nullable()
    })
  },
  // add blueprint.config field
  async db => {
    const blueprints = await db('blueprints')
    for (const blueprint of blueprints) {
      const data = JSON.parse(blueprint.data)
      if (data.config === undefined) {
        data.config = {}
        await db('blueprints')
          .where('id', blueprint.id)
          .update({
            data: JSON.stringify(data),
          })
      }
    }
  },
  // rename user.vrm -> user.avatar
  async db => {
    await db.schema.alterTable('users', table => {
      table.renameColumn('vrm', 'avatar')
    })
  },
  // add blueprint.preload field
  async db => {
    const blueprints = await db('blueprints')
    for (const blueprint of blueprints) {
      const data = JSON.parse(blueprint.data)
      if (data.preload === undefined) {
        data.preload = false
        await db('blueprints')
          .where('id', blueprint.id)
          .update({
            data: JSON.stringify(data),
          })
      }
    }
  },
  // blueprint.config -> blueprint.props
  async db => {
    const blueprints = await db('blueprints')
    for (const blueprint of blueprints) {
      const data = JSON.parse(blueprint.data)
      data.props = data.config
      delete data.config
      await db('blueprints')
        .where('id', blueprint.id)
        .update({
          data: JSON.stringify(data),
        })
    }
  },
  // add blueprint.public and blueprint.locked fields
  async db => {
    const blueprints = await db('blueprints')
    for (const blueprint of blueprints) {
      const data = JSON.parse(blueprint.data)
      let changed
      if (data.public === undefined) {
        data.public = false
        changed = true
      }
      if (data.locked === undefined) {
        data.locked = false
        changed = true
      }
      if (changed) {
        await db('blueprints')
          .where('id', blueprint.id)
          .update({
            data: JSON.stringify(data),
          })
      }
    }
  },
  // add blueprint.unique field
  async db => {
    const blueprints = await db('blueprints')
    for (const blueprint of blueprints) {
      const data = JSON.parse(blueprint.data)
      let changed
      if (data.unique === undefined) {
        data.unique = false
        changed = true
      }
      if (changed) {
        await db('blueprints')
          .where('id', blueprint.id)
          .update({
            data: JSON.stringify(data),
          })
      }
    }
  },
  // rename config key to settings
  async db => {
    let config = await db('config').where('key', 'config').first()
    if (config) {
      const settings = config.value
      await db('config').insert({ key: 'settings', value: settings })
      await db('config').where('key', 'config').delete()
    }
  },
  // add tokenBalances table to track wallets sending tokens to server
  async db => {
    await db.schema.createTable('tokenBalances', table => {
      // Primary composite key: wallet address + token mint
      table.string('walletAddress').notNullable()
      table.string('tokenMint').notNullable()
      table.decimal('balance', 36, 18).notNullable().defaultTo(0)
      table.timestamp('firstTxAt').notNullable()
      table.timestamp('lastTxAt').notNullable()
      table.string('lastTxSignature')
      table.primary(['walletAddress', 'tokenMint'])
    })
  },
  // add tokenSyncState table to track the last processed transaction per token
  async db => {
    await db.schema.createTable('tokenSyncState', table => {
      table.string('tokenMint').primary()
      table.string('lastTxSignature')
      table.bigInteger('lastTxTimestamp') // Unix timestamp in milliseconds
      table.timestamp('lastSyncAt').notNullable()
      table.integer('processedTxCount').defaultTo(0)
      table.boolean('isActive').defaultTo(true)
    })
  },
  // add processedTransactions table to prevent duplicate processing
  async db => {
    await db.schema.createTable('processedTransactions', table => {
      table.string('signature').primary() // Transaction signature is unique
      table.string('tokenMint').notNullable()
      table.string('type').notNullable() // 'deposit', 'withdrawal', or 'withdrawal_with_fee'
      table.timestamp('processedAt').notNullable()
      table.bigInteger('blockTime') // Transaction block time
      table.decimal('amount', 36, 18) // Full amount involved
      table.decimal('feeAmount', 36, 18) // Fee amount (for withdrawals with fees)
      table.decimal('netAmount', 36, 18) // Net amount after fee
      table.string('senderWallet') // Sender wallet (for deposits)
      table.string('recipientWallet') // Recipient wallet (for withdrawals)
      table.string('feeWallet') // Fee recipient wallet
      table.boolean('success').defaultTo(true) // Whether the transaction processing succeeded
      
      // Create index for faster queries
      table.index(['tokenMint', 'type'])
      table.index('blockTime')
    })
  },
  // add tokenBalanceAuditLog table for tracking balance changes
  async db => {
    await db.schema.createTable('tokenBalanceAuditLog', table => {
      table.increments('id').primary()
      table.string('walletAddress').notNullable()
      table.string('tokenMint').notNullable()
      table.decimal('previousBalance', 36, 18).notNullable()
      table.decimal('newBalance', 36, 18).notNullable()
      table.decimal('changeAmount', 36, 18).notNullable()
      table.string('changeType').notNullable() // 'deposit', 'withdrawal', 'adjustment', 'forced_withdrawal', 'initialization'
      table.string('txSignature')
      table.string('initiatedBy').notNullable() // 'system', 'admin', 'user'
      table.string('reason')
      table.timestamp('timestamp').notNullable()
      
      // Create indices for faster queries
      table.index(['walletAddress', 'tokenMint'])
      table.index('timestamp')
      table.index('changeType')
    })
  },
]
