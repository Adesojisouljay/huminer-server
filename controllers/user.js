import User from "../models/User.js";
import Post from "../models/Post.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import axios from "axios";
import { createNotification } from "../helpers/index.js";

// Helper to check and maintain monthly verification subscription status
export const checkAndRefreshUserVerification = async (user) => {
  if (!user) return user;
  if (user.verified) {
    // If user has an expiration date and it has passed, revoke verification
    if (user.verificationExpiresAt && new Date(user.verificationExpiresAt) < new Date()) {
      user.verified = false;
      user.verificationExpiresAt = null;
      if (typeof user.save === "function") {
        await user.save();
      } else {
        await User.findByIdAndUpdate(user._id, { verified: false, verificationExpiresAt: null });
      }
    }
  }
  return user;
};

// Register a new user
export const registerUser = async (req, res) => {
  try {
    const { username, email, password, fullName } = req.body;
    console.log(req.body)

    const cleanUsername = username?.trim().toLowerCase();
    const cleanEmail = email?.trim().toLowerCase();

    // Check required fields
    if (!cleanUsername || !cleanEmail || !password) {
      return res.status(400).json({ message: "Username, email and password are required." });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { username: cleanUsername },
        { email: cleanEmail },
        { username: { $regex: new RegExp(`^${cleanUsername}$`, "i") } },
        { email: { $regex: new RegExp(`^${cleanEmail}$`, "i") } }
      ]
    });
    if (existingUser) {
      return res.status(400).json({ message: "Username or email already taken." });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const newUser = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      password: hashedPassword,
      fullName: fullName?.trim(),
    });

    // Respond without sending password
    const { password: _, ...userData } = newUser.toObject();
    res.status(201).json({ message: "User registered successfully", user: userData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;
    console.log("Login attempt received for:", emailOrUsername);

    if (!emailOrUsername || !password) {
      return res.status(400).json({ message: "Email/Username and password are required." });
    }

    const trimmedInput = emailOrUsername.trim();
    const lowerInput = trimmedInput.toLowerCase();

    // Find user by email or username (case-insensitive)
    const user = await User.findOne({
      $or: [
        { email: lowerInput },
        { username: lowerInput },
        { email: { $regex: new RegExp(`^${trimmedInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") } },
        { username: { $regex: new RegExp(`^${trimmedInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") } }
      ]
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials." });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials." });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Check and refresh verification subscription status
    await checkAndRefreshUserVerification(user);

    // Return user data without password
    const { password: _, ...userData } = user.toObject();

    res.status(200).json({
      message: "Login successful",
      user: userData,
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    let user = await User.findById(req.params.id).select("-password"); // exclude password
    if (!user) return res.status(404).json({ message: "User not found" });
    user = await checkAndRefreshUserVerification(user);
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getUserByUsername = async (req, res) => {
  try {
    const { username } = req.params;

    // Get the user by username + populate followers & following
    let user = await User.findOne({ username })
      .select("-password")
      .populate("followers", "username profilePicture verified")
      .populate("following", "username profilePicture verified");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user = await checkAndRefreshUserVerification(user);
    res.json({ success: true, user });

  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

export const updateUserProfile = async (req, res) => {
  try {
    const allowedFields = [
      "fullName",
      "bio",
      "profilePicture",
      "coverPhoto",
      "dateOfBirth",
      "gender",
      "settings"
    ];
    console.log("object")

    // Prevent users from updating restricted fields
    Object.keys(req.body).forEach((key) => {
      if (!allowedFields.includes(key)) {
        delete req.body[key];
      }
    });

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).select("-password");

    if (!updatedUser)
      return res.status(404).json({ message: "User not found" });

    res.json({
      message: "Profile updated successfully",
      user: updatedUser
    });

  } catch (error) {
    res.status(500).json({
      message: "Error updating profile",
      error: error.message
    });
  }
};

// 🟢 NEW: GET ALL USERS
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🟢 NEW: GET RANDOM USERS
export const getRandomUsers = async (req, res) => {
  console.log("limit")
  try {
    const limit = parseInt(req.query.limit) || 5; // Default 5 users
    console.log(limit)
    const randomUsers = await User.aggregate([
      { $sample: { size: limit } },
      { $project: { password: 0 } },
    ]);
    res.json(randomUsers);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const followUser = async (req, res) => {
  try {
    const { id } = req.user; // logged-in user
    const { userId } = req.params; // user to follow

    const userToFollow = await User.findById(userId);
    console.log("usertfoll.......", userToFollow, userId, id)
    const currentUser = await User.findById(id);

    if (id === userId) {
      return res.status(400).json({ message: "You cannot follow yourself" });
    }

    if (!userToFollow) return res.status(404).json({ message: "User not found" });

    if (!currentUser.following.includes(userId)) {
      currentUser.following.push(userId);
      currentUser.followingCount += 1;
      userToFollow.followers.push(id);
      userToFollow.followersCount += 1;

      await currentUser.save();
      await userToFollow.save();

      console.log("object...", {
        userId: userToFollow._id,
        type: "follow",
        fromUserId: currentUser._id,
        fromUsername: currentUser.username,
        message: `${currentUser.username} started following you`
      })

      createNotification({
        userId: userToFollow._id,
        type: "follow",
        fromUserId: currentUser._id,
        fromUsername: currentUser.username,
        fromProfilePicture: currentUser.profilePicture,
        message: `${currentUser.username} started following you`
      });

      // 📈 Attribution: if followed via a specific post, attribute follow to that post
      const sourcePostId = req.body?.postId;
      if (sourcePostId) {
        try {
          await Post.findByIdAndUpdate(sourcePostId, {
            $addToSet: { followsEarned: currentUser._id }
          });
        } catch (postAttrErr) {
          console.warn("Could not attribute follow to post:", postAttrErr.message);
        }
      }
    }

    const updatedUser = await User.findById(id).select("-password");
    res.status(200).json({ message: "Followed successfully", updatedUser });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const unfollowUser = async (req, res) => {
  try {
    const { id } = req.user;
    const { userId } = req.params;

    const userToUnfollow = await User.findById(userId);
    const currentUser = await User.findById(id);

    if (!userToUnfollow) return res.status(404).json({ message: "User not found" });

    if (currentUser.following.includes(userId)) {
      currentUser.following = currentUser.following.filter((uid) => uid.toString() !== userId);
      currentUser.followingCount -= 1;
      userToUnfollow.followers = userToUnfollow.followers.filter((uid) => uid.toString() !== id);
      userToUnfollow.followersCount -= 1;

      await currentUser.save();
      await userToUnfollow.save();

      console.log("object...", {
        userId: userToUnfollow._id,
        type: "unfollow",
        fromUserId: currentUser._id,
        fromUsername: currentUser.username,
        message: `${currentUser.username} unfollowed you`
      })

      createNotification({
        userId: userToUnfollow._id,
        type: "unfollow",
        fromUserId: currentUser._id,
        fromUsername: currentUser.username,
        fromProfilePicture: currentUser.profilePicture,
        message: `${currentUser.username} unfollowed you`
      });

    }

    const updatedUser = await User.findById(id).select("-password");
    res.status(200).json({ message: "Unfollowed successfully", updatedUser });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const claimRewards = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (user.pendingRewards <= 0) {
      return res.status(400).json({ message: "No rewards to claim" });
    }

    user.accountBalance += user.pendingRewards;
    user.pendingRewards = 0;

    await user.save();

    // Return full user object without password
    const userObj = user.toObject();
    delete userObj.password;

    return res.json({
      message: "Rewards claimed successfully",
      user: userObj
    });

  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// 🟢 NEW: ADD BANK ACCOUNT
export const addBankAccount = async (req, res) => {
  try {
    const { bankName, bankCode, accountNumber, accountName } = req.body;

    // Validate input
    if (!bankName || !accountNumber || !accountName) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    let recipientCode = "";
    if (bankCode) {
      try {
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        const recipientRes = await axios.post(
          "https://api.paystack.co/transferrecipient",
          {
            type: "nuban",
            name: accountName,
            account_number: accountNumber,
            bank_code: bankCode,
            currency: "NGN"
          },
          { headers: { Authorization: `Bearer ${secretKey}` } }
        );
        if (recipientRes.data?.status && recipientRes.data?.data?.recipient_code) {
          recipientCode = recipientRes.data.data.recipient_code;
        }
      } catch (err) {
        console.warn("Paystack recipient creation notice:", err.response?.data || err.message);
      }
    }

    // Add new bank account
    user.bankAccounts.push({
      bankName,
      bankCode: bankCode || "",
      accountNumber,
      accountName,
      recipientCode: recipientCode || "",
      isPrimary: user.bankAccounts.length === 0 // Make primary if it's the first one
    });

    await user.save();

    res.status(200).json({
      message: "Bank account added successfully",
      bankAccounts: user.bankAccounts
    });

  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// 🆕 DELETE BANK ACCOUNT
export const deleteBankAccount = async (req, res) => {
  try {
    const { bankId } = req.params;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Filter out the bank account to delete
    const initialLength = user.bankAccounts.length;
    user.bankAccounts = user.bankAccounts.filter(
      (account) => account._id.toString() !== bankId
    );

    if (user.bankAccounts.length === initialLength) {
      return res.status(404).json({ message: "Bank account not found" });
    }

    await user.save();

    res.status(200).json({
      message: "Bank account deleted successfully",
      bankAccounts: user.bankAccounts
    });

  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 🔵 VERIFICATION BADGE SUBSCRIPTION PLANS (WITH DISCOUNTS)
export const VERIFICATION_PLANS = {
  1: {
    months: 1,
    name: "1 Month",
    label: "Monthly Pass",
    fee: 1500,
    originalFee: 1500,
    discountPercent: 0,
    days: 30,
    badgeText: null
  },
  3: {
    months: 3,
    name: "3 Months",
    label: "Quarterly Pass",
    fee: 4050, // ₦1,350/mo (10% discount from ₦4,500)
    originalFee: 4500,
    discountPercent: 10,
    days: 90,
    badgeText: "Save 10%"
  },
  6: {
    months: 6,
    name: "6 Months",
    label: "Semi-Annual Pass",
    fee: 7200, // ₦1,200/mo (20% discount from ₦9,000)
    originalFee: 9000,
    discountPercent: 20,
    days: 180,
    badgeText: "Save 20%"
  },
  12: {
    months: 12,
    name: "1 Year",
    label: "Annual Pass",
    fee: 11700, // ₦975/mo (35% discount from ₦18,000)
    originalFee: 18000,
    discountPercent: 35,
    days: 365,
    badgeText: "Save 35% • Best Value"
  }
};

export const subscribeVerification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { paymentMethod = "balance", durationMonths = 1, callbackUrl } = req.body; // "balance" | "paystack"

    const selectedPlan = VERIFICATION_PLANS[Number(durationMonths)] || VERIFICATION_PLANS[1];
    const planFee = selectedPlan.fee;
    const planDays = selectedPlan.days;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Refresh existing status if expired
    await checkAndRefreshUserVerification(user);

    // Option A: Pay directly from Huminer in-app account balance
    if (paymentMethod === "balance") {
      if ((user.accountBalance || 0) < planFee) {
        return res.status(400).json({
          success: false,
          insufficientBalance: true,
          requiredAmount: planFee,
          balance: user.accountBalance || 0,
          message: `Insufficient balance. ${selectedPlan.name} subscription is ₦${planFee.toLocaleString()}. Please top up your wallet first or pay via Paystack.`
        });
      }

      // Deduct balance
      user.accountBalance -= planFee;

      // Extend expiration date by plan days from now (or from previous active expiration)
      const baseDate = user.verified && user.verificationExpiresAt && new Date(user.verificationExpiresAt) > new Date()
        ? new Date(user.verificationExpiresAt)
        : new Date();

      const newExpiry = new Date(baseDate.getTime() + planDays * 24 * 60 * 60 * 1000);
      user.verified = true;
      user.verificationExpiresAt = newExpiry;

      await user.save();

      // Return clean user object without password
      const userObj = user.toObject();
      delete userObj.password;

      return res.status(200).json({
        success: true,
        message: `Congratulations! Your account is verified for ${selectedPlan.name} until ${newExpiry.toLocaleDateString()}.`,
        user: userObj,
        verified: true,
        verificationExpiresAt: newExpiry,
        balance: user.accountBalance,
        plan: selectedPlan
      });
    }

    // Option B: Pay via Paystack gateway
    if (paymentMethod === "paystack") {
      const secretKey = process.env.PAYSTACK_SECRET_KEY;
      const reference = `VERIFY_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const userEmail = user.email || `${user.username}@huminer.com`;

      let authorizationUrl = null;
      let accessCode = null;

      if (secretKey) {
        try {
          const origin = req.get("origin") || req.get("referer");
          const safeCallback = callbackUrl || `${origin || "https://huminer.com"}/profile/${user.username}?verified_payment=true`;

          const paystackRes = await axios.post(
            "https://api.paystack.co/transaction/initialize",
            {
              email: userEmail,
              amount: planFee * 100, // in kobo
              reference,
              callback_url: safeCallback,
              metadata: {
                type: "verification_subscription",
                userId: user._id.toString(),
                username: user.username,
                durationMonths: selectedPlan.months,
                days: planDays,
                fee: planFee
              }
            },
            {
              headers: {
                Authorization: `Bearer ${secretKey}`,
                "Content-Type": "application/json"
              }
            }
          );

          if (paystackRes.data?.status && paystackRes.data?.data) {
            accessCode = paystackRes.data.data.access_code;
            authorizationUrl = paystackRes.data.data.authorization_url;
          }
        } catch (paystackErr) {
          console.error("Paystack verification init error:", paystackErr.response?.data || paystackErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        reference,
        accessCode,
        authorizationUrl,
        amount: planFee,
        plan: selectedPlan,
        email: userEmail,
        publicKey: process.env.PAYSTACK_PUBLIC_KEY
      });
    }

    return res.status(400).json({ success: false, message: "Invalid payment method" });
  } catch (error) {
    console.error("subscribeVerification error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to process verification subscription" });
  }
};

// 🔵 VERIFY PAYSTACK PAYMENT FOR VERIFICATION SUBSCRIPTION
export const verifyVerificationPayment = async (req, res) => {
  try {
    const { reference } = req.body;
    const userId = req.user.id;

    if (!reference) {
      return res.status(400).json({ success: false, message: "Transaction reference is required" });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${secretKey}` }
    });

    const data = response.data?.data;
    if (data?.status === "success") {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      const metadata = data?.metadata || {};
      const durationMonths = Number(metadata.durationMonths) || 1;
      const plan = VERIFICATION_PLANS[durationMonths] || VERIFICATION_PLANS[1];
      const planDays = metadata.days || plan.days;

      const baseDate = user.verified && user.verificationExpiresAt && new Date(user.verificationExpiresAt) > new Date()
        ? new Date(user.verificationExpiresAt)
        : new Date();

      const newExpiry = new Date(baseDate.getTime() + planDays * 24 * 60 * 60 * 1000);
      user.verified = true;
      user.verificationExpiresAt = newExpiry;
      await user.save();

      const userObj = user.toObject();
      delete userObj.password;

      return res.status(200).json({
        success: true,
        message: `Verification badge activated for ${plan.name} until ${newExpiry.toLocaleDateString()}!`,
        user: userObj,
        verified: true,
        verificationExpiresAt: newExpiry,
        plan
      });
    }

    return res.status(400).json({ success: false, message: "Payment was not successful on Paystack" });
  } catch (error) {
    console.error("verifyVerificationPayment error:", error);
    return res.status(500).json({ success: false, message: error.message || "Verification failed" });
  }
};

// 🚫 BLOCK USER
export const blockUser = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const targetUserId = req.params.userId;

    if (currentUserId.toString() === targetUserId.toString()) {
      return res.status(400).json({ success: false, message: "You cannot block yourself" });
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Add to blockedUsers and remove from followers/following mutually
    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { blockedUsers: targetUserId },
      $pull: { following: targetUserId, followers: targetUserId }
    });

    await User.findByIdAndUpdate(targetUserId, {
      $pull: { following: currentUserId, followers: currentUserId }
    });

    return res.status(200).json({
      success: true,
      message: `You have blocked @${targetUser.username}. They cannot message you or see your content.`
    });
  } catch (error) {
    console.error("blockUser error:", error);
    return res.status(500).json({ success: false, message: "Server error blocking user" });
  }
};

// 🟢 UNBLOCK USER
export const unblockUser = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const targetUserId = req.params.userId;

    await User.findByIdAndUpdate(currentUserId, {
      $pull: { blockedUsers: targetUserId }
    });

    return res.status(200).json({
      success: true,
      message: "User unblocked successfully"
    });
  } catch (error) {
    console.error("unblockUser error:", error);
    return res.status(500).json({ success: false, message: "Server error unblocking user" });
  }
};

// 📋 GET BLOCKED USERS LIST
export const getBlockedUsers = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate("blockedUsers", "username fullName profilePicture verified");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      blockedUsers: user.blockedUsers || []
    });
  } catch (error) {
    console.error("getBlockedUsers error:", error);
    return res.status(500).json({ success: false, message: "Server error fetching blocked users" });
  }
};

// 🛡️ SUBMIT UGC REPORT (App Store / Play Store compliance)
export const submitReport = async (req, res) => {
  try {
    const reporterId = req.user.id;
    const reporter = await User.findById(reporterId);
    const { targetType, targetId, targetUsername, reason, details } = req.body;

    if (!targetType || !targetId || !reason) {
      return res.status(400).json({
        success: false,
        message: "targetType, targetId, and reason are required"
      });
    }

    // Dynamic import to avoid circular dependency
    const Report = (await import("../models/Report.js")).default;

    const newReport = new Report({
      reporterId,
      reporterUsername: reporter?.username || "anonymous",
      targetType,
      targetId,
      targetUsername: targetUsername || null,
      reason,
      details: details ? details.trim() : ""
    });

    await newReport.save();

    return res.status(201).json({
      success: true,
      message: "Thank you for helping keep Huminer safe. Our trust & safety team will review this report within 24 hours."
    });
  } catch (error) {
    console.error("submitReport error:", error);
    return res.status(500).json({ success: false, message: "Server error submitting report" });
  }
};

// 📱 REGISTER PUSH DEVICE TOKEN (FCM / Web Push / Capacitor)
export const registerDeviceToken = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: "Token is required" });
    }

    await User.findByIdAndUpdate(userId, {
      $addToSet: { fcmTokens: token }
    });

    return res.status(200).json({
      success: true,
      message: "Device push token registered successfully"
    });
  } catch (error) {
    console.error("registerDeviceToken error:", error);
    return res.status(500).json({ success: false, message: "Server error registering token" });
  }
};

// ⚙️ UPDATE PUSH NOTIFICATION PREFERENCES
export const updatePushSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { enabled } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { "settings.pushNotifications": Boolean(enabled) } },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      pushNotifications: user?.settings?.pushNotifications ?? true
    });
  } catch (error) {
    console.error("updatePushSettings error:", error);
    return res.status(500).json({ success: false, message: "Server error updating push preferences" });
  }
};



