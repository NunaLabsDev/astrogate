#![no_std]

//! Sorobits (`SBIT`) — 100% On-Chain Native 32x32 Pixel-Art & Genomic NFT Contract.
//!
//! Built by NunaLabs for AstroGate on Stellar Soroban (SEP-50).
//! - Core traits: `NonFungibleToken` + `Enumerable` + `Burnable` + `Royalties` + `AccessControl`.
//! - Art engine: 256-bit `BytesN<32>` Genome, semantic slots `0..15` + `PaletteSwap`,
//!   stack `[u8; 1024]` Z-buffer, procedural cosmos sky, and per-color `<path>` SVG data URIs.
//! - Scalability: Immutable Season-1 Genesis templates + Curator-registered & sealed Season 2+ layers.

mod assets;
mod contract;
mod engine;

#[cfg(test)]
mod test;

pub use contract::{Sorobits, SorobitsClient};
