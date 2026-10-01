import Chat from "../models/Chat.js";
import User from "../models/User.js";
import { emitChatMessage } from "../helpers/socket.js";

// Create a new chat between users
export const createChat = async (req, res) => {
  try {
    const { participants } = req.body; // array of user IDs

    if (!participants || participants.length < 2) {
      return res.status(400).json({ message: "At least 2 participants required" });
    }

    // Check if chat already exists between these participants
    const existingChat = await Chat.findOne({
      participants: { $all: participants, $size: participants.length }
    });

    if (existingChat) {
      return res.status(200).json({ message: "Chat already exists", chat: existingChat });
    }

    const newChat = await Chat.create({ participants });
    res.status(201).json({ message: "Chat created", chat: newChat });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all chats for a user with unread message counts
export const getUserChats = async (req, res) => {
  try {
    const userId = req.params.userId;

    const chats = await Chat.find({ participants: userId })
      .populate("participants", "username profilePicture")
      .populate("messages.sender", "username profilePicture")
      .sort({ updatedAt: -1 });

    const chatsWithUnread = chats.map((chat) => {
      const chatObj = chat.toObject();
      // Count unread messages not sent by userId and not having userId in readBy
      const unreadCount = (chat.messages || []).filter((msg) => {
        const isFromOther = msg.sender?._id?.toString() !== userId.toString() && msg.sender?.toString() !== userId.toString();
        const alreadyRead = (msg.readBy || []).some((rId) => rId.toString() === userId.toString());
        return isFromOther && !alreadyRead;
      }).length;

      chatObj.unreadCount = unreadCount;
      return chatObj;
    });

    res.json({ chats: chatsWithUnread });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Send a message in a chat
export const sendMessage = async (req, res) => {
  try {
    const { chatId, senderId, text } = req.body;

    if (!chatId || !senderId || !text) {
      return res.status(400).json({ message: "chatId, senderId and text are required" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    const newMessage = { sender: senderId, text, readBy: [senderId], deliveredTo: [senderId] };
    chat.messages.push(newMessage);
    chat.lastMessage = text;
    await chat.save();

    const populated = await chat.populate({
      path: "messages.sender",
      select: "username profilePicture"
    });
    const lastMessage = populated.messages[populated.messages.length - 1];

    emitChatMessage(chatId, lastMessage, senderId, chat.participants);

    res.status(201).json({ message: "Message sent", chat, newMessage: lastMessage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Mark all messages in a chat as read by a user
export const markChatAsRead = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({ message: "chatId and userId are required" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    let updated = false;
    (chat.messages || []).forEach((msg) => {
      if (!msg.readBy) msg.readBy = [];
      if (!msg.deliveredTo) msg.deliveredTo = [];

      if (!msg.deliveredTo.some((rId) => rId.toString() === userId.toString())) {
        msg.deliveredTo.push(userId);
        updated = true;
      }

      const hasRead = msg.readBy.some((rId) => rId.toString() === userId.toString());
      if (!hasRead) {
        msg.readBy.push(userId);
        updated = true;
      }
    });

    if (updated) {
      await chat.save();
    }

    res.json({ success: true, message: "Chat marked as read", chatId });
  } catch (err) {
    console.error("markChatAsRead error:", err);
    res.status(500).json({ message: "Server error marking chat as read" });
  }
};

// Get messages of a chat
export const getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId).populate("messages.sender", "username profilePicture");
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    res.json({ messages: chat.messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get a single chat by ID
export const getChatById = async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId)
      .populate("participants", "username profilePicture")
      .populate("messages.sender", "username profilePicture");

    if (!chat) return res.status(404).json({ message: "Chat not found" });

    res.json({ chat });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};