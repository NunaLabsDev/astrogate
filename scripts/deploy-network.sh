#!/usr/bin/env bash
set -euo pipefail

# Deterministic build & deploy helper for AstroGate contracts (Testnet or Mainnet).
# Usage:
#   STELLAR_SECRET=S... ./scripts/deploy-network.sh testnet
#   STELLAR_SECRET=S... SOROSWAP_FACTORY=C... SOROSWAP_ROUTER=C... DEVELOPER_TREASURY_ADDRESS=G... ./scripts/deploy-network.sh mainnet

NETWORK="${1:-testnet}"
if [[ "${NETWORK}" != "testnet" && "${NETWORK}" != "mainnet" ]]; then
  echo "Usage: $0 <testnet|mainnet>"
  exit 1
fi

if [[ -z "${STELLAR_SECRET:-}" ]]; then
  echo "ERROR: STELLAR_SECRET must be set in environment."
  exit 1
fi

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ "${NETWORK}" == "testnet" ]]; then
  RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
  PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
  SOROSWAP_FACTORY="${SOROSWAP_FACTORY:-CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY}"
  SOROSWAP_ROUTER="${SOROSWAP_ROUTER:-CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD}"
  XLM_SAC="${XLM_SAC:-CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC}"
  TREASURY="${DEVELOPER_TREASURY_ADDRESS:-GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE}"
else
  RPC_URL="${STELLAR_RPC_URL:-https://soroban-rpc.mainnet.stellar.org}"
  PASSPHRASE="${NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"
  XLM_SAC="${XLM_SAC:-CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA}"
  : "${SOROSWAP_FACTORY:?ERROR: SOROSWAP_FACTORY is required on mainnet}"
  : "${SOROSWAP_ROUTER:?ERROR: SOROSWAP_ROUTER is required on mainnet}"
  : "${DEVELOPER_TREASURY_ADDRESS:?ERROR: DEVELOPER_TREASURY_ADDRESS is required on mainnet}"
  TREASURY="${DEVELOPER_TREASURY_ADDRESS}"
fi

BURN_ADDRESS="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

echo "==> Building verified release WASMs (${NETWORK})"
stellar contract build --package astro-token
stellar contract build --package astro-launchpad-contract
stellar contract build --package astro-sorobits-contract

TOKEN_WASM="target/wasm32v1-none/release/astro_token.wasm"
LAUNCHPAD_WASM="target/wasm32v1-none/release/astro_launchpad_contract.wasm"
SOROBITS_WASM="target/wasm32v1-none/release/astro_sorobits_contract.wasm"

sha256_files() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

echo "==> SHA-256 WASM Checksums:"
sha256_files "${TOKEN_WASM}" "${LAUNCHPAD_WASM}" "${SOROBITS_WASM}"

echo "==> Uploading astro-token WASM to ${NETWORK}..."
TOKEN_WASM_HASH="$(STELLAR_ACCOUNT="${STELLAR_SECRET}" stellar contract upload --wasm "${TOKEN_WASM}" --rpc-url "${RPC_URL}" --network-passphrase "${PASSPHRASE}" | tail -n 1 | tr -d '[:space:]')"
if [[ ! "${TOKEN_WASM_HASH}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "ERROR: Invalid TOKEN_WASM_HASH extracted: '${TOKEN_WASM_HASH}'"
  exit 1
fi
echo "TOKEN_WASM_HASH=${TOKEN_WASM_HASH}"

echo "==> Deploying astro-launchpad-contract to ${NETWORK}..."
LAUNCHPAD_ID="$(STELLAR_ACCOUNT="${STELLAR_SECRET}" stellar contract deploy --wasm "${LAUNCHPAD_WASM}" --rpc-url "${RPC_URL}" --network-passphrase "${PASSPHRASE}" -- \
  --factory "${SOROSWAP_FACTORY}" \
  --xlm_sac "${XLM_SAC}" \
  --token_wasm_hash "${TOKEN_WASM_HASH}" \
  --burn_address "${BURN_ADDRESS}" \
  --treasury "${TREASURY}" | tail -n 1 | tr -d '[:space:]')"
if [[ ! "${LAUNCHPAD_ID}" =~ ^C[A-Z2-7]{55}$ ]]; then
  echo "ERROR: Invalid LAUNCHPAD_CONTRACT_ID extracted: '${LAUNCHPAD_ID}'"
  exit 1
fi
echo "LAUNCHPAD_CONTRACT_ID=${LAUNCHPAD_ID}"

echo "==> Deploying astro-sorobits-contract to ${NETWORK}..."
SOROBITS_ID="$(STELLAR_ACCOUNT="${STELLAR_SECRET}" stellar contract deploy --wasm "${SOROBITS_WASM}" --rpc-url "${RPC_URL}" --network-passphrase "${PASSPHRASE}" -- \
  --admin "${TREASURY}" \
  --royalty_receiver "${TREASURY}" \
  --royalty_bps 500 \
  --genesis_cap_per_archetype 1000 | tail -n 1 | tr -d '[:space:]')"
if [[ ! "${SOROBITS_ID}" =~ ^C[A-Z2-7]{55}$ ]]; then
  echo "ERROR: Invalid SOROBITS_CONTRACT_ID extracted: '${SOROBITS_ID}'"
  exit 1
fi
echo "SOROBITS_CONTRACT_ID=${SOROBITS_ID}"

if [[ -n "${ADMIN_SECRET:-}" ]]; then
  echo "==> Wiring Sorobits (${SOROBITS_ID}) to Launchpad (${LAUNCHPAD_ID}) & XLM SAC (${XLM_SAC})..."
  STELLAR_ACCOUNT="${ADMIN_SECRET}" stellar contract invoke --id "${SOROBITS_ID}" --rpc-url "${RPC_URL}" --network-passphrase "${PASSPHRASE}" -- set_launchpad --launchpad "${LAUNCHPAD_ID}" >/dev/null
  STELLAR_ACCOUNT="${ADMIN_SECRET}" stellar contract invoke --id "${SOROBITS_ID}" --rpc-url "${RPC_URL}" --network-passphrase "${PASSPHRASE}" -- set_xlm_sac --xlm_sac "${XLM_SAC}" >/dev/null
  STELLAR_ACCOUNT="${ADMIN_SECRET}" stellar contract invoke --id "${SOROBITS_ID}" --rpc-url "${RPC_URL}" --network-passphrase "${PASSPHRASE}" -- set_treasury --treasury "${TREASURY}" >/dev/null
fi

cat <<EOF

==> Deployment complete (${NETWORK})! Set these environment variables for zero-friction switching:
STELLAR_NETWORK=${NETWORK}
VITE_STELLAR_NETWORK=${NETWORK}
VITE_SOROSWAP_FACTORY=${SOROSWAP_FACTORY}
VITE_SOROSWAP_ROUTER=${SOROSWAP_ROUTER}
VITE_XLM_SAC=${XLM_SAC}
VITE_DEVELOPER_TREASURY_ADDRESS=${TREASURY}
VITE_LAUNCHPAD_CONTRACT_ID=${LAUNCHPAD_ID}
VITE_ASTRO_WASM_HASH=${TOKEN_WASM_HASH}
VITE_SOROBITS_CONTRACT_ID=${SOROBITS_ID}
EOF
