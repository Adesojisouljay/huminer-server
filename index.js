import express from 'express';
import bodyParser from 'body-parser';
import connectDB from './db.js';
import http from 'http';
import cors from "cors";
import userRoute from "./routes/userRoute.js"
import postRoute from "./routes/postRoute.js"
import songLinkTree from "./routes/songLinkTree.js"

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 2111;

app.use(cors());



app.use(bodyParser.json());

connectDB()

// Routes
app.use("/api/users", userRoute);
app.use("/api/posts", postRoute);
app.use("/api/song", songLinkTree);

server.listen(PORT, () => {
  console.log(`Music platfrom is running on port ${PORT}`);
});
