import StakeVault from "../models/StakeVault.js";
import User from "../models/User.js";
import { createNotification } from "../helpers/index.js";

/**
 * Get active user's stake vault details
 */
export const getMyStakeVault = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    let vault = await StakeVault.findOne({ user: userId });
    if (!vault) {
      vault = await StakeVault.create({
        user: userId,
        stakedAmountUSDT: 0,
        selfSharePercentage: 100,
        beneficiaries: []
      });
    }

    const staked = vault.stakedAmountUSDT || 0;
    // 10% APY divided monthly
    const monthlyTotalYieldUSDT = (staked * 0.10) / 12;
    const monthlyUserYieldUSDT = (monthlyTotalYieldUSDT * (vault.selfSharePercentage || 100)) / 100;

    // Monthly breakdown for beneficiaries
    const beneficiariesBreakdown = (vault.beneficiaries || []).map(b => ({
      userId: b.userId,
      username: b.username,
      percentage: b.percentage,
      monthlyPayoutUSDT: Number(((monthlyTotalYieldUSDT * b.percentage) / 100).toFixed(4))
    }));

    return res.status(200).json({
      success: true,
      vault: {
        ...vault.toObject(),
        monthlyTotalYieldUSDT: Number(monthlyTotalYieldUSDT.toFixed(4)),
        monthlyUserYieldUSDT: Number(monthlyUserYieldUSDT.toFixed(4)),
        beneficiariesBreakdown
      }
    });
  } catch (err) {
    console.error("getMyStakeVault error:", err);
    return res.status(500).json({ success: false, message: "Error fetching stake vault" });
  }
};

/**
 * Stake USDT into the vault
 */
