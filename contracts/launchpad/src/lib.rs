#![no_std]

//! AstroGate Fair-Flywheel Launchpad Contract (v4.4).
//!
//! Provides a complete anti-whale, zero-cliff launchpad lifecycle on Stellar Soroban:
//! 1. Fixed 10M token supply (7 decimals): 66% Virtual Curve (6.6M), 33% Soroswap DEX
//!    Graduation Reserve (3.3M), 0.30% Creator 15-day Post-Graduation Vesting (30K),
//!    0.40% 3-Checkpoint Jackpots (40K: +5K Spark, +10K Crown, +25K Graduation escrowed
//!    until graduation), and 0.30% Developer / Protocol Ecosystem Allocation (30K).
//! 2. Calibrated Virtual LP (1,000 vXLM -> 1,000 real XLM goal, 4.00x curve range) with
//!    softened 3-stage buy fees (0.30% / 0.50% / 0.25%), asymmetric curve sells
//!    (1.20% / 1.80% / 1.50%), and creator initial seed lock until graduation (+7d fallback).
//! 3. Atomic Soroswap graduation at 1,000 XLM net curve raise (0.00% base price cliff,
//!    100% LP time-locked inside Launchpad contract for 7 years via `reclaim_expired_lp`).
//! 4. Organic deflation only (zero artificial idle burn vault): anti-MEV chunked
//!    DEX Buyback-and-Burn (0.50% reserve cap + 250 XLM ceiling + slippage check) and
//!    3-tier Burn-to-Chat (`50 / 500 / 5,000+` King Shout scaled by token decimals).
//! 5. Institutional governance: 48-hour upgrade timelock (`schedule_upgrade` /
//!    `cancel_upgrade` / `execute_upgrade`) and 2-step admin rotation.

mod contract;
#[cfg(test)]
mod test;
