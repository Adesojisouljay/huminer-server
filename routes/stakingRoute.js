import express from "express";
import { authMiddleware as verifyToken } from "../middleware/inde.js";
import {
  getMyStakeVault,
  stakeUSDT,
  updateBeneficiaries,
  requestUnstake,
  completeUnstake
} from "../controllers/staking.js";

const router = express.Router();

router.get("/my-vault", verifyToken, getMyStakeVault);
router.post("/stake", verifyToken, stakeUSDT);
router.post("/beneficiaries", verifyToken, updateBeneficiaries);
router.post("/unstake/request", verifyToken, requestUnstake);
router.post("/unstake/complete", verifyToken, completeUnstake);

export default router;
