import express from "express";
import { authMiddleware } from "../middleware/inde.js";
import {
  registerUser,
  loginUser,
  getUserProfile,
  getUserByUsername,
  updateUserProfile,
  getAllUsers,
  getRandomUsers,
  followUser,
  unfollowUser,
  claimRewards,
  addBankAccount,
  deleteBankAccount,
  subscribeVerification,
  verifyVerificationPayment,
  blockUser,
  unblockUser,
  getBlockedUsers,
  submitReport,
  registerDeviceToken,
  updatePushSettings
} from "../controllers/user.js";

const router = express.Router();

// POST /api/users/register
router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/blocked/list", authMiddleware, getBlockedUsers); // 📋 Get current user's blocked users
router.post("/report", authMiddleware, submitReport); // 🛡️ UGC Report (Play Store / App Store compliant)
router.put("/block/:userId", authMiddleware, blockUser); // 🚫 Block user
router.put("/unblock/:userId", authMiddleware, unblockUser); // 🟢 Unblock user
router.post("/device-token", authMiddleware, registerDeviceToken); // 📱 Register mobile / web push token
router.put("/push-settings", authMiddleware, updatePushSettings); // ⚙️ Update push notification settings
router.get("/:id", getUserProfile);
router.get("/profile/:username", getUserByUsername);
router.put("/profile/:id", updateUserProfile);
router.get("/", getAllUsers); // GET /api/users → all users
router.get("/random/users", getRandomUsers); // GET /api/users/random?limit=5 → random users
router.put("/follow/:userId", authMiddleware, followUser);
router.put("/unfollow/:userId", authMiddleware, unfollowUser);
router.post("/claim-rewards", authMiddleware, claimRewards);
router.post("/add-bank", authMiddleware, addBankAccount);
router.delete("/delete-bank/:bankId", authMiddleware, deleteBankAccount);

// Monthly Verification Badge Subscription
router.post("/subscribe-verification", authMiddleware, subscribeVerification);
router.post("/verify-verification-payment", authMiddleware, verifyVerificationPayment);

export default router;
