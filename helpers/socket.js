import { Server } from "socket.io";
import Chat from "../models/Chat.js";

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
      onlineUsers.set(userId, socket.id);
      console.log(`User Online: ${userId}`);

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

        const newMessage = { sender: senderId, text };
        chat.messages.push(newMessage);
        await chat.save();

        const populatedMessage = await chat.populate({
          path: "messages.sender",
          select: "username profilePicture"
        });

        const lastMessage =
          populatedMessage.messages[populatedMessage.messages.length - 1];

        io.to(chatId).emit("newMessage", { chatId, message: lastMessage });

      } catch (err) {
        console.error(err);
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

socket.on("callUser", ({ toUserId, fromUserId, callType, offer }) => {
    const targetSocketId = onlineUsers.get(toUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit("incomingCall", { fromUserId, callType, offer });
    } else {
      // optional: reply to caller that target is offline
      io.to(socket.id).emit("userOffline", { toUserId });
    }
  });
  
  socket.on("answerCall", ({ toUserId, fromUserId, answer }) => {
    const targetSocketId = onlineUsers.get(toUserId); // usually caller
    if (targetSocketId) {
      io.to(targetSocketId).emit("callAnswered", { fromUserId, answer });
    }
  });
  
  socket.on("iceCandidate", ({ toUserId, fromUserId, candidate }) => {
    const targetSocketId = onlineUsers.get(toUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit("iceCandidate", { fromUserId, candidate });
    }
  });
  
  socket.on("endCall", ({ toUserId, fromUserId }) => {
    const targetSocketId = onlineUsers.get(toUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit("callEnded", { fromUserId });
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
