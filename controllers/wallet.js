import User from "../models/User.js";
import axios from "axios";

const WEB3_SERVICE_URL = process.env.WEB3_SERVICE_URL || "https://web3.ezabay.com/api";

/**
 * Save / Update Encrypted Vault & Multi-chain Addresses
 */
export const saveVault = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { encryptedVault, vaultSalt, addresses, usdtAddress, btcAddress } = req.body;

    if (!encryptedVault || !vaultSalt) {
      return res.status(400).json({
        success: false,
        message: "encryptedVault and vaultSalt are required",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Default primary addresses if not explicitly passed
    const resolvedUsdt =
      usdtAddress ||
      addresses?.USDT_TRC20 ||
      addresses?.USDT_BEP20 ||
      addresses?.USDT_ERC20 ||
      addresses?.TRON ||
      user.web3Wallets?.usdtAddress ||
      "";

    const resolvedBtc =
      btcAddress ||
      addresses?.BTC ||
      user.web3Wallets?.btcAddress ||
      "";

    user.web3Wallets = {
      hasWallet: true,
      encryptedVault,
      vaultSalt,
      addresses: addresses || {},
      usdtAddress: resolvedUsdt,
      usdtBalance: user.web3Wallets?.usdtBalance || 0,
      btcAddress: resolvedBtc,
      btcBalance: user.web3Wallets?.btcBalance || 0,
      createdAt: user.web3Wallets?.createdAt || new Date(),
      lastSyncedAt: new Date(),
    };

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Web3 vault securely synchronized",
      web3Wallets: user.web3Wallets,
    });
  } catch (error) {
    console.error("Save Vault Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save Web3 vault",
      error: error.message,
    });
  }
};

/**
 * Get Current User's Web3 Vault
 */
export const getVault = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(userId).select("web3Wallets");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      web3Wallets: user.web3Wallets || { hasWallet: false },
    });
  } catch (error) {
    console.error("Get Vault Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve Web3 vault",
      error: error.message,
    });
  }
};

/**
 * Sync / Cache Balances to Huminer User Model for In-App Staking & Tipping
 */
export const syncBalances = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { usdtBalance, btcBalance } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.web3Wallets) {
      user.web3Wallets = { hasWallet: false };
    }

    if (typeof usdtBalance === "number") {
      user.web3Wallets.usdtBalance = usdtBalance;
    }
    if (typeof btcBalance === "number") {
      user.web3Wallets.btcBalance = btcBalance;
    }

    user.web3Wallets.lastSyncedAt = new Date();
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Balances synced successfully",
      web3Wallets: user.web3Wallets,
    });
  } catch (error) {
    console.error("Sync Balances Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to sync balances",
      error: error.message,
    });
  }
};

/**
 * Get Public Creator Web3 Addresses for direct on-chain tipping/patronage
 */
export const getCreatorAddresses = async (req, res) => {
  try {
    const { identifier } = req.params; // username or userId
    if (!identifier) {
      return res.status(400).json({ success: false, message: "Identifier is required" });
    }

    let query = { username: identifier };
    if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
      query = { $or: [{ _id: identifier }, { username: identifier }] };
    }

    const user = await User.findOne(query).select("username fullName avatar web3Wallets");
    if (!user) {
      return res.status(404).json({ success: false, message: "Creator not found" });
    }

    return res.status(200).json({
      success: true,
      creator: {
        _id: user._id,
        username: user.username,
        fullName: user.fullName,
        avatar: user.avatar,
        hasWallet: !!user.web3Wallets?.hasWallet,
        addresses: user.web3Wallets?.addresses || {},
        usdtAddress: user.web3Wallets?.usdtAddress || "",
        btcAddress: user.web3Wallets?.btcAddress || "",
      },
    });
  } catch (error) {
    console.error("Get Creator Addresses Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get creator addresses",
      error: error.message,
    });
  }
};
