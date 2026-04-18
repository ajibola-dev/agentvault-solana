use anchor_lang::prelude::*;
use crate::state::{TaskEscrow, AgentProfile, TaskStatus};
use crate::error::ErrorCode;

pub fn handler(ctx: Context<CompleteTask>) -> Result<()> {
    let task = &mut ctx.accounts.task_escrow;
    require!(task.status == TaskStatus::InProgress, ErrorCode::InvalidTaskStatus);
    require!(task.client == ctx.accounts.client.key(), ErrorCode::Unauthorized);

    task.status = TaskStatus::Completed;

    let amount = task.amount;
    **task.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.agent_authority.try_borrow_mut_lamports()? += amount;

    let agent = &mut ctx.accounts.agent_profile;
    agent.tasks_completed += 1;
    if agent.reputation < 950 {
        agent.reputation += 10;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CompleteTask<'info> {
    #[account(
        mut,
        seeds = [b"task", client.key().as_ref(), agent_authority.key().as_ref()],
        bump = task_escrow.bump
    )]
    pub task_escrow: Account<'info, TaskEscrow>,
    #[account(
        mut,
        seeds = [b"agent", agent_authority.key().as_ref()],
        bump = agent_profile.bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,
    #[account(mut)]
    pub client: Signer<'info>,
    /// CHECK: agent receives payment
    #[account(mut)]
    pub agent_authority: UncheckedAccount<'info>,
}
