import express from "express";
import {
  createSongLinkTree,
  getSongById,
  getAllSongs
} from "../controllers/songLinkTree.js";

const router = express.Router();

// POST: Generate and store a new song link tree
router.post("/", createSongLinkTree);

// GET: Fetch a specific song by ID (for your /song/:id frontend)
router.get("/:id", getSongById);

// GET: Fetch all songs (for admin/dashboard)
router.get("/", getAllSongs);

export default router;
