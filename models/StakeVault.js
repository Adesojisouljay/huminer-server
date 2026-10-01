import mongoose from "mongoose";

const beneficiarySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  username: {
    type: String,
    required: true
  },
  percentage: {
    type: Number,
    required: true,
    min: 1,
    max: 100
  }
}, { _id: false });

const stakeVaultSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },
  stakedAmountUSDT: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  // Protocol parameters: 15% gross HBD yield, 10% APY to user/beneficiaries, 5% retained by protocol as buffer
  annualYieldRate: {
    type: Number,
    default: 0.10 // 10% net user yield
  },
  protocolReserveRate: {
    type: Number,
    default: 0.05 // 5% buffer reserve
  },
  beneficiaries: [beneficiarySchema], // Beneficiaries share from the 10% monthly yield
  selfSharePercentage: {
    type: Number,
    default: 100 // Defaults to 100% until beneficiaries are set
  },
  status: {
    type: String,
    enum: ["active", "unstaking", "withdrawn"],
    default: "active"
  },
  lastPayoutAt: {
    type: Date,
    default: Date.now
  },
  nextPayoutAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  },
  unstakeRequestedAt: {
    type: Date
  },
  unstakeAvailableAt: {
    type: Date // 3 days lock period to mirror HBD unstake release
  },
  totalRewardsDistributedUSDT: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

const StakeVault = mongoose.model("StakeVault", stakeVaultSchema);
export default StakeVault;
