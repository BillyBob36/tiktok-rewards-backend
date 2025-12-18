const express = require('express');
const { RpcProvider, Account, Contract, uint256, CallData, constants } = require('starknet');
const db = require('../db');

const router = express.Router();

// Simple admin auth middleware
const adminAuth = (req, res, next) => {
  const password = req.headers['x-admin-password'];
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ERC20 ABI (minimal for transfer)
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'recipient', type: 'felt' },
      { name: 'amount', type: 'Uint256' }
    ],
    outputs: [{ name: 'success', type: 'felt' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'felt' }],
    outputs: [{ name: 'balance', type: 'Uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'felt' }],
    stateMutability: 'view'
  }
];

// Initialize Starknet provider and account
function getStarknetAccount() {
  const provider = new RpcProvider({ 
    nodeUrl: process.env.STARKNET_RPC_URL
  });
  // Use Account with V3 transaction support (STRK fee token)
  const account = new Account(
    provider,
    process.env.STARKNET_ADMIN_ADDRESS,
    process.env.STARKNET_ADMIN_PRIVATE_KEY,
    '1' // cairoVersion 1 for Argent X
  );
  return { provider, account };
}

// Get admin wallet balance
router.get('/balance', adminAuth, async (req, res) => {
  try {
    const { provider, account } = getStarknetAccount();
    const strkContract = new Contract(ERC20_ABI, process.env.STRK_TOKEN_ADDRESS, provider);
    
    const balanceResult = await strkContract.call('balanceOf', [account.address], { blockIdentifier: 'latest' });
    // Handle Uint256 response (can be object with low/high or BigInt)
    let balanceBigInt;
    if (typeof balanceResult === 'bigint') {
      balanceBigInt = balanceResult;
    } else if (balanceResult.balance) {
      balanceBigInt = BigInt(balanceResult.balance.toString());
    } else if (balanceResult.low !== undefined) {
      balanceBigInt = BigInt(balanceResult.low) + (BigInt(balanceResult.high) << 128n);
    } else {
      balanceBigInt = BigInt(balanceResult.toString());
    }
    
    const balanceInStrk = Number(balanceBigInt) / 1e18;

    res.json({
      address: account.address,
      balance: balanceInStrk.toFixed(4),
      raw: balanceBigInt.toString()
    });
  } catch (error) {
    console.error('Balance check error:', error);
    res.status(500).json({ error: 'Failed to check balance' });
  }
});

// Pay selected winners
router.post('/', adminAuth, async (req, res) => {
  try {
    const { submissionIds } = req.body;

    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
      return res.status(400).json({ error: 'Submission IDs array required' });
    }

    // Get submissions
    const placeholders = submissionIds.map(() => '?').join(',');
    const submissions = db.prepare(`
      SELECT s.*, c.reward_amount 
      FROM submissions s 
      JOIN campaigns c ON s.campaign_id = c.id 
      WHERE s.id IN (${placeholders}) AND s.status IN ('eligible', 'winner')
    `).all(...submissionIds);

    if (submissions.length === 0) {
      return res.status(400).json({ error: 'No eligible submissions found' });
    }

    const { provider, account } = getStarknetAccount();
    const strkContract = new Contract(ERC20_ABI, process.env.STRK_TOKEN_ADDRESS, provider);
    strkContract.connect(account);

    const results = [];

    for (const submission of submissions) {
      try {
        // Convert reward amount to wei (18 decimals)
        const amountInWei = BigInt(Math.floor(parseFloat(submission.reward_amount) * 1e18));
        const amountUint256 = uint256.bnToUint256(amountInWei);

        // Get nonce with 'latest' block (Alchemy doesn't support 'pending')
        const nonce = await provider.getNonceForAddress(account.address, 'latest');
        
        // Execute transfer with explicit nonce
        const { transaction_hash } = await account.execute(
          {
            contractAddress: process.env.STRK_TOKEN_ADDRESS,
            entrypoint: 'transfer',
            calldata: CallData.compile({
              recipient: submission.wallet_address,
              amount: amountUint256
            })
          },
          undefined, // abi
          { nonce } // options with nonce
        );

        // Wait for transaction
        await provider.waitForTransaction(transaction_hash);

        // Update submission
        db.prepare(`
          UPDATE submissions 
          SET status = 'paid', tx_hash = ?, paid_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(transaction_hash, submission.id);

        results.push({
          id: submission.id,
          success: true,
          txHash: transaction_hash,
          amount: submission.reward_amount
        });

      } catch (txError) {
        console.error(`Payout failed for submission ${submission.id}:`, txError);
        results.push({
          id: submission.id,
          success: false,
          error: txError.message
        });
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      message: `Payout complete: ${successful} successful, ${failed} failed`,
      results
    });

  } catch (error) {
    console.error('Payout error:', error);
    res.status(500).json({ error: 'Payout failed: ' + error.message });
  }
});

// Simulate payout (for testing without real transactions)
router.post('/simulate', adminAuth, async (req, res) => {
  try {
    const { submissionIds } = req.body;

    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
      return res.status(400).json({ error: 'Submission IDs array required' });
    }

    const placeholders = submissionIds.map(() => '?').join(',');
    const submissions = db.prepare(`
      SELECT s.*, c.reward_amount 
      FROM submissions s 
      JOIN campaigns c ON s.campaign_id = c.id 
      WHERE s.id IN (${placeholders}) AND s.status IN ('eligible', 'winner')
    `).all(...submissionIds);

    const results = submissions.map(s => ({
      id: s.id,
      wallet: s.wallet_address,
      amount: s.reward_amount,
      tiktokUser: s.tiktok_username
    }));

    const totalAmount = submissions.reduce((sum, s) => sum + parseFloat(s.reward_amount), 0);

    res.json({
      count: submissions.length,
      totalAmount: totalAmount.toFixed(2),
      submissions: results
    });

  } catch (error) {
    console.error('Simulation error:', error);
    res.status(500).json({ error: 'Simulation failed' });
  }
});

module.exports = router;
