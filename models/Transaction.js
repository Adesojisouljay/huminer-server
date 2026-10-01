import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    amount: {
        type: Number, // Amount in kobo (Paystack standard) or Naira. Let's send in Naira but Paystack uses kobo. 
        // Recommendation: Store in NAIRA for consistency with User balance, but handle conversion in controller.
        required: true
    },
    reference: {
        type: String,
        required: true,
        unique: true
    },
    status: {
        type: String,
        enum: ["pending", "success", "failed"],
        default: "pending"
    },
    type: {
        type: String,
        enum: ["deposit", "withdrawal"],
        default: "deposit"
    },
    metadata: {
        type: Object // For flexibility (e.g., paystack response)
    }
}, { timestamps: true });

export default mongoose.model("Transaction", transactionSchema);
