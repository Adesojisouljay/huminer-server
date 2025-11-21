import Chat from "../models/Chat.js";
import User from "../models/User.js";

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

// Get all chats for a user
export const getUserChats = async (req, res) => {
  try {
    const userId = req.params.userId;

    const chats = await Chat.find({ participants: userId })
      .populate("participants", "username profilePicture")
      .sort({ updatedAt: -1 });

    res.json({ chats });
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

    const newMessage = { sender: senderId, text };
    chat.messages.push(newMessage);
    chat.lastMessage = text;
    await chat.save();

    res.status(201).json({ message: "Message sent", chat });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
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
  