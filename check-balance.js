// Check STRK balance of admin wallet
const ADMIN_ADDRESS = '0x0266875577145FF4174BC9021A3c2e7f2C7ea94578f8e4e98bCB03a2a8A2329C';
const STRK_TOKEN = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const RPC_URL = 'https://rpc.starknet-testnet.lava.build';

async function rpcCall(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
  });
  return response.json();
}

async function main() {
  console.log('Checking STRK balance for admin wallet...\n');
  console.log('Admin address:', ADMIN_ADDRESS);
  
  // Call balanceOf on STRK token
  const balanceSelector = '0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e'; // balanceOf selector
  
  const result = await rpcCall('starknet_call', {
    request: {
      contract_address: STRK_TOKEN,
      entry_point_selector: balanceSelector,
      calldata: [ADMIN_ADDRESS]
    },
    block_id: 'latest'
  });
  
  if (result.error) {
    console.log('Error:', result.error);
    return;
  }
  
  // Parse Uint256 (low, high)
  const low = BigInt(result.result[0]);
  const high = BigInt(result.result[1] || '0x0');
  const balance = low + (high << 128n);
  const balanceInStrk = Number(balance) / 1e18;
  
  console.log('\nSTRK Balance:', balanceInStrk.toFixed(6), 'STRK');
  console.log('Raw balance:', balance.toString());
  
  if (balanceInStrk < 0.01) {
    console.log('\n⚠️  WARNING: Balance too low to pay fees!');
    console.log('Get test STRK from: https://starknet-faucet.vercel.app/');
  } else {
    console.log('\n✓ Balance should be sufficient for fees');
  }
}

main().catch(console.error);
