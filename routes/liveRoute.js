import express from "express";
import {
  startLiveStream,
  getActiveLiveStreams,
  getLiveStream,
  endLiveStream,
  tipLiveHost,
  saveLiveReplay,
  getLiveReplays,
  getCreatorReplays,
} from "../controllers/live.js";
import { authMiddleware } from "../middleware/inde.js";

const router = express.Router();

router.post("/start", authMiddleware, startLiveStream);
router.get("/active", getActiveLiveStreams);
router.get("/replays", getLiveReplays);
router.get("/replays/:username", getCreatorReplays);
router.get("/:roomId", getLiveStream);
router.post("/:roomId/end", authMiddleware, endLiveStream);
router.post("/:roomId/tip", authMiddleware, tipLiveHost);
router.post("/:roomId/replay", authMiddleware, saveLiveReplay);

export default router;
