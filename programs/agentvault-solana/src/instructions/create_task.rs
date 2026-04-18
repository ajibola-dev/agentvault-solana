use anchor_lang::prelude::*;
use crate::state::{TaskEscrow, TaskStatus};

pub fn handler(ctx: Context<CreateTask>, amount: u64) -> Result<()> {
    let task = &mut ctx.accounts.task_escrow;
    task.client = ctx.accounts.client.key();
    task.agent = ctx.accounts.agent_authority.key();
    task.amount = amount;
    task.status = TaskStatus::InProgress;
    task.bump = ctx.bumps.task_escrow;

    let ix = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.client.key(),
        &ctx.accounts.task_escrow.key(),
        amount,
    );
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.client.to_account_info(),
            ctx.accounts.task_escrow.to_account_info(),
        ],
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct CreateTask<'info> {
    #[account(
        init,
        payer = client,
        space = TaskEscrow::LEN,
        seeds = [b"task", client.key().as_ref(), agent_authority.key().as_ref()],
        bump
    )]
    pub task_escrow: Account<'info, TaskEscrow>,
    #[account(mut)]
    pub client: Signer<'info>,
    /// CHECK: agent wallet address, only used as seed and payment target
    pub agent_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