export const stakeUSDT = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { amount } = req.body;

    const stakeAmount = Number(amount);
    if (!stakeAmount || stakeAmount <= 0) {
      return res.status(400).json({ success: false, message: "Please provide a valid USDT stake amount" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Ensure user has web3 wallet initialized
    if (!user.web3Wallets?.hasWallet) {
      return res.status(400).json({
        success: false,
        message: "Please initialize your Huminer Web3 wallet first to stake USDT"
      });
    }

    const currentUSDTBalance = user.web3Wallets.usdtBalance || 0;
    if (currentUSDTBalance < stakeAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient USDT balance. Available: ${currentUSDTBalance} USDT, Requested: ${stakeAmount} USDT`
      });
    }

    // Deduct USDT from user's web3 wallet
    user.web3Wallets.usdtBalance = Number((currentUSDTBalance - stakeAmount).toFixed(4));
    await user.save();

    // Update or create StakeVault
    let vault = await StakeVault.findOne({ user: userId });
    if (!vault) {
      vault = new StakeVault({
        user: userId,
        stakedAmountUSDT: stakeAmount,
        selfSharePercentage: 100,
        beneficiaries: [],
        status: "active"
      });
    } else {
      vault.stakedAmountUSDT += stakeAmount;
      vault.status = "active";
      vault.unstakeRequestedAt = null;
      vault.unstakeAvailableAt = null;
    }
    await vault.save();

    // Calculate metrics
    const monthlyTotalYieldUSDT = (vault.stakedAmountUSDT * 0.10) / 12;
    const monthlyUserYieldUSDT = (monthlyTotalYieldUSDT * (vault.selfSharePercentage || 100)) / 100;

    return res.status(200).json({
      success: true,
      message: `Successfully staked ${stakeAmount} USDT! Yield distributes monthly at 10% APY.`,
      usdtBalance: user.web3Wallets.usdtBalance,
      vault: {
        ...vault.toObject(),
        monthlyTotalYieldUSDT: Number(monthlyTotalYieldUSDT.toFixed(4)),
        monthlyUserYieldUSDT: Number(monthlyUserYieldUSDT.toFixed(4))
      }
    });
  } catch (err) {
    console.error("stakeUSDT error:", err);
    return res.status(500).json({ success: false, message: "Error staking USDT" });
  }
};

/**
 * Configure creator beneficiaries
 */
export const updateBeneficiaries = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { beneficiaries } = req.body;

    if (!Array.isArray(beneficiaries)) {
      return res.status(400).json({ success: false, message: "Beneficiaries must be an array" });
    }

    let totalAllocatedPercentage = 0;
    const cleanBeneficiaries = [];

    for (const b of beneficiaries) {
      const pct = Number(b.percentage);
      if (isNaN(pct) || pct <= 0) continue;

      totalAllocatedPercentage += pct;

      // Look up target creator by username or userId
      let creator = null;
      if (b.userId) {
        creator = await User.findById(b.userId);
      } else if (b.username) {
        const cleanName = b.username.replace("@", "").trim();
        creator = await User.findOne({ username: cleanName });
      }

      if (!creator) {
        return res.status(404).json({
          success: false,
          message: `Creator @${b.username || b.userId} not found on Huminer`
        });
      }

      if (creator._id.toString() === userId.toString()) {
        return res.status(400).json({
          success: false,
          message: "You cannot add yourself as a patronage beneficiary; your share is automatically retained"
        });
      }

      cleanBeneficiaries.push({
        userId: creator._id,
        username: creator.username,
        percentage: pct
      });
    }

    if (totalAllocatedPercentage > 100) {
      return res.status(400).json({
        success: false,
        message: `Total beneficiary allocations cannot exceed 100%. Current sum: ${totalAllocatedPercentage}%`
      });
    }

    const selfSharePercentage = 100 - totalAllocatedPercentage;

    let vault = await StakeVault.findOne({ user: userId });
    if (!vault) {
      vault = new StakeVault({
        user: userId,
        stakedAmountUSDT: 0,
        selfSharePercentage,
        beneficiaries: cleanBeneficiaries
      });
    } else {
      vault.beneficiaries = cleanBeneficiaries;
      vault.selfSharePercentage = selfSharePercentage;
    }

    await vault.save();

    // Notify newly assigned beneficiaries
    const sender = await User.findById(userId);
    for (const cb of cleanBeneficiaries) {
      await createNotification(
        cb.userId,
        userId,
        "vault_patronage",
        null,
        `🎉 ${sender?.username || "A patron"} designated you to receive ${cb.percentage}% of their monthly USDT staking yield!`
      );
    }

    const staked = vault.stakedAmountUSDT || 0;
    const monthlyTotalYieldUSDT = (staked * 0.10) / 12;

    const beneficiariesBreakdown = cleanBeneficiaries.map(b => ({
      userId: b.userId,
      username: b.username,
      percentage: b.percentage,
      monthlyPayoutUSDT: Number(((monthlyTotalYieldUSDT * b.percentage) / 100).toFixed(4))
    }));

    return res.status(200).json({
      success: true,
      message: "Beneficiaries successfully updated!",
      vault: {
        ...vault.toObject(),
        monthlyTotalYieldUSDT: Number(monthlyTotalYieldUSDT.toFixed(4)),
        monthlyUserYieldUSDT: Number(((monthlyTotalYieldUSDT * selfSharePercentage) / 100).toFixed(4)),
        beneficiariesBreakdown
      }
    });
  } catch (err) {
    console.error("updateBeneficiaries error:", err);
    return res.status(500).json({ success: false, message: "Error updating beneficiaries" });
  }
};

/**
 * Request unstake (3 days cooldown mirroring HBD protocol release)
 */
export const requestUnstake = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const vault = await StakeVault.findOne({ user: userId });
    if (!vault || vault.stakedAmountUSDT <= 0) {
      return res.status(400).json({ success: false, message: "No active USDT staked in vault" });
    }

    if (vault.status === "unstaking") {
      return res.status(400).json({
        success: false,
        message: `Unstaking already in progress. Funds release on ${new Date(vault.unstakeAvailableAt).toLocaleString()}`
      });
    }

    const now = new Date();
    // 3 days settlement time for HBD unstake lock
    const availableAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    vault.status = "unstaking";
    vault.unstakeRequestedAt = now;
    vault.unstakeAvailableAt = availableAt;
    await vault.save();

    return res.status(200).json({
      success: true,
      message: `Unstake initiated! Your ${vault.stakedAmountUSDT} USDT principal will be available for final claim in 3 days (${availableAt.toLocaleDateString()}).`,
      vault
    });
  } catch (err) {
    console.error("requestUnstake error:", err);
    return res.status(500).json({ success: false, message: "Error requesting unstake" });
  }
};

/**
 * Complete unstake and return principal to USDT balance
 */
export const completeUnstake = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const vault = await StakeVault.findOne({ user: userId });
    if (!vault || vault.status !== "unstaking" || vault.stakedAmountUSDT <= 0) {
      return res.status(400).json({ success: false, message: "No pending unstake to finalize" });
    }

    const now = new Date();
    if (now < new Date(vault.unstakeAvailableAt)) {
      const remainingHours = Math.ceil((new Date(vault.unstakeAvailableAt) - now) / (1000 * 60 * 60));
      return res.status(400).json({
        success: false,
        message: `Cooldown lock period active. Unstake completes in ~${remainingHours} hours.`
      });
    }

    const user = await User.findById(userId);
    const returnAmount = vault.stakedAmountUSDT;

    user.web3Wallets.usdtBalance = Number(((user.web3Wallets.usdtBalance || 0) + returnAmount).toFixed(4));
    await user.save();

    vault.stakedAmountUSDT = 0;
    vault.status = "active";
    vault.unstakeRequestedAt = null;
    vault.unstakeAvailableAt = null;
    await vault.save();

    return res.status(200).json({
      success: true,
      message: `Principal of ${returnAmount} USDT has been returned to your Huminer Web3 wallet!`,
      usdtBalance: user.web3Wallets.usdtBalance,
      vault
    });
  } catch (err) {
    console.error("completeUnstake error:", err);
    return res.status(500).json({ success: false, message: "Error completing unstake" });
  }
};
