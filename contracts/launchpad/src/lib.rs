#![no_std]

//! AstroGate Fair-Flywheel Launchpad Contract (v4.1).
//!
//! Provides a complete anti-whale, zero-cliff launchpad lifecycle on Stellar Soroban:
//! 1. Fixed 10M token supply (7 decimals): 45% Virtual Curve (4.5M), 25% Soroswap DEX
//!    Graduation Reserve (2.5M), 29.7% Milestone Proof-of-Burn Vault (2.97M), and
//!    0.3% Creator 15-day Post-Graduation Vesting (30K).
//! 2. Calibrated Virtual LP (1,250 vXLM -> 1,000 real XLM goal, 3.24x curve range) with
//!    progressive anti-whale fee-to-floor surcharges and zero pre-graduation creator dumps.
//! 3. Atomic Soroswap graduation at 1,000 XLM net curve raise (0.00% base price cliff,
//!    100% LP burned to `GAAAA...WHF`, Milestone 1 burns 1.485M tokens via `token.burn`).
//! 4. Permissionless Milestone 2 burn (remaining 1.485M when Soroswap pool reaches
//!    1,800 XLM) and 3-tier Burn-to-Chat (`50 / 500 / 5,000+` King Shout).

mod contract;
#[cfg(test)]
mod test;
