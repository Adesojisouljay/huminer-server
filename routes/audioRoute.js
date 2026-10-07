import express from "express";
import {
  getAudioTracks,
  getAudioTrackById,
  createOrLinkAudioTrack
} from "../controllers/audio.js";
import { authMiddleware } from "../middleware/inde.js";

const router = express.Router();

router.get("/", getAudioTracks);
router.get("/:id", getAudioTrackById);
router.post("/", authMiddleware, createOrLinkAudioTrack);

export default router;
