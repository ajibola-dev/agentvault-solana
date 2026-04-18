use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Agent profile already exists")]
    AgentAlreadyRegistered,
    #[msg("Agent is not active")]
    AgentNotActive,
    #[msg("Task is not in the correct state")]
    InvalidTaskStatus,
    #[msg("Only the client can perform this action")]
    Unauthorized,
    #[msg("Insufficient funds for escrow")]
    InsufficientFunds,
}
