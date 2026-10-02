import dotenv from "dotenv";
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import cron from "node-cron";
import connectDB from './db.js';
import http from 'http';
import cors from "cors";
import userRoute from "./routes/userRoute.js"
import postRoute from "./routes/postRoute.js"
import songLinkTree from "./routes/songLinkTree.js"
import notification from "./routes/notification.js"
import { runPayoutProcessor, runPayoutRecovery } from './cron-jobs/payout.js';
import chatRoute from "./routes/chat.js";
import { setupSocket } from "./helpers/socket.js";
import paymentRoutes from "./routes/paymentRoute.js";
import stakingRoutes from "./routes/stakingRoute.js";
import walletRoutes from "./routes/walletRoute.js";
import { handleWalletCallback } from "./controllers/payment.js";

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 2111;

app.use(cors());

cron.schedule("* * * * *", () => {
  runPayoutProcessor(); // runs every minute
});
cron.schedule("* * * * *", () => {
  runPayoutRecovery(); // runs every minute
});

app.use(bodyParser.json());

connectDB();

// after creating server
setupSocket(server);

// Paystack Redirect Callback
app.get("/wallet", handleWalletCallback);

// Routes
app.use("/api/users", userRoute);
app.use("/api/posts", postRoute);
app.use("/api/song", songLinkTree);
app.use("/api/notifications", notification);
app.use("/api/chats", chatRoute);
app.use("/api/payment", paymentRoutes);
app.use("/api/staking", stakingRoutes);
app.use("/api/wallet", walletRoutes);

server.listen(PORT, () => {
  console.log(`Music platfrom is running on port ${PORT}`);
});
