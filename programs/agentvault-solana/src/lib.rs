pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
pub use instructions::*;

declare_id!("7gURzVbrmtzJ8QoC9sC584fw9nkyahuUdFDmPnnCD6dB");

#[program]
pub mod agentvault_solana {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn register_agent(ctx: Context<RegisterAgent>) -> Result<()> {
        register_agent::handler(ctx)
    }

    pub fn create_task(ctx: Context<CreateTask>, amount: u64) -> Result<()> {
        create_task::handler(ctx, amount)
    }

    pub fn complete_task(ctx: Context<CompleteTask>) -> Result<()> {
        complete_task::handler(ctx)
    }
}
