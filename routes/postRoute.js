import express from "express";
import {
  createPost,
  getPosts,
  getPostById,
  deletePost,
  tipPost,
  tipComment,
  addComment,
  getRandomPosts,
  getPostsByUsername,
  getFollowingPosts,
  likePost,
  getTrendingTags,
  reblogPost,
  savePost,
  getRebloggedPosts,
  getSavedPosts,
  recordPostView
} from "../controllers/post.js";
import { authMiddleware } from "../middleware/inde.js";

const router = express.Router();

router.post("/", authMiddleware, createPost); // create
router.get("/", getPosts); // feed (all posts, with optional ?tag=)
router.get("/tags/trending", getTrendingTags); // 🟢 NEW: Hashtag stats
router.get("/following", authMiddleware, getFollowingPosts); // 🟢 NEW: Following feed
router.get("/saved", authMiddleware, getSavedPosts); // 🔖 Saved posts for active user
router.get("/reblogged/:username", getRebloggedPosts); // 🔁 Reblogged posts for a user
router.get("/:id", getPostById); // single post
router.put("/:id/view", recordPostView); // 👁️ Record view
router.put("/:id/like", authMiddleware, likePost); // 🟢 Like post
router.put("/:id/reblog", authMiddleware, reblogPost); // 🔁 Reblog/Reshare post
router.put("/:id/save", authMiddleware, savePost); // 🔖 Save/Bookmark post
router.delete("/:id", authMiddleware, deletePost); // delete
router.get("/post/:username", getPostsByUsername);

router.post("/:postId/tip", authMiddleware, tipPost);
router.post("/:postId/comment", authMiddleware, addComment);
router.post("/:postId/comment/:commentId/tip", authMiddleware, tipComment);
router.get("/random/posts", getRandomPosts);

export default router;
