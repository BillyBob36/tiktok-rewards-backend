// Test RPC endpoints using raw fetch (no dependencies needed)
const RPC_ENDPOINTS = [
  'https://starknet-sepolia.drpc.org',
  'https://free-rpc.nethermind.io/sepolia-juno/',
  'https://starknet-sepolia.public.blastapi.io/rpc/v0_7',
  'https://rpc.starknet-testnet.lava.build',
  'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/J1SZNIOIqbvCoylZ8yJlT',
];

const ADMIN_ADDRESS = '0x0266875577145FF4174BC9021A3c2e7f2C7ea94578f8e4e98bCB03a2a8A2329C';

async function rpcCall(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
  });
  return response.json();
}

async function testRpc(rpcUrl) {
  console.log(`\n=== Testing: ${rpcUrl} ===`);
  try {
    // Test 1: Get chain ID
    const chainResult = await rpcCall(rpcUrl, 'starknet_chainId', []);
    if (chainResult.error) {
      console.log('✗ Chain ID failed:', chainResult.error.message);
      return false;
    }
    console.log('✓ Chain ID:', chainResult.result);
    
    // Test 2: Get nonce with 'pending'
    const nonceResult = await rpcCall(rpcUrl, 'starknet_getNonce', {
      contract_address: ADMIN_ADDRESS,
      block_id: 'pending'
    });
    if (nonceResult.error) {
      console.log('✗ Nonce (pending) failed:', nonceResult.error.message || JSON.stringify(nonceResult.error));
      
      // Try with 'latest'
      const nonceLatest = await rpcCall(rpcUrl, 'starknet_getNonce', {
        contract_address: ADMIN_ADDRESS,
        block_id: 'latest'
      });
      if (nonceLatest.error) {
        console.log('✗ Nonce (latest) failed:', nonceLatest.error.message || JSON.stringify(nonceLatest.error));
        return false;
      }
      console.log('✓ Nonce (latest):', nonceLatest.result);
      console.log('⚠ This RPC does NOT support pending - not suitable');
      return false;
    }
    console.log('✓ Nonce (pending):', nonceResult.result);
    console.log('>>> THIS RPC SUPPORTS PENDING! <<<');
    return true;
  } catch (error) {
    console.log('✗ RPC failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('Testing Starknet Sepolia RPC endpoints for pending support...\n');
  
  const working = [];
  for (const rpc of RPC_ENDPOINTS) {
    const works = await testRpc(rpc);
    if (works) working.push(rpc);
  }
  
  console.log('\n\n========================================');
  if (working.length > 0) {
    console.log('WORKING RPCs (support pending):');
    working.forEach(r => console.log('  ' + r));
  } else {
    console.log('NO RPC SUPPORTS PENDING!');
  }
}

main().catch(console.error);
