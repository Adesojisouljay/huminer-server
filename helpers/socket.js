import { Server } from "socket.io";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import CallLog from "../models/CallLog.js";
import { sendIncomingCallPush } from "./pushService.js";

let io;
const onlineUsers = new Map(); 
// structure: userId -> socketId
const activeCalls = new Map();
// structure: "user1:user2" -> { logId, callerId, calleeId, callType, startTime, connectedTime, answered }

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
    socket.on("sendMessage", async ({ chatId, senderId, text, replyTo, audioUrl, audioDuration, fileUrl, fileType, fileName, fileSize }) => {
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
          text: text || "",
          audioUrl: audioUrl || undefined,
          audioDuration: audioDuration || undefined,
          fileUrl: fileUrl || undefined,
          fileType: fileType || undefined,
          fileName: fileName || undefined,
          fileSize: fileSize || undefined,
          replyTo: replyTo || undefined,
          deliveredTo: initialDelivered,
          readBy: [senderId],
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
        }
        chat.lastMessage = preview;
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

  socket.on("callUser", async ({ toUserId, fromUserId, callType, offer, fromUsername, fromProfilePicture }) => {
    const targetUid = toUserId?.toString();
    const fromUid = fromUserId?.toString();
    console.log(`[Call] callUser from ${fromUid} (@${fromUsername}) to ${targetUid} (${callType})`);

    let logEntry = null;
    try {
      logEntry = await CallLog.create({
        caller: fromUid,
        callee: targetUid,
        callType: callType || "audio",
        status: "missed",
        startedAt: new Date(),
      });
    } catch (err) {
      console.error("Failed to create CallLog:", err);
    }

    const callKey = [fromUid, targetUid].sort().join(":");
    activeCalls.set(callKey, {
      logId: logEntry?._id,
      callerId: fromUid,
      calleeId: targetUid,
      callType: callType || "audio",
      startTime: Date.now(),
      connectedTime: null,
      answered: false,
    });

    const payload = {
      callId: logEntry?._id,
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

  socket.on("answerCall", async ({ toUserId, fromUserId, answer }) => {
    const targetUid = toUserId?.toString();
    const fromUid = fromUserId?.toString();
    console.log(`[Call] answerCall from ${fromUid} to ${targetUid}`);

    const callKey = [fromUid, targetUid].sort().join(":");
    const call = activeCalls.get(callKey);
    if (call) {
      call.answered = true;
      call.connectedTime = Date.now();
      if (call.logId) {
        try {
          await CallLog.findByIdAndUpdate(call.logId, { status: "answered" });
        } catch (e) {
          console.error("Failed to update call status to answered:", e);
        }
      }
    }

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

  
  
  
  // Group Call Room Tracking
  socket.on("joinGroupRoomTracker", async ({ chatId, userId }) => {
    if (!global.activeGroupRooms) global.activeGroupRooms = new Map();
    let room = global.activeGroupRooms.get(chatId.toString());
    if (!room) {
      room = new Set();
      global.activeGroupRooms.set(chatId.toString(), room);
    }
    room.add(userId.toString());
    
    try {
      const Chat = require("../models/Chat");
      const chat = await Chat.findById(chatId);
      if (chat && chat.participants) {
        chat.participants.forEach(p => {
          const pid = p.toString();
          const pSocket = onlineUsers.get(pid);
          if (pSocket) {
            io.to(pSocket).emit("groupRoomStateUpdate", { chatId, count: room.size });
          }
        });
      }
    } catch(e) { console.error(e) }
  });

  socket.on("leaveGroupRoomTracker", async ({ chatId, userId }) => {
    if (!global.activeGroupRooms) return;
    let room = global.activeGroupRooms.get(chatId.toString());
    if (room) {
      room.delete(userId.toString());
      const count = room.size;
      if (count === 0) {
        global.activeGroupRooms.delete(chatId.toString());
      }
      
      try {
        const Chat = require("../models/Chat");
        const chat = await Chat.findById(chatId);
        if (chat && chat.participants) {
          chat.participants.forEach(p => {
            const pid = p.toString();
            const pSocket = onlineUsers.get(pid);
            if (pSocket) {
              io.to(pSocket).emit("groupRoomStateUpdate", { chatId, count });
            }
          });
        }
      } catch(e) { console.error(e) }
    }
  });

  socket.on("checkGroupRoomStatus", ({ chatId }, callback) => {
    if (global.activeGroupRooms && global.activeGroupRooms.has(chatId.toString())) {
      callback({ count: global.activeGroupRooms.get(chatId.toString()).size });
    } else {
      callback({ count: 0 });
    }
  });

  socket.on("startGroupCall", async ({ chatId, groupName, caller, participants, callType }) => {
    console.log(`[Group Call] ${caller.username} started a ${callType} call in ${groupName}`);
    
    // Broadcast incoming call to all participants except the caller
    participants.forEach((p) => {
      const pid = p._id || p;
      if (pid.toString() !== caller._id.toString()) {
        const pSocket = onlineUsers.get(pid.toString());
        if (pSocket) {
          io.to(pSocket).emit("incomingGroupCall", {
            chatId,
            groupName,
            caller,
            callType,
            timestamp: Date.now()
          });
        }
      }
    });
  });

  socket.on("endCall", async ({ toUserId, fromUserId }) => {
    const targetUid = toUserId?.toString();
    const fromUid = fromUserId?.toString();
    console.log(`[Call] endCall between ${fromUid} and ${targetUid}`);

    const callKey = [fromUid, targetUid].sort().join(":");
    const call = activeCalls.get(callKey);
    if (call) {
      const isAnswered = call.answered && call.connectedTime;
      const duration = isAnswered ? Math.max(1, Math.round((Date.now() - call.connectedTime) / 1000)) : 0;
      let status = "missed";
      if (isAnswered) {
        status = "answered";
      } else if (fromUid === call.calleeId) {
        status = "rejected";
      } else {
        status = "missed";
      }

      if (call.logId) {
        try {
          const updatedLog = await CallLog.findByIdAndUpdate(
            call.logId,
            { status, endedAt: new Date(), duration },
            { new: true }
          )
            .populate("caller", "username profilePicture")
            .populate("callee", "username profilePicture");

          if (updatedLog) {
            io.to(`user:${call.callerId}`).emit("callLogUpdated", updatedLog);
            io.to(`user:${call.calleeId}`).emit("callLogUpdated", updatedLog);
          }
        } catch (e) {
          console.error("Failed to finalize CallLog on endCall:", e);
        }
      }
      activeCalls.delete(callKey);
    }

    io.to(`user:${targetUid}`).emit("callEnded", { fromUserId: fromUid });
    const targetSocketId = onlineUsers.get(targetUid);
    if (targetSocketId) {
      io.to(targetSocketId).emit("callEnded", { fromUserId: fromUid });
    }
  });
  
    /* --------------------------
         USER DISCONNECTS
    ---------------------------*/
    socket.on("disconnect", async () => {
      console.log("Client disconnected: " + socket.id);


      // Clean up group rooms
      if (socket.userId && global.activeGroupRooms) {
        for (const [chatId, roomSet] of global.activeGroupRooms.entries()) {
          if (roomSet.has(socket.userId.toString())) {
            roomSet.delete(socket.userId.toString());
            const count = roomSet.size;
            if (count === 0) {
              global.activeGroupRooms.delete(chatId);
            }
            // Broadcast to participants
            try {
              const Chat = require("../models/Chat");
              Chat.findById(chatId).then(chat => {
                if (chat && chat.participants) {
                  chat.participants.forEach(p => {
                    const pSocket = onlineUsers.get(p.toString());
                    if (pSocket) {
                      io.to(pSocket).emit("groupRoomStateUpdate", { chatId, count });
                    }
                  });
                }
              });
            } catch(e) {}
          }
        }
      }

      // Clean up any active call for this socket

      if (socket.userId) {
        for (const [key, call] of activeCalls.entries()) {
          if (call.callerId === socket.userId || call.calleeId === socket.userId) {
            const otherUid = call.callerId === socket.userId ? call.calleeId : call.callerId;
            io.to(`user:${otherUid}`).emit("callEnded", { fromUserId: socket.userId });

            const isAnswered = call.answered && call.connectedTime;
            const duration = isAnswered ? Math.max(1, Math.round((Date.now() - call.connectedTime) / 1000)) : 0;
            const status = isAnswered ? "answered" : "missed";

            if (call.logId) {
              try {
                const updatedLog = await CallLog.findByIdAndUpdate(
                  call.logId,
                  { status, endedAt: new Date(), duration },
                  { new: true }
                )
                  .populate("caller", "username profilePicture")
                  .populate("callee", "username profilePicture");

                if (updatedLog) {
                  io.to(`user:${call.callerId}`).emit("callLogUpdated", updatedLog);
                  io.to(`user:${call.calleeId}`).emit("callLogUpdated", updatedLog);
                }
              } catch (e) {
                console.error("Error finalizing disconnected call log:", e);
              }
            }
            activeCalls.delete(key);
          }
        }
      }

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
