use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked, transfer_checked, CloseAccount, close_account}};


use crate::{Escrow, EscrowError};

#[derive(Accounts)]

pub struct Take<'info>{
    #[account(mut)]
    pub taker: Signer<'info>,
    #[account(mut)]
    pub maker: SystemAccount<'info>,
    #[account(
        mut,
        mint::token_program = token_program
    )]
    pub mint_a: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        mint::token_program = token_program
    )]
    pub mint_b: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_a,
        associated_token::token_program = token_program,
        associated_token::authority = taker,
    )]
    pub taker_ata_a: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = taker,
        associated_token::token_program = token_program,
    )]
    pub taker_ata_b: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_b,
        associated_token::authority = maker,
        associated_token::token_program= token_program,
    )]
    pub maker_ata_b: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::token_program= token_program,
        associated_token::authority = escrow,

    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut, 
        close= maker,
        has_one = maker,
        has_one = mint_a,
        has_one = mint_b,
        seeds= [b"escrow", maker.key().as_ref(), escrow.seed.to_le_bytes().as_ref()],
        bump= escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl <'info> Take<'info> {
    pub fn deposit(&mut self) -> Result<()> {
        
        let clock = Clock::get()?;
        require!(clock.unix_timestamp <= self.escrow.deadline, EscrowError::DeadlineExpired);

        let transfer_account = TransferChecked {
            from: self.taker_ata_b.to_account_info(),
            to: self.maker_ata_b.to_account_info(),
            mint: self.mint_b.to_account_info(),
            authority: self.taker.to_account_info(),
        };

        let cpictx = CpiContext::new(self.token_program.to_account_info(), transfer_account);
        transfer_checked(cpictx, self.escrow.recieve, self.mint_b.decimals)?;
        Ok(())
    }

    pub fn withdraw_and_close(&mut self) -> Result<()> {
        let signer_seed: [&[&[u8]]; 1]= [&[b"escrow",
            self.maker.to_account_info().key.as_ref(),
            &self.escrow.seed.to_le_bytes()[..],
            &[self.escrow.bump]
        ]];

        let accounts = TransferChecked {
            from: self.vault.to_account_info(),
            to: self.taker_ata_a.to_account_info(),
            mint: self.mint_a.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        let cpictx = CpiContext::new_with_signer(self.token_program.to_account_info(), accounts, &signer_seed);

        transfer_checked(cpictx, self.vault.amount, self.mint_a.decimals)?;

        let accounts = CloseAccount{
            account: self.vault.to_account_info(),
            destination: self.taker.to_account_info(),
            authority: self.escrow.to_account_info(),
        };

        let cpictx= CpiContext::new_with_signer(self.token_program.to_account_info(), accounts, &signer_seed);

        close_account(cpictx)
    }
}
