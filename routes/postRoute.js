import express from "express";
import {
  createPost,
  getPosts,
  getPostById,
  deletePost,
  editPost,
  toggleArchivePost,
  getArchivedPosts,
  editComment,
  deleteComment,
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
  recordPostView,
  globalSearch,
  getExploreFeed,
  recordPostShare,
  recordProfileVisit,
  getPostInsights,
  getCreatorStudioAnalytics
} from "../controllers/post.js";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/inde.js";

const router = express.Router();

router.post("/", authMiddleware, createPost); // create
router.get("/creator-studio/analytics", authMiddleware, getCreatorStudioAnalytics); // 📈 Creator Studio performance & monetization
router.get("/", optionalAuthMiddleware, getPosts); // feed (all posts, with optional ?tag=)
router.get("/search", optionalAuthMiddleware, globalSearch); // 🔍 Global search (accounts, posts, tags)
router.get("/explore", optionalAuthMiddleware, getExploreFeed); // 🧭 Engagement-ranked explore feed
router.get("/tags/trending", getTrendingTags); // 🟢 NEW: Hashtag stats
router.get("/following", authMiddleware, getFollowingPosts); // 🟢 NEW: Following feed
router.get("/saved", authMiddleware, getSavedPosts); // 🔖 Saved posts for active user
router.get("/archived", authMiddleware, getArchivedPosts); // 📦 Archived posts for active user
router.get("/reblogged/:username", getRebloggedPosts); // 🔁 Reblogged posts for a user
router.get("/:id/insights", authMiddleware, getPostInsights); // 📊 Post-level metrics & completion drawer
router.post("/:id/share", recordPostShare); // 🔗 Record post share
router.post("/:id/profile-visit", recordProfileVisit); // 👤 Record profile visit originating from post
router.get("/:id", getPostById); // single post
router.put("/:id/view", recordPostView); // 👁️ Record view
router.put("/:id/like", authMiddleware, likePost); // 🟢 Like post
router.put("/:id/reblog", authMiddleware, reblogPost); // 🔁 Reblog/Reshare post
router.put("/:id/save", authMiddleware, savePost); // 🔖 Save/Bookmark post
router.put("/:id", authMiddleware, editPost); // ✏️ Edit post
router.put("/:id/archive", authMiddleware, toggleArchivePost); // 📦 Archive/Unarchive post
router.delete("/:id", authMiddleware, deletePost); // 🗑️ Delete post
router.get("/post/:username", getPostsByUsername);

router.post("/:postId/tip", authMiddleware, tipPost);
router.post("/:postId/comment", authMiddleware, addComment);
router.put("/:postId/comment/:commentId", authMiddleware, editComment); // ✏️ Edit comment
router.delete("/:postId/comment/:commentId", authMiddleware, deleteComment); // 🗑️ Delete comment
router.post("/:postId/comment/:commentId/tip", authMiddleware, tipComment);
router.get("/random/posts", getRandomPosts);

export default router;
