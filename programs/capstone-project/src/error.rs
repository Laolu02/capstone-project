use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Custom error message")]
    CustomError,
}

#[error_code]
pub enum EscrowError {
    #[msg("The deadline has not passed yet. Cannot refund.")]
    DeadlineNotPassed,

     #[msg("The deadline has expired. Cannot claim.")]
    DeadlineExpired,
    
    #[msg("Only the designated taker can claim this escrow.")]
    UnauthorizedTaker,
}