import express from "express";
import {
  createStory,
  getActiveStories,
  markStoryAsViewed,
  deleteStory,
} from "../controllers/story.js";
import { authMiddleware } from "../middleware/inde.js";

const router = express.Router();

router.post("/", authMiddleware, createStory);
router.get("/", getActiveStories);
router.put("/:id/view", authMiddleware, markStoryAsViewed);
router.delete("/:id", authMiddleware, deleteStory);

export default router;
