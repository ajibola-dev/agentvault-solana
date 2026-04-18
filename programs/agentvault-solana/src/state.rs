use anchor_lang::prelude::*;

#[account]
pub struct AgentProfile {
    pub authority: Pubkey,      // wallet that owns this agent
    pub reputation: u64,        // score out of 1000
    pub tasks_completed: u64,
    pub tasks_disputed: u64,
    pub is_active: bool,
    pub bump: u8,
}

impl AgentProfile {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct TaskEscrow {
    pub client: Pubkey,         // who posted the task
    pub agent: Pubkey,          // who is assigned
    pub amount: u64,            // USDC locked (in lamports for devnet)
    pub status: TaskStatus,
    pub bump: u8,
}

impl TaskEscrow {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum TaskStatus {
    Open,
    InProgress,
    Completed,
    Disputed,
    Cancelled,
}
