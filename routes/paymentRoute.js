import express from "express";
import { authMiddleware as verifyToken } from "../middleware/inde.js";
import {
  initializeDeposit,
  verifyDeposit,
  requestWithdrawal,
  getUserTransactions,
  getBanks,
  resolveAccount,
  handlePaystackWebhook,
  handleWalletCallback
} from "../controllers/payment.js";

const router = express.Router();

router.get("/banks", verifyToken, getBanks);
router.get("/resolve-account", verifyToken, resolveAccount);
router.post("/deposit/initialize", verifyToken, initializeDeposit);
router.post("/deposit/verify", verifyToken, verifyDeposit);
router.post("/withdraw", verifyToken, requestWithdrawal);
router.post("/webhook", handlePaystackWebhook);
router.get("/my-transactions", verifyToken, getUserTransactions);
router.get("/wallet", handleWalletCallback);

export default router;
