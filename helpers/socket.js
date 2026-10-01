import { Server } from "socket.io";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import { sendIncomingCallPush } from "./pushService.js";

let io;
const onlineUsers = new Map(); 
// structure: userId -> socketId

export const setupSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket) => {
    console.log("New client connected: " + socket.id);

    /* --------------------------
       USER ONLINE SYSTEM
    ---------------------------*/

    // When frontend tells backend “I am online”
    socket.on("userOnline", (userId) => {
      const uid = userId?.toString();
      if (!uid) return;
      onlineUsers.set(uid, socket.id);
      socket.userId = uid;
      socket.join(`user:${uid}`);
      console.log(`User Online: ${uid} (socket: ${socket.id})`);

      // broadcast updated list
      io.emit("onlineUsers", Array.from(onlineUsers.keys()));
    });

    // Frontend requests the list manually (optional)
    socket.on("getOnlineUsers", () => {
      socket.emit("onlineUsers", Array.from(onlineUsers.keys()));
    });


    /* --------------------------
         JOIN CHAT ROOM
    ---------------------------*/
    socket.on("joinRoom", (chatId) => {
      socket.join(chatId);
      console.log(`Socket ${socket.id} joined room ${chatId}`);
    });


    /* --------------------------
         SEND MESSAGE
    ---------------------------*/
    socket.on("sendMessage", async ({ chatId, senderId, text }) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return;

        socket.join(chatId);

        // Check which participants are currently online (delivered)
        const initialDelivered = [senderId];
        (chat.participants || []).forEach((pId) => {
          const pStr = pId.toString();
          if (pStr !== senderId.toString() && onlineUsers.has(pStr)) {
            initialDelivered.push(pId);
          }
        });

        const newMessage = {
          sender: senderId,
          text,
          deliveredTo: initialDelivered,
          readBy: [senderId],
        };
        chat.messages.push(newMessage);
        chat.lastMessage = text;
        await chat.save();

        const populatedMessage = await chat.populate({
          path: "messages.sender",
          select: "username profilePicture"
        });

        const lastMessage =
          populatedMessage.messages[populatedMessage.messages.length - 1];

        // Emit inside the chat room
        io.to(chatId).emit("newMessage", { chatId, message: lastMessage });

        // Also notify all other participants in their personal rooms so unread counts update in real-time
        (chat.participants || []).forEach((pId) => {
          const participantId = pId.toString();
          if (participantId !== senderId.toString()) {
            io.to(`user:${participantId}`).emit("chatMessageReceived", {
              chatId,
              message: lastMessage,
              senderId: senderId.toString(),
            });
          }
        });

      } catch (err) {
        console.error(err);
      }
    });

    /* --------------------------
         MARK CHAT READ / SEEN VIA SOCKET
    ---------------------------*/
    socket.on("markChatRead", async ({ chatId, userId }) => {
      try {
        if (!chatId || !userId) return;
        const chat = await Chat.findById(chatId);
        if (!chat) return;

        let updated = false;
        (chat.messages || []).forEach((msg) => {
          if (!msg.readBy) msg.readBy = [];
          if (!msg.deliveredTo) msg.deliveredTo = [];

          if (!msg.deliveredTo.some((rId) => rId.toString() === userId.toString())) {
            msg.deliveredTo.push(userId);
            updated = true;
          }

          if (!msg.readBy.some((rId) => rId.toString() === userId.toString())) {
            msg.readBy.push(userId);
            updated = true;
          }
        });

        if (updated) {
          await chat.save();
        }

        // Notify user sockets to clear unread counts for this chat
        io.to(`user:${userId}`).emit("chatReadUpdated", { chatId, userId });

        // Broadcast to the whole chat room so the sender's checkmarks turn blue (Read/Seen) instantly
        io.to(chatId).emit("messagesSeen", { chatId, userId });

      } catch (err) {
        console.error("markChatRead socket error:", err);
      }
    });

    // inside io.on("connection", socket => { ... })
