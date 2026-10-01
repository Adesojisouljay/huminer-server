import express from "express";
import { createChat, getUserChats, sendMessage, getChatMessages, getChatById, markChatAsRead } from "../controllers/chat.js";

const router = express.Router();

// Create a new chat
router.post("/", createChat);

// Get all chats for a user
router.get("/user/:userId", getUserChats); // prefix with /user so it doesn't conflict with chatId route

// Send a message
router.post("/message", sendMessage);

// Mark chat as read
router.put("/:chatId/read", markChatAsRead);

// Get messages of a chat
router.get("/:chatId/messages", getChatMessages);

router.get("/chats/:chatId", getChatById);

export default router;
