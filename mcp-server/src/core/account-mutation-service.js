import {
  BorrowCapacityExceededError,
  ConflictError,
  InsufficientLiquidityError
} from "./errors.js";

export class AccountMutationService {
  constructor(accounts, blockchainGateway = undefined, getAccountSummary) {
    this.accounts = accounts;
    this.blockchainGateway = blockchainGateway;
    this.getAccountSummary = getAccountSummary;
  }

  async reserveForJob(wallet, asset, amount) {
    if (this.blockchainGateway?.isEnabled()) {
      return this.blockchainGateway.reserveForJob(wallet, asset, amount);
    }

    const account = await this.getAccountSummary(wallet);
    const liquid = account.liquid[asset] ?? 0;
    if (liquid < amount) {
      throw new InsufficientLiquidityError(asset);
    }

    account.liquid[asset] = liquid - amount;
    account.reserved[asset] = (account.reserved[asset] ?? 0) + amount;
    this.accounts.set(wallet, account);
    return account;
  }

  async lockJobStake(wallet, asset, amount, posterWallet = undefined) {
    if (this.blockchainGateway?.isEnabled()) {
      return this.getAccountSummary(wallet);
    }

    if (amount <= 0) {
      return this.getAccountSummary(wallet);
    }

    const account = await this.getAccountSummary(wallet);
    const liquid = account.liquid[asset] ?? 0;
    if (liquid < amount) {
      throw new InsufficientLiquidityError(asset, {
        wallet,
        required: amount,
        available: liquid,
        posterWallet
      });
    }

    account.liquid[asset] = liquid - amount;
    account.jobStakeLocked[asset] = (account.jobStakeLocked[asset] ?? 0) + amount;
    this.accounts.set(wallet, account);
    return account;
  }

  async releaseJobStake(wallet, asset, amount) {
    if (this.blockchainGateway?.isEnabled()) {
      return this.getAccountSummary(wallet);
    }

    if (amount <= 0) {
      return this.getAccountSummary(wallet);
    }

    const account = await this.getAccountSummary(wallet);
    const locked = account.jobStakeLocked[asset] ?? 0;
    if (locked < amount) {
      throw new ConflictError(`Release amount exceeds locked stake for ${asset}`, "stake_release_exceeds_locked");
    }

    account.jobStakeLocked[asset] = locked - amount;
    account.liquid[asset] = (account.liquid[asset] ?? 0) + amount;
    this.accounts.set(wallet, account);
    return account;
  }

  async slashJobStake(wallet, asset, amount) {
    if (this.blockchainGateway?.isEnabled()) {
      return this.getAccountSummary(wallet);
    }

    if (amount <= 0) {
      return this.getAccountSummary(wallet);
    }

    const account = await this.getAccountSummary(wallet);
    const locked = account.jobStakeLocked[asset] ?? 0;
    if (locked < amount) {
      throw new ConflictError(`Slash amount exceeds locked stake for ${asset}`, "stake_slash_exceeds_locked");
    }

    account.jobStakeLocked[asset] = locked - amount;
    this.accounts.set(wallet, account);
    return account;
  }

  async allocateIdleFunds(wallet, asset, amount, strategyId = "default-low-risk") {
    if (this.blockchainGateway?.isEnabled()) {
      return this.blockchainGateway.allocateIdleFunds(wallet, strategyId, amount);
    }

    const account = await this.getAccountSummary(wallet);
    const liquid = account.liquid[asset] ?? 0;
    if (liquid < amount) {
      throw new InsufficientLiquidityError(asset);
    }

    account.liquid[asset] = liquid - amount;
    account.strategyAllocated[asset] = (account.strategyAllocated[asset] ?? 0) + amount;
    this.accounts.set(wallet, account);
    return account;
  }

  async getBorrowCapacity(wallet, asset) {
    if (this.blockchainGateway?.isEnabled()) {
      return this.blockchainGateway.getBorrowCapacity(wallet, asset);
    }

    const account = await this.getAccountSummary(wallet);
    const collateral = account.collateralLocked[asset] ?? 0;
    const debt = account.debtOutstanding[asset] ?? 0;
    return Math.max((collateral / 1.5) - debt, 0);
  }

  async borrow(wallet, asset, amount) {
    const capacity = await this.getBorrowCapacity(wallet, asset);
    if (capacity < amount) {
      throw new BorrowCapacityExceededError(asset);
    }

    if (this.blockchainGateway?.isEnabled()) {
      await this.blockchainGateway.borrow(asset, amount);
      return this.getAccountSummary(wallet);
    }

    const account = await this.getAccountSummary(wallet);
    account.liquid[asset] = (account.liquid[asset] ?? 0) + amount;
    account.debtOutstanding[asset] = (account.debtOutstanding[asset] ?? 0) + amount;
    this.accounts.set(wallet, account);
    return account;
  }

  async repay(wallet, asset, amount) {
    if (this.blockchainGateway?.isEnabled()) {
      await this.blockchainGateway.repay(asset, amount);
      return this.getAccountSummary(wallet);
    }

    const account = await this.getAccountSummary(wallet);
    const outstanding = account.debtOutstanding[asset] ?? 0;
    if (outstanding < amount) {
      throw new ConflictError(`Repay amount exceeds debt for ${asset}`, "repay_amount_exceeds_debt");
    }

    account.debtOutstanding[asset] = outstanding - amount;
    account.liquid[asset] = Math.max((account.liquid[asset] ?? 0) - amount, 0);
    this.accounts.set(wallet, account);
    return account;
  }
}
