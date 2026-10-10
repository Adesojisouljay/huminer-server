import Chat from "../models/Chat.js";
import User from "../models/User.js";
import CallLog from "../models/CallLog.js";
import { emitChatMessage, emitGroupUpdated } from "../helpers/socket.js";
import { sendPushNotification } from "../helpers/pushService.js";

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

    // Purge legacy "Call with " phantom group chats from DB
    await Chat.deleteMany({
      isGroup: true,
      groupName: { $regex: /^Call with /i },
    }).catch((err) => console.error("Error purging call chats:", err));

    const chats = await Chat.find({
      participants: userId,
      $or: [
        { isGroup: false },
        { groupName: { $not: { $regex: /^Call with /i } } },
      ],
    })
      .populate("participants", "username profilePicture")
      .populate("admin", "username profilePicture")
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
    const { chatId, senderId, text, replyTo, audioUrl, audioDuration, fileUrl, fileType, fileName, fileSize, sharedPost } = req.body;

    if (!chatId || !senderId || (!text && !audioUrl && !fileUrl && !sharedPost)) {
      return res.status(400).json({ message: "chatId, senderId and text, audioUrl, fileUrl, or sharedPost are required" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    // Check if group chat is muted and sender is not admin
    if (chat.isGroup && chat.isMuted) {
      const isAdmin = (chat.admin || []).some(
        (a) => (a._id || a).toString() === senderId.toString()
      );
      if (!isAdmin) {
        return res.status(403).json({
          message: "This group is muted by admin. Only admins can send messages.",
        });
      }
    }

    // 🛡️ Block enforcement for 1-on-1 chats
    if (!chat.isGroup) {
      const otherParticipantId = chat.participants.find(
        (p) => (p._id || p).toString() !== senderId.toString()
      );
      if (otherParticipantId) {
        const User = (await import("../models/User.js")).default;
        const otherUser = await User.findById(otherParticipantId).select("blockedUsers");
        const senderUser = await User.findById(senderId).select("blockedUsers");

        const isSenderBlockedByOther = otherUser?.blockedUsers?.some(
          (bId) => bId.toString() === senderId.toString()
        );
        const hasSenderBlockedOther = senderUser?.blockedUsers?.some(
          (bId) => bId.toString() === otherParticipantId.toString()
        );

        if (isSenderBlockedByOther || hasSenderBlockedOther) {
          return res.status(403).json({
            message: "Cannot send message. You or the other user has blocked communication.",
          });
        }
      }
    }

    const newMessage = {
      sender: senderId,
      text: text || "",
      audioUrl: audioUrl || undefined,
      audioDuration: audioDuration || undefined,
      fileUrl: fileUrl || undefined,
      fileType: fileType || undefined,
      fileName: fileName || undefined,
      fileSize: fileSize || undefined,
      replyTo: replyTo || undefined,
      sharedPost: sharedPost || undefined,
      readBy: [senderId],
      deliveredTo: [senderId],
    };
    chat.messages.push(newMessage);
    
    let preview = text;
    if (audioUrl) {
      preview = "🎤 Voice message";
    } else if (fileUrl) {
      if (fileType === "image") preview = "📷 Photo";
      else if (fileType === "video") preview = "🎥 Video";
      else if (fileType === "audio") preview = "🎵 Audio file";
      else preview = `📄 ${fileName || "Document"}`;
    } else if (sharedPost) {
      preview = `🔗 Shared post: ${sharedPost.title || "a post"}`;
    }
    chat.lastMessage = preview;
    await chat.save();

    const populated = await chat.populate({
      path: "messages.sender",
      select: "username profilePicture"
    });
    const lastMessage = populated.messages[populated.messages.length - 1];

    emitChatMessage(chatId, lastMessage, senderId, chat.participants, {
      isGroup: chat.isGroup,
      groupName: chat.groupName,
    });

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

    const chat = await Chat.findById(chatId)
      .populate("messages.sender", "username profilePicture")
      .populate("participants", "username profilePicture");
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    // For 1-on-1 chats, sync existing CallLogs so past calls show up in chat
    if (!chat.isGroup && chat.participants && chat.participants.length === 2) {
      const p0 = chat.participants[0]._id || chat.participants[0];
      const p1 = chat.participants[1]._id || chat.participants[1];

      const existingCallLogIds = new Set(
        (chat.messages || [])
          .filter((m) => m.callInfo?.callLogId)
          .map((m) => m.callInfo.callLogId.toString())
      );

      const pastCalls = await CallLog.find({
        $or: [
          { caller: p0, callee: p1 },
          { caller: p1, callee: p0 },
        ],
      });

      let added = false;
      for (const log of pastCalls) {
        if (!existingCallLogIds.has(log._id.toString())) {
          const isVideo = log.callType === "video";
          const callTitle = isVideo ? "Video call" : "Voice call";
          chat.messages.push({
            sender: log.caller,
            text: log.status === "missed" ? `Missed ${callTitle.toLowerCase()}` : callTitle,
            callInfo: {
              callLogId: log._id,
              callType: log.callType || "audio",
              status: log.status || "missed",
              duration: log.duration || 0,
              isGroup: false,
            },
            readBy: [log.caller],
            deliveredTo: [log.caller, log.callee],
            createdAt: log.startedAt || log.createdAt || new Date(),
          });
          added = true;
        }
      }

      if (added) {
        chat.messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const lastMsg = chat.messages[chat.messages.length - 1];
        if (lastMsg) {
          chat.lastMessage = lastMsg.text || (lastMsg.audioUrl ? "Voice note" : (lastMsg.fileUrl ? "Media" : "Message"));
        }
        await chat.save();
        await chat.populate("messages.sender", "username profilePicture");
      }
    }

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
      .populate("admin", "username profilePicture")
      .populate("messages.sender", "username profilePicture");

    if (!chat) return res.status(404).json({ message: "Chat not found" });

    res.json({ chat });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get call history for a user
export const getUserCallLogs = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: "User ID required" });
    }

    const calls = await CallLog.find({
      $or: [{ caller: userId }, { callee: userId }],
    })
      .populate("caller", "username profilePicture")
      .populate("callee", "username profilePicture")
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ calls });
  } catch (err) {
    console.error("getUserCallLogs error:", err);
    res.status(500).json({ message: "Server error fetching call logs" });
  }
};