// ---------- CALL / WEBRTC SIGNALING ----------
/**
 * Caller -> server -> callee
 * Payloads:
 *  - callUser: { toUserId, fromUserId, callType, offer }
 *  - answerCall: { toUserId, fromUserId, answer }
 *  - iceCandidate: { toUserId, fromUserId, candidate }
 *  - endCall: { toUserId, fromUserId }
 */

  socket.on("callUser", ({ toUserId, fromUserId, callType, offer, fromUsername, fromProfilePicture }) => {
    const targetUid = toUserId?.toString();
    const fromUid = fromUserId?.toString();
    console.log(`[Call] callUser from ${fromUid} (@${fromUsername}) to ${targetUid} (${callType})`);

    const payload = {
      fromUserId: fromUid,
      callType,
      offer,
      fromUsername: fromUsername || "User",
      fromProfilePicture: fromProfilePicture || null,
    };

    // Emit to personal user room
    io.to(`user:${targetUid}`).emit("incomingCall", payload);

    // Also emit directly to socketId if stored in onlineUsers
    const targetSocketId = onlineUsers.get(targetUid);
    if (targetSocketId) {
      io.to(targetSocketId).emit("incomingCall", payload);
    }

    // Also dispatch native push notification for background / closed app ringing
    sendIncomingCallPush({
      toUserId: targetUid,
      fromUserId: fromUid,
      fromUsername,
      fromProfilePicture,
      callType,
    }).catch((err) => console.error("Push dispatch error:", err));
  });

  // Client registers native device push token (Capacitor FCM)
  socket.on("registerFcmToken", async ({ userId, token }) => {
    if (!userId || !token) return;
    try {
      await User.findByIdAndUpdate(userId, {
        $addToSet: { fcmTokens: token },
      });
      console.log(`📱 [Push] Registered device push token for user ${userId}`);
    } catch (err) {
      console.error("Failed to register device push token:", err);
    }
  });

  socket.on("answerCall", ({ toUserId, fromUserId, answer }) => {
    const targetUid = toUserId?.toString();
    const fromUid = fromUserId?.toString();
    console.log(`[Call] answerCall from ${fromUid} to ${targetUid}`);

    io.to(`user:${targetUid}`).emit("callAnswered", { fromUserId: fromUid, answer });
    const targetSocketId = onlineUsers.get(targetUid);
    if (targetSocketId) {
      io.to(targetSocketId).emit("callAnswered", { fromUserId: fromUid, answer });
    }
  });

  socket.on("iceCandidate", ({ toUserId, fromUserId, candidate }) => {
    const targetUid = toUserId?.toString();
    const fromUid = fromUserId?.toString();

    io.to(`user:${targetUid}`).emit("iceCandidate", { fromUserId: fromUid, candidate });
    const targetSocketId = onlineUsers.get(targetUid);
    if (targetSocketId) {
      io.to(targetSocketId).emit("iceCandidate", { fromUserId: fromUid, candidate });
    }
  });

  socket.on("endCall", ({ toUserId, fromUserId }) => {
    const targetUid = toUserId?.toString();
    const fromUid = fromUserId?.toString();
    console.log(`[Call] endCall between ${fromUid} and ${targetUid}`);

    io.to(`user:${targetUid}`).emit("callEnded", { fromUserId: fromUid });
    const targetSocketId = onlineUsers.get(targetUid);
    if (targetSocketId) {
      io.to(targetSocketId).emit("callEnded", { fromUserId: fromUid });
    }
  });
  
    /* --------------------------
         USER DISCONNECTS
    ---------------------------*/
    socket.on("disconnect", () => {
      console.log("Client disconnected: " + socket.id);

      // Remove user from online list
      for (const [userId, sockId] of onlineUsers.entries()) {
        if (sockId === socket.id) {
          onlineUsers.delete(userId);
          console.log(`User Offline: ${userId}`);
          break;
        }
      }

      // broadcast updated list
      io.emit("onlineUsers", Array.from(onlineUsers.keys()));
    });
  });
};

export const emitMessage = (chatId, message) => {
  if (io) {
    io.to(chatId).emit("newMessage", { chatId, message });
  }
};

export const emitChatMessage = (chatId, lastMessage, senderId, participants) => {
  if (io) {
    io.to(chatId).emit("newMessage", { chatId, message: lastMessage });
    (participants || []).forEach((pId) => {
      const participantId = pId.toString();
      if (participantId !== senderId.toString()) {
        io.to(`user:${participantId}`).emit("chatMessageReceived", {
          chatId,
          message: lastMessage,
          senderId: senderId.toString(),
        });
      }
    });
  }
};

export const emitNotificationToUser = (targetUserId, notification) => {
  if (io && targetUserId) {
    const uid = targetUserId.toString();
    console.log(`[Socket] Emitting newNotification to user:${uid}`, notification?._id);
    // Emit to user room (handles multiple open tabs or reconnects)
    io.to(`user:${uid}`).emit("newNotification", notification);
  }
};

export const emitUserBalanceUpdate = (targetUserId, balance) => {
  if (io && targetUserId) {
    const uid = targetUserId.toString();
    console.log(`[Socket] Emitting balanceUpdated to user:${uid}`, balance);
    io.to(`user:${uid}`).emit("balanceUpdated", { balance });
  }
};
