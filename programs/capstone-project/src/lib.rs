use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod error;


pub use instructions::*;
pub use state::*;
pub use error::*;

declare_id!("DDhS2NgF4LgrJsimWUHiSRoqCxcJpBB7yFkKracNDAgA");

#[program]
pub mod capstone_project {
    use super::*;

    pub fn make(ctx: Context<Make>, seed:u64, deposit:u64, recieve:u64, deadline:i64) -> Result<()> {
        ctx.accounts.init_escrow(seed, recieve, &ctx.bumps, deadline)?;
        ctx.accounts.deposit(deposit)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        ctx.accounts.refund_and_close()
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.deposit()?;
        ctx.accounts.withdraw_and_close()
    }
}