// Delete a single call log
export const deleteCallLog = async (req, res) => {
  try {
    const { callId } = req.params;
    await CallLog.findByIdAndDelete(callId);
    res.json({ message: "Call log deleted successfully" });
  } catch (err) {
    console.error("deleteCallLog error:", err);
    res.status(500).json({ message: "Server error deleting call log" });
  }
};

// Clear all call logs for a user
export const clearUserCallLogs = async (req, res) => {
  try {
    const { userId } = req.params;
    await CallLog.deleteMany({
      $or: [{ caller: userId }, { callee: userId }],
    });
    res.json({ message: "All call logs cleared" });
  } catch (err) {
    console.error("clearUserCallLogs error:", err);
    res.status(500).json({ message: "Server error clearing call logs" });
  }
};

// Mark all call logs as seen for a user (clears unread badge)
export const markCallsAsSeen = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: "User ID required" });
    }
    await CallLog.updateMany(
      { callee: userId, seen: { $ne: true } },
      { $set: { seen: true } }
    );
    res.json({ success: true, message: "Calls marked as seen" });
  } catch (err) {
    console.error("markCallsAsSeen error:", err);
    res.status(500).json({ message: "Server error marking calls as seen" });
  }
};

// Create a new group chat
export const createGroupChat = async (req, res) => {
  try {
    const { participants, groupName, adminId, groupDescription } = req.body;

    if (!participants || participants.length < 2) {
      return res.status(400).json({ message: "A group needs at least 2 participants" });
    }

    if (!groupName) {
      return res.status(400).json({ message: "Group name is required" });
    }

    if (/^Call with /i.test(groupName.trim())) {
      return res.status(400).json({ message: "Group name cannot start with 'Call with '" });
    }

    const newChat = await Chat.create({ 
      participants,
      isGroup: true,
      groupName,
      groupDescription: groupDescription || "",
      admin: [adminId]
    });

    const populated = await Chat.findById(newChat._id)
      .populate("participants", "username profilePicture")
      .populate("admin", "username profilePicture");

    res.status(201).json({ message: "Group chat created", chat: populated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Update group description (Admin only)
export const updateGroupDescription = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { adminId, description } = req.body;

    if (!chatId || !adminId) {
      return res.status(400).json({ message: "chatId and adminId are required" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat || !chat.isGroup) {
      return res.status(404).json({ message: "Group chat not found" });
    }

    const isAdmin = (chat.admin || []).some(
      (a) => (a._id || a).toString() === adminId.toString()
    );
    if (!isAdmin) {
      return res.status(403).json({ message: "Only group admins can update group description" });
    }

    chat.groupDescription = description || "";
    await chat.save();

    const populated = await Chat.findById(chatId)
      .populate("participants", "username profilePicture")
      .populate("admin", "username profilePicture")
      .populate("messages.sender", "username profilePicture");

    emitGroupUpdated(chatId, populated);

    res.status(200).json({ message: "Group description updated", chat: populated });
  } catch (err) {
    console.error("updateGroupDescription error:", err);
    res.status(500).json({ message: "Server error updating description" });
  }
};

// Add participants to a group chat (Admin only)
export const addGroupParticipants = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { adminId, userIds } = req.body;

    if (!chatId || !adminId || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: "chatId, adminId, and userIds array are required" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat || !chat.isGroup) {
      return res.status(404).json({ message: "Group chat not found" });
    }

    const isAdmin = (chat.admin || []).some(
      (a) => (a._id || a).toString() === adminId.toString()
    );
    if (!isAdmin) {
      return res.status(403).json({ message: "Only group admins can add participants" });
    }

    const currentParticipants = new Set(
      (chat.participants || []).map((p) => (p._id || p).toString())
    );

    userIds.forEach((uid) => {
      const uStr = uid.toString();
      if (!currentParticipants.has(uStr)) {
        chat.participants.push(uid);
        currentParticipants.add(uStr);
      }
    });

    await chat.save();

    const populated = await Chat.findById(chatId)
      .populate("participants", "username profilePicture")
      .populate("admin", "username profilePicture")
      .populate("messages.sender", "username profilePicture");

    emitGroupUpdated(chatId, populated);

    res.status(200).json({ message: "Participants added successfully", chat: populated });
  } catch (err) {
    console.error("addGroupParticipants error:", err);
    res.status(500).json({ message: "Server error adding participants" });
  }
};

// Remove a participant from a group chat (Admin or user removing self)
export const removeGroupParticipant = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { adminId, userId } = req.body;

    if (!chatId || !adminId || !userId) {
      return res.status(400).json({ message: "chatId, adminId, and userId are required" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat || !chat.isGroup) {
      return res.status(404).json({ message: "Group chat not found" });
    }

    const isAdmin = (chat.admin || []).some(
      (a) => (a._id || a).toString() === adminId.toString()
    );
    const isSelf = adminId.toString() === userId.toString();

    if (!isAdmin && !isSelf) {
      return res.status(403).json({ message: "Only group admins can remove participants" });
    }

    chat.participants = (chat.participants || []).filter(
      (p) => (p._id || p).toString() !== userId.toString()
    );
    chat.admin = (chat.admin || []).filter(
      (a) => (a._id || a).toString() !== userId.toString()
    );

    // If no admin left and participants exist, promote the first participant
    if (chat.admin.length === 0 && chat.participants.length > 0) {
      chat.admin.push(chat.participants[0]);
    }

    await chat.save();

    const populated = await Chat.findById(chatId)
      .populate("participants", "username profilePicture")
      .populate("admin", "username profilePicture")
      .populate("messages.sender", "username profilePicture");

    emitGroupUpdated(chatId, populated);

    res.status(200).json({ message: "Participant removed successfully", chat: populated });
  } catch (err) {
    console.error("removeGroupParticipant error:", err);
    res.status(500).json({ message: "Server error removing participant" });
  }
};

// Toggle mute / unmute group chat (Admin only)
export const toggleMuteGroup = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { adminId, isMuted } = req.body;

    if (!chatId || !adminId) {
      return res.status(400).json({ message: "chatId and adminId are required" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat || !chat.isGroup) {
      return res.status(404).json({ message: "Group chat not found" });
    }

    const isAdmin = (chat.admin || []).some(
      (a) => (a._id || a).toString() === adminId.toString()
    );
    if (!isAdmin) {
      return res.status(403).json({ message: "Only group admins can mute or unmute this chat" });
    }

    chat.isMuted = typeof isMuted === "boolean" ? isMuted : !chat.isMuted;
    await chat.save();

    const populated = await Chat.findById(chatId)
      .populate("participants", "username profilePicture")
      .populate("admin", "username profilePicture")
      .populate("messages.sender", "username profilePicture");

    emitGroupUpdated(chatId, populated);

    res.status(200).json({
      message: chat.isMuted ? "Group chat muted" : "Group chat unmuted",
      chat: populated,
    });
  } catch (err) {
    console.error("toggleMuteGroup error:", err);
    res.status(500).json({ message: "Server error updating mute status" });
  }
};

