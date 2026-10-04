import express from "express";
import {
  createChat,
  getUserChats,
  sendMessage,
  getChatMessages,
  getChatById,
  markChatAsRead,
  getUserCallLogs,
  deleteCallLog,
  clearUserCallLogs,
  markCallsAsSeen,
  createGroupChat,
  updateGroupDescription,
  addGroupParticipants,
  removeGroupParticipant,
  toggleMuteGroup,
} from "../controllers/chat.js";

const router = express.Router();

// Call logs
router.get("/calls/user/:userId", getUserCallLogs);
router.put("/calls/user/:userId/seen", markCallsAsSeen);
router.delete("/calls/:callId", deleteCallLog);
router.delete("/calls/user/:userId/clear", clearUserCallLogs);

// Create a new chat
router.post("/", createChat);
router.post("/group", createGroupChat);

// Group management
router.put("/:chatId/description", updateGroupDescription);
router.put("/:chatId/participants/add", addGroupParticipants);
router.put("/:chatId/participants/remove", removeGroupParticipant);
router.put("/:chatId/mute", toggleMuteGroup);

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
