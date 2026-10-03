import express from "express";
import { authMiddleware } from "../middleware/inde.js";
import {
  saveVault,
  getVault,
  syncBalances,
  getCreatorAddresses,
} from "../controllers/wallet.js";

const router = express.Router();

// Authenticated vault management
router.post("/save-vault", authMiddleware, saveVault);
router.get("/vault", authMiddleware, getVault);
router.post("/sync-balances", authMiddleware, syncBalances);

// Public creator address resolution
router.get("/creator/:identifier", getCreatorAddresses);

export default router;
