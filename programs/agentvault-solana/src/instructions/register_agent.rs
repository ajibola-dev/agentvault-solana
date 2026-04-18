use anchor_lang::prelude::*;
use crate::state::AgentProfile;

pub fn handler(ctx: Context<RegisterAgent>) -> Result<()> {
    let agent = &mut ctx.accounts.agent_profile;
    agent.authority = ctx.accounts.authority.key();
    agent.reputation = 500;  // start at 500/1000
    agent.tasks_completed = 0;
    agent.tasks_disputed = 0;
    agent.is_active = true;
    agent.bump = ctx.bumps.agent_profile;
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = authority,
        space = AgentProfile::LEN,
        seeds = [b"agent", authority.key().as_ref()],
        bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
