import express from "express";
import { authMiddleware } from "../middleware/inde.js";
import { registerUser, loginUser, getUserProfile,getUserByUsername, updateUserProfile, getAllUsers, getRandomUsers, followUser, unfollowUser } from "../controllers/user.js";

const router = express.Router();

// POST /api/users/register
router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/:id", getUserProfile);
router.get("/profile/:username", getUserByUsername);
router.put("/profile/:id", updateUserProfile);
router.get("/", getAllUsers); // GET /api/users → all users
router.get("/random/users", getRandomUsers); // GET /api/users/random?limit=5 → random users
router.put("/follow/:userId", authMiddleware, followUser);
router.put("/unfollow/:userId", authMiddleware, unfollowUser);

export default router;
