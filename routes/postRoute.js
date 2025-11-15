import express from "express";
import { createPost, getPosts, getPostById, deletePost, tipPost, tipComment, addComment, getRandomPosts, getPostsByUsername } from "../controllers/post.js";
import { authMiddleware } from "../middleware/inde.js";

const router = express.Router();

router.post("/", authMiddleware, createPost); // create
router.get("/", getPosts); // feed
router.get("/:id", getPostById); // single post
router.delete("/:id", authMiddleware, deletePost); // delete
router.get("/post/:username", getPostsByUsername);

router.post("/:postId/tip", authMiddleware, tipPost);
router.post("/:postId/comment", authMiddleware, addComment);
router.post("/:postId/comment/:commentId/tip", authMiddleware, tipComment);
router.get("/random/posts", getRandomPosts);

export default router;
