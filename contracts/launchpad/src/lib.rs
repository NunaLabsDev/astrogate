#![no_std]

//! AstroGate Fair-Flywheel Launchpad Contract (v4.3).
//!
//! Provides a complete anti-whale, zero-cliff launchpad lifecycle on Stellar Soroban:
//! 1. Fixed 10M token supply (7 decimals): 66% Virtual Curve (6.6M), 33% Soroswap DEX
//!    Graduation Reserve (3.3M), 0.3% Creator 15-day Post-Graduation Vesting (30K), and
//!    0.7% Developer / Protocol Ecosystem Allocation (70K released at graduation).
//! 2. Calibrated Virtual LP (1,000 vXLM -> 1,000 real XLM goal, 4.00x curve range) with
//!    flat 0.80% curve buys, asymmetric anti-sniper curve sells (2.50% -> 1.50%), and
//!    creator initial seed lock until graduation (+7d fallback).
//! 3. Atomic Soroswap graduation at 1,000 XLM net curve raise (0.00% base price cliff,
//!    100% LP time-locked inside Launchpad contract for 7 years via `reclaim_expired_lp`).
//! 4. Organic deflation only (zero artificial idle burn vault): anti-MEV chunked
//!    DEX Buyback-and-Burn and 3-tier Burn-to-Chat (`50 / 500 / 5,000+` King Shout).

mod contract;
#[cfg(test)]
mod test;
