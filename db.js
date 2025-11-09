import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const connectDB = async () => {
  try {
      const conn = await mongoose.connect(process.env.ENVIRONMENT === "development" ? 
      process.env.DEV_MONGO_URI : process.env.PROD_MONGO_URI, {
      });
      console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
      console.error(`Error connecting to MongoDB: ${err.message}`);
      process.exit(1);
  }
};

export default connectDB;